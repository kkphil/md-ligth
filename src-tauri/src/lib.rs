use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

#[cfg(target_os = "macos")]
use tauri::menu::AboutMetadata;
use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItem, SubmenuBuilder};
use tauri::ipc::{InvokeBody, Request};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent, Wry,
};
use tauri_plugin_dialog::DialogExt;

/// Shared between all editor windows.
#[derive(Default)]
struct AppState {
    /// Files the OS asked us to open (Finder "Open With", drag onto the Dock icon, ...)
    /// that no window has picked up yet.
    pending: Mutex<Vec<String>>,
    /// Labels of windows with unsaved changes, so quitting can ask about each one.
    dirty: Mutex<HashSet<String>>,
}

static WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(0);

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Commands called from the frontend
// ---------------------------------------------------------------------------

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn new_window(app: AppHandle, path: Option<String>) -> Result<(), String> {
    open_window(&app, path).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_files(state: State<AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

#[tauri::command]
fn set_dirty(window: Window, state: State<AppState>, dirty: bool) {
    let mut set = state.dirty.lock().unwrap();
    if dirty {
        set.insert(window.label().to_string());
    } else {
        set.remove(window.label());
    }
}

/// Called by a window after it handled its part of a quit (saved or discarded).
#[tauri::command]
fn continue_quit(app: AppHandle) {
    request_quit(&app);
}

// ---------------------------------------------------------------------------
// Images (see src/images.ts for the rules deciding where they go)
// ---------------------------------------------------------------------------

/// `dir/name`, or `dir/name-1.ext`, `-2` … if taken by a different file.
/// An existing file with identical content is reused instead of duplicated.
fn unique_path(dir: &Path, name: &str, content: &[u8]) -> PathBuf {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut n = 0;
    loop {
        let candidate = if n == 0 { dir.join(name) } else { dir.join(format!("{stem}-{n}{ext}")) };
        if !candidate.exists() || std::fs::read(&candidate).map(|d| d == content).unwrap_or(false) {
            return candidate;
        }
        n += 1;
    }
}

fn store(dir: &Path, name: &str, data: &[u8]) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(err)?;
    let name: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let target = unique_path(dir, if name.is_empty() { "image.png" } else { &name }, data);
    if !target.exists() {
        std::fs::write(&target, data).map_err(err)?;
    }
    Ok(target.to_string_lossy().into_owned())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let hex = |b: u8| (b as char).to_digit(16);
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Copies a local image into `dir` (no-op if it already lives there).
#[tauri::command]
async fn copy_image(src: String, dir: String) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    let dir = PathBuf::from(dir);
    if src_path.parent() == Some(dir.as_path()) {
        return Ok(src);
    }
    let data = std::fs::read(&src_path).map_err(err)?;
    let name = src_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    store(&dir, &name, &data)
}

/// Saves pasted image bytes (raw request body) as `x-dir`/`x-name`.
#[tauri::command]
async fn save_image(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    let header = |key: &str| {
        request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .map(percent_decode)
            .ok_or_else(|| format!("missing {key} header"))
    };
    store(Path::new(&header("x-dir")?), &header("x-name")?, data)
}

/// Downloads an online image into `dir`.
#[tauri::command]
async fn download_image(url: String, dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // The OS's TLS stack (Security.framework on macOS) keeps the app small.
        let tls = ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build();
        let agent: ureq::Agent = ureq::Agent::config_builder().tls_config(tls).build().into();
        let mut response = agent.get(&url).call().map_err(err)?;
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !content_type.is_empty() && !content_type.starts_with("image/") {
            return Err(format!("{url} is not an image ({content_type})"));
        }
        let data = response
            .body_mut()
            .with_config()
            .limit(MAX_IMAGE_BYTES)
            .read_to_vec()
            .map_err(err)?;

        let mut name = Url::parse(&url)
            .ok()
            .and_then(|u| u.path_segments().and_then(|mut s| s.next_back().map(percent_decode)))
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| "image".into());
        if !name.contains('.') {
            let ext = match content_type.split(';').next().unwrap_or("") {
                "image/jpeg" => "jpg",
                "image/gif" => "gif",
                "image/webp" => "webp",
                "image/svg+xml" => "svg",
                "image/avif" => "avif",
                _ => "png",
            };
            name = format!("{name}.{ext}");
        }
        store(Path::new(&dir), &name, &data)
    })
    .await
    .map_err(err)?
}

/// Where pasted images go when no folder rule applies (like Typora's temp folder).
#[tauri::command]
fn app_image_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(err)?.join("images");
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Settings: one JSON file shared by all windows
// ---------------------------------------------------------------------------

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("settings.json"))
}

#[tauri::command]
fn load_settings(app: AppHandle) -> serde_json::Value {
    settings_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(err)?;
    std::fs::write(path, json).map_err(err)?;
    app.emit("settings-changed", settings).map_err(err)
}

