use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

#[cfg(target_os = "macos")]
use tauri::menu::AboutMetadata;
use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItem, SubmenuBuilder};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent, Wry,
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
        .select_all()
        .build()?;

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
        .item(&item("hr", "Horizontal Line", None)?)
        .build()?;

    let format = SubmenuBuilder::new(app, "Format")
        .item(&item("bold", "Bold", Some("CmdOrCtrl+B"))?)
        .item(&item("italic", "Italic", Some("CmdOrCtrl+I"))?)
        .item(&item("code", "Code", Some("CmdOrCtrl+E"))?)
        .item(&item("strike", "Strikethrough", Some("CmdOrCtrl+Shift+X"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
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
            continue_quit
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