// ---------------------------------------------------------------------------
// Workspace: folder listing for the sidebar, new files, rename/move, recent folders
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    dir: bool,
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MARKDOWN_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Subfolders and Markdown files of `dir` (hidden entries skipped), folders first.
#[tauri::command]
async fn list_dir(dir: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&dir)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            let dir = path.is_dir();
            if name.starts_with('.') || (!dir && !is_markdown(&path)) {
                return None;
            }
            Some(DirEntry { name, path: path.to_string_lossy().into_owned(), dir })
        })
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// Creates an empty `name` (adds `.md`, never overwrites: `Untitled-1.md` …) in `dir`.
#[tauri::command]
async fn create_file(dir: String, name: String) -> Result<String, String> {
    let dir = PathBuf::from(dir);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let name = name.trim().trim_matches(|c| c == '/' || c == '\\');
    let name = if name.is_empty() { "Untitled".to_string() } else { name.to_string() };
    let name = if is_markdown(Path::new(&name)) { name } else { format!("{name}.md") };
    let (stem, ext) = name.rsplit_once('.').map(|(s, e)| (s.to_string(), format!(".{e}"))).unwrap_or((name.clone(), String::new()));
    let mut n = 0;
    loop {
        let candidate = if n == 0 { dir.join(&name) } else { dir.join(format!("{stem}-{n}{ext}")) };
        if !candidate.exists() {
            std::fs::write(&candidate, "").map_err(err)?;
            return Ok(candidate.to_string_lossy().into_owned());
        }
        n += 1;
    }
}

/// Renames or moves a file. Refuses to overwrite an existing one.
#[tauri::command]
async fn rename_file(from: String, to: String) -> Result<(), String> {
    let (from, to) = (PathBuf::from(from), PathBuf::from(to));
    if from == to {
        return Ok(());
    }
    // A case-only rename on a case-insensitive disk "exists" already but is fine.
    let case_only = from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    if to.exists() && !case_only {
        return Err(format!("“{}” already exists", to.file_name().unwrap_or_default().to_string_lossy()));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    if std::fs::rename(&from, &to).is_err() {
        // Different volume: copy, then remove the original.
        std::fs::copy(&from, &to).map_err(err)?;
        std::fs::remove_file(&from).map_err(err)?;
    }
    Ok(())
}

const MAX_RECENT_FOLDERS: usize = 30;

fn recent_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("recent-folders.json"))
}

fn read_recent(app: &AppHandle) -> Vec<String> {
    recent_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|d| Path::new(d).is_dir())
        .collect()
}

fn write_recent(app: &AppHandle, folders: Vec<String>) -> Result<Vec<String>, String> {
    let path = recent_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    std::fs::write(&path, serde_json::to_string_pretty(&folders).map_err(err)?).map_err(err)?;
    app.emit("recent-changed", &folders).map_err(err)?;
    Ok(folders)
}

/// Folders the user opened or saved files in, most recent first.
#[tauri::command]
fn recent_folders(app: AppHandle) -> Vec<String> {
    read_recent(&app)
}

#[tauri::command]
fn add_recent_folder(app: AppHandle, dir: String) -> Result<Vec<String>, String> {
    let mut folders = read_recent(&app);
    if folders.first() == Some(&dir) {
        return Ok(folders);
    }
    folders.retain(|d| d != &dir);
    folders.insert(0, dir);
    folders.truncate(MAX_RECENT_FOLDERS);
    write_recent(&app, folders)
}

#[tauri::command]
fn remove_recent_folder(app: AppHandle, dir: String) -> Result<Vec<String>, String> {
    let mut folders = read_recent(&app);
    folders.retain(|d| d != &dir);
    write_recent(&app, folders)
}

/// Default place for new documents (~/Documents).
#[tauri::command]
fn documents_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().document_dir().or_else(|_| app.path().home_dir()).map_err(err)?;
    Ok(dir.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

fn focused_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

fn open_window(app: &AppHandle, path: Option<String>) -> tauri::Result<WebviewWindow> {
    let label = format!("doc-{}", WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst));
    let init = format!(
        "window.__MDL_INITIAL_FILE__ = {};",
        serde_json::to_string(&path).unwrap_or_else(|_| "null".into())
    );

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("md-light")
        .inner_size(900.0, 780.0)
        .min_inner_size(420.0, 320.0)
        .initialization_script(&init);

    // Cascade new windows like a regular document-based Mac app.
    let anchor = focused_window(app).and_then(|w| {
        let scale = w.scale_factor().ok()?;
        Some(w.outer_position().ok()?.to_logical::<f64>(scale))
    });
    // Mac: content reaches under the title bar; md-light draws its own (see src/titlebar.ts).
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 19.0));
    }
    builder = match anchor {
        Some(pos) => builder.position(pos.x + 26.0, pos.y + 26.0),
        None => builder.center(),
    };

    builder.build()
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
/// Hands files to an existing window (it loads them in place if it is still empty,
/// otherwise opens new windows), or opens a window per file if there is none.
fn open_files(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let target = focused_window(app).or_else(|| app.webview_windows().into_values().next());
    match target {
        Some(window) => {
            app.state::<AppState>().pending.lock().unwrap().extend(paths);
            let _ = window.set_focus();
            let _ = app.emit_to(window.label(), "files-pending", ());
        }
        None => {
            for path in paths {
                let _ = open_window(app, Some(path));
            }
        }
    }
}

/// Quits, first asking each window with unsaved changes (one at a time) what to do.
fn request_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let next = {
        let dirty = state.dirty.lock().unwrap();
        dirty.iter().find_map(|label| app.get_webview_window(label))
    };
    match next {
        Some(window) => {
            let _ = window.set_focus();
            let _ = app.emit_to(window.label(), "menu", "quit");
        }
        None => app.exit(0),
    }
}

fn absolute(path: &str) -> String {
    let p = Path::new(path);
    let abs: PathBuf = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().map(|d| d.join(p)).unwrap_or_else(|_| p.to_path_buf())
    };
    abs.to_string_lossy().into_owned()
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, text: &str, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new", "New", Some("CmdOrCtrl+N"))?)
        .item(&item("open", "Open…", Some("CmdOrCtrl+O"))?)
        .item(&item("add_folder", "Add Folder to Sidebar…", None)?)
        .separator()
        .item(&item("save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item("save_as", "Save As…", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&item("close", "Close Window", Some("CmdOrCtrl+W"))?);
    #[cfg(not(target_os = "macos"))]
    let file = file.separator().item(&item("quit", "Quit", Some("CmdOrCtrl+Q"))?);
    let file = file.build()?;

    // Undo/redo go through the editor's own history instead of the native undo stack.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item("undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .item(&item("redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all();
    #[cfg(not(target_os = "macos"))]
    let edit = edit.separator().item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?);
    let edit = edit.build()?;

    let paragraph = SubmenuBuilder::new(app, "Paragraph")
        .item(&item("h1", "Heading 1", Some("CmdOrCtrl+1"))?)
        .item(&item("h2", "Heading 2", Some("CmdOrCtrl+2"))?)
        .item(&item("h3", "Heading 3", Some("CmdOrCtrl+3"))?)
        .item(&item("h4", "Heading 4", Some("CmdOrCtrl+4"))?)
        .item(&item("h5", "Heading 5", Some("CmdOrCtrl+5"))?)
        .item(&item("h6", "Heading 6", Some("CmdOrCtrl+6"))?)
        .item(&item("paragraph", "Paragraph", Some("CmdOrCtrl+0"))?)
        .separator()
        .item(&item("quote", "Quote", Some("CmdOrCtrl+Alt+Q"))?)
        .item(&item("ordered_list", "Ordered List", Some("CmdOrCtrl+Alt+O"))?)
        .item(&item("bullet_list", "Unordered List", Some("CmdOrCtrl+Alt+U"))?)
        .item(&item("code_block", "Code Block", Some("CmdOrCtrl+Alt+C"))?)
        .item(&item("table", "Table", Some("CmdOrCtrl+Alt+T"))?)
        .item(&item("math_block", "Math Block", Some("CmdOrCtrl+Alt+B"))?)
        .item(&item("task_list", "Task List", Some("CmdOrCtrl+Alt+X"))?)
        .item(&item("callout", "Callout", None)?)
        .item(&item("mermaid", "Diagram (Mermaid)", None)?)
        .separator()
        .item(&item("hr", "Horizontal Line", None)?)
        .item(&item("toc", "Table of Contents", None)?)
        .item(&item("front_matter", "YAML Front Matter", None)?)
        .build()?;

    let format = SubmenuBuilder::new(app, "Format")
        .item(&item("bold", "Bold", Some("CmdOrCtrl+B"))?)
        .item(&item("italic", "Italic", Some("CmdOrCtrl+I"))?)
        .item(&item("code", "Code", Some("CmdOrCtrl+E"))?)
        .item(&item("strike", "Strikethrough", Some("CmdOrCtrl+Shift+X"))?)
        .item(&item("highlight", "Highlight", Some("CmdOrCtrl+Shift+H"))?)
        .item(&item("math_inline", "Inline Math", Some("Ctrl+M"))?)
        .separator()
        .item(&item("link", "Link", Some("CmdOrCtrl+K"))?)
        .item(&item("image", "Image…", Some("CmdOrCtrl+Shift+I"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("toggle_sidebar", "Sidebar", Some("CmdOrCtrl+Shift+L"))?)
        .item(&item("outline", "Outline", Some("CmdOrCtrl+Shift+1"))?)
        .separator()
        .item(&item("toggle_source", "Source Code Mode", Some("CmdOrCtrl+/"))?)
        .separator()
        .item(&item("zoom_in", "Zoom In", Some("CmdOrCtrl+="))?)
        .item(&item("zoom_out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&item("zoom_reset", "Actual Size", Some("CmdOrCtrl+Shift+0"))?)
        .separator()
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;

    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let menu = menu.item(
        &SubmenuBuilder::new(app, "md-light")
            .about(Some(AboutMetadata::default()))
            .separator()
            .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .item(&item("quit", "Quit md-light", Some("CmdOrCtrl+Q"))?)
            .build()?,
    );
    menu.items(&[&file, &edit, &paragraph, &format, &view, &window]).build()
}

fn handle_menu(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == "quit" {
        return request_quit(app);
    }
    if let Some(window) = focused_window(app) {
        let _ = app.emit_to(window.label(), "menu", id);
        return;
    }
    // No window (macOS keeps running after the last one closes).
    match id {
        "new" => {
            let _ = open_window(app, None);
        }
        "open" => {
            let handle = app.clone();
            app.dialog()
                .file()
                .add_filter("Markdown", MARKDOWN_EXTENSIONS)
                .pick_file(move |picked| {
                    if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
                        let _ = open_window(&handle, Some(path.to_string_lossy().into_owned()));
                    }
                });
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .menu(build_menu)
        .on_menu_event(handle_menu)
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            new_window,
            take_pending_files,
            set_dirty,
            continue_quit,
            copy_image,
            save_image,
            download_image,
            app_image_dir,
            load_settings,
            save_settings,
            list_dir,
            create_file,
            rename_file,
            recent_folders,
            add_recent_folder,
            remove_recent_folder,
            documents_dir
        ])
        .setup(|app| {
            // `md-light notes.md` (on macOS files arrive through RunEvent::Opened instead).
            let files: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .map(|a| absolute(&a))
                .collect();
            if files.is_empty() {
                open_window(app.handle(), None)?;
            } else {
                for file in files {
                    open_window(app.handle(), Some(file))?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                state.dirty.lock().unwrap().remove(window.label());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building md-light");

    app.run(handle_run_event);
}

fn handle_run_event(app: &AppHandle, event: RunEvent) {
    #[cfg(target_os = "macos")]
    match event {
        RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            open_files(app, paths);
        }
        RunEvent::Reopen { has_visible_windows, .. } => {
            if !has_visible_windows {
                let _ = open_window(app, None);
            }
        }
        // Like other Mac document apps, keep running when the last window closes.
        RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
        _ => {}
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("Lecture%201%2F%C3%BC.png"), "Lecture 1/ü.png");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn stores_without_clobbering() {
        let dir = std::env::temp_dir().join(format!("mdl-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = store(&dir, "image.png", b"one").unwrap();
        let same = store(&dir, "image.png", b"one").unwrap();
        let b = store(&dir, "image.png", b"two").unwrap();
        let weird = store(&dir, "a/b:c.png", b"x").unwrap();
        assert_eq!(a, same, "identical content is reused");
        assert!(b.ends_with("image-1.png"), "{b}");
        assert!(weird.ends_with("a_b_c.png"), "{weird}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn creates_lists_and_renames_files() {
        let dir = std::env::temp_dir().join(format!("mdl-ws-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let d = dir.to_string_lossy().to_string();
        use tauri::async_runtime::block_on as block;
        let a = block(create_file(d.clone(), "Notes".into())).unwrap();
        let b = block(create_file(d.clone(), "Notes".into())).unwrap();
        assert!(a.ends_with("Notes.md") && b.ends_with("Notes-1.md"), "{a} {b}");
        std::fs::create_dir_all(dir.join("Sub")).unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        std::fs::write(dir.join("image.png"), b"x").unwrap();
        let names: Vec<String> = block(list_dir(d.clone())).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["Sub", "Notes-1.md", "Notes.md"]);
        assert!(block(rename_file(b.clone(), a.clone())).is_err(), "never overwrites");
        let moved = dir.join("Sub/Renamed.md").to_string_lossy().to_string();
        block(rename_file(b, moved.clone())).unwrap();
        assert!(Path::new(&moved).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Needs network: `cargo test -- --ignored`
    #[test]
    #[ignore]
    fn downloads_online_image() {
        let dir = std::env::temp_dir().join(format!("mdl-dl-{}", std::process::id()));
        let url = "https://raw.githubusercontent.com/tauri-apps/tauri/dev/.github/splash.png".to_string();
        let path = tauri::async_runtime::block_on(download_image(url, dir.to_string_lossy().into())).unwrap();
        assert!(path.ends_with("splash.png"), "{path}");
        assert!(std::fs::metadata(&path).unwrap().len() > 100);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
