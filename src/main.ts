import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import './style.css'

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { BLOCK_COMMANDS, type BlockCommand, createEditor, INLINE_COMMANDS, type InlineCommand } from './editor'
import { IMAGE_EXT, type ImageSource, imageAlt, placeImage } from './images'
import { fileName, native, platform } from './platform'
import { applyAppearance, loadSettings, onSettingsChanged, saveSettings, type Settings } from './settings'
import { createSettingsDialog } from './settings-ui'
import { createSidebar, type Heading } from './sidebar'
import * as source from './source'
import { createTitlebar, type Stats } from './titlebar'
import { dirname } from './paths'
import { workspace } from './workspace'

declare global {
  interface Window { __MDL_INITIAL_FILE__?: string | null }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const editorEl = $<HTMLDivElement>('editor')
const sourceEl = $<HTMLTextAreaElement>('source')
const scroller = $<HTMLElement>('scroller')

// ---------------------------------------------------------------------------
// Document state
// ---------------------------------------------------------------------------

let filePath: string | null = null
let mode: 'rich' | 'source' = 'rich'
// While in source mode, the text and dirtiness at the moment we switched (or last saved).
let sourceBaseline = ''
let sourceBaselineDirty = false
let lastReportedDirty = false

let settings: Settings = await loadSettings()
applyAppearance(settings)

const editor = await createEditor(editorEl, {
  onChange: scheduleRefresh,
  resolveImage: (src) => platform.resolveImage(src, filePath),
  openLink: (href) => platform.openLink(href),
  onCommand: (id) => void run(id),
  onImageFiles: (files, pos) => void insertImages(files.map((f) => ({ kind: 'data', data: f, name: f.name })), pos),
  onPastedImageUrls: (urls) => void localizeOnlineImages(urls),
})

function applySettings(next: Settings) {
  settings = next
  applyAppearance(settings)
  editor.setSpellcheck(settings.spellcheck)
  sourceEl.spellcheck = settings.spellcheck
  settingsDialog.refresh()
  scheduleRefresh()
}
const settingsDialog = createSettingsDialog(() => settings, (next) => {
  applySettings(next)
  void saveSettings(next)
})
onSettingsChanged(applySettings)

const currentMarkdown = () => (mode === 'source' ? sourceEl.value : editor.getMarkdown())

const isDirty = () =>
  mode === 'source' ? sourceBaselineDirty || sourceEl.value !== sourceBaseline : editor.isDirty()

function markClean() {
  if (mode === 'source') {
    sourceBaseline = sourceEl.value
    sourceBaselineDirty = false
  } else {
    editor.markClean()
  }
}

const isPristine = () =>
  filePath === null && !isDirty() && (mode === 'source' ? sourceEl.value.trim() === '' : editor.isEmpty())

// ---------------------------------------------------------------------------
// Title bar and sidebar
// ---------------------------------------------------------------------------

function stats(): Stats {
  const rich = mode === 'rich' ? editor.stats() : null
  const text = rich ? rich.text : source.plainText(sourceEl.value)
  const paragraphs = rich ? rich.paragraphs : sourceEl.value.split(/\n\s*\n/).filter((b) => b.trim()).length
  return {
    words: text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0,
    characters: text.replace(/\n/g, '').length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    paragraphs,
  }
}

function headings(): Heading[] {
  if (mode === 'rich') return editor.headings()
  const out: Heading[] = []
  let fence = false
  let offset = 0
  for (const line of sourceEl.value.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const m = fence ? null : /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (m) out.push({ level: m[1].length, text: m[2], pos: offset })
    offset += line.length + 1
  }
  return out
}

function goToHeading(h: Heading) {
  if (mode === 'rich') return editor.goTo(h.pos)
  sourceEl.focus()
  sourceEl.setSelectionRange(h.pos, h.pos)
  const line = sourceEl.value.slice(0, h.pos).split('\n').length - 1
  const lineHeight = parseFloat(getComputedStyle(sourceEl).lineHeight) || 24
  scroller.scrollTo({ top: sourceEl.offsetTop + line * lineHeight - 16, behavior: 'smooth' })
}

/** Remembers the file's folder for the sidebar and highlights the file there. */
function noteFile(path: string) {
  if (!path.includes('/') && !path.includes('\\')) return // browser download, no real path
  void workspace.addRecentFolder(dirname(path)).then(() => sidebar.reveal(path))
}

const titlebar = createTitlebar($('titlebar'), {
  docPath: () => filePath,
  isDirty,
  commit: (path) => (filePath ? moveTo(path) : saveNewAt(path)),
  stats,
  onToggleSidebar: () => sidebar.toggle('files'),
  onOutline: () => sidebar.toggle('outline'),
  onToggleSource: () => void run('toggle_source'),
  sourceMode: () => mode === 'source',
  sidebarTab: () => sidebar.tab(),
})

const sidebar = createSidebar($('sidebar'), {
  currentPath: () => filePath,
  open: (path) => void switchTo(path),
  headings,
  goToHeading,
  onLayoutChange: () => queueMicrotask(() => titlebar.refresh()),
})

// ---------------------------------------------------------------------------
// Title, status bar, word count
// ---------------------------------------------------------------------------

let refreshQueued = false
function scheduleRefresh() {
  if (refreshQueued) return
  refreshQueued = true
  requestAnimationFrame(() => {
    refreshQueued = false
    refresh()
  })
}

function refresh() {
  const dirty = isDirty()
  const name = fileName(filePath)
  platform.setTitle(`${name}${dirty ? ' — Edited' : ''}`)
  document.body.classList.toggle('dirty', dirty)
  titlebar.refresh()
  sidebar.refreshOutline()

  if (native && dirty !== lastReportedDirty) {
    lastReportedDirty = dirty
    void invoke('set_dirty', { dirty })
  }
  scheduleAutoSave(dirty)
}

let autoSaveTimer: number | undefined
function scheduleAutoSave(dirty: boolean) {
  clearTimeout(autoSaveTimer)
  if (!settings.autoSave || !dirty || !filePath) return
  autoSaveTimer = window.setTimeout(() => { if (isDirty()) void saveFile() }, 1500)
}

// ---------------------------------------------------------------------------
// Rich ⇄ source mode (⌘/)
// ---------------------------------------------------------------------------

function scrollRatio() {
  const max = scroller.scrollHeight - scroller.clientHeight
  return max > 0 ? scroller.scrollTop / max : 0
}
function restoreScroll(ratio: number) {
  scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight)
}

function setMode(next: 'rich' | 'source') {
  if (next === mode) return
  const ratio = scrollRatio()
  if (next === 'source') {
    const md = editor.getMarkdown()
    sourceBaselineDirty = editor.isDirty()
    sourceBaseline = md
    sourceEl.value = md
    mode = 'source'
    editorEl.hidden = true
    sourceEl.hidden = false
    source.autosize(sourceEl)
    sourceEl.focus()
    sourceEl.setSelectionRange(0, 0)
  } else {
    const dirty = isDirty()
    if (sourceEl.value !== sourceBaseline) editor.setMarkdown(sourceEl.value, false)
    if (!dirty) editor.markClean()
    mode = 'rich'
    sourceEl.hidden = true
    editorEl.hidden = false
    editor.focus()
  }
  document.body.dataset.mode = mode
  restoreScroll(ratio)
  refresh()
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function load(path: string, content: string) {
  filePath = path
  if (mode === 'source') {
    sourceEl.value = content
    source.autosize(sourceEl)
    sourceBaseline = content
    sourceBaselineDirty = false
  } else {
    editor.setMarkdown(content)
  }
  scroller.scrollTop = 0
  refresh()
  noteFile(path)
}

/** Opens `path` in this window (from the sidebar), asking about unsaved changes first. */
async function switchTo(path: string) {
  if (path === filePath) return
  if (isDirty()) {
    const choice = await platform.askSaveChanges(fileName(filePath))
    if (choice === 'cancel' || (choice === 'save' && !(await saveFile()))) return
  }
  try {
    load(path, await platform.read(path))
    if (mode === 'rich') editor.focus()
  } catch (err) {
    alert(`Could not open ${path}\n\n${err}`)
  }
}

/** Title popover on a saved file: rename and/or move it. */
async function moveTo(path: string): Promise<boolean> {
  if (!filePath || path === filePath) return true
  try {
    await workspace.rename(filePath, path)
    filePath = path
    refresh()
    noteFile(path)
    void sidebar.refresh()
    return true
  } catch (err) {
    alert(`Could not rename the file.\n\n${err}`)
    return false
  }
}

/** Title popover on an untitled document: save it at `path` (never silently overwriting). */
async function saveNewAt(path: string): Promise<boolean> {
  const siblings = await workspace.listDir(dirname(path)).catch(() => [])
  if (siblings.some((e) => e.path === path) && !(await platform.ask(`“${fileName(path)}” already exists. Replace it?`, 'Replace'))) return false
  return writeTo(path)
}

/** Opens a file here if this window is an untouched blank document, otherwise in a new window. */
async function openPath(path: string) {
  if (!isPristine()) return platform.newWindow(path)
  try {
    load(path, await platform.read(path))
  } catch (err) {
    alert(`Could not open ${path}\n\n${err}`)
  }
}

async function openDialog() {
  const picked = await platform.pickAndRead()
  if (!picked) return
  if (isPristine()) load(picked.path, picked.content)
  else platform.newWindow(picked.path)
}

async function saveAs(): Promise<boolean> {
  const path = await platform.pickSavePath(filePath ?? 'Untitled.md')
  if (!path) return false
  return writeTo(path)
}

async function saveFile(): Promise<boolean> {
  return filePath ? writeTo(filePath) : saveAs()
}

async function writeTo(path: string): Promise<boolean> {
  try {
    let md = currentMarkdown()
    if (!md.endsWith('\n')) md += '\n'
    const persisted = await platform.write(path, md)
    if (!persisted) return false
    filePath = path
    markClean()
    refresh()
    noteFile(path)
    return true
  } catch (err) {
    alert(`Could not save ${path}\n\n${err}`)
    return false
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Images go next to the document, so an untitled one has to be saved first. */
async function ensureSaved(): Promise<string | null> {
  const ok = await platform.ask('Save this document first? Images are stored relative to the document’s location.', 'Save…')
  if (!ok) return null
  return (await saveAs()) ? filePath : null
}

function frontMatterFolder() {
  if (mode === 'rich') return editor.frontMatter('typora-copy-images-to')
  const m = /^---\n[\s\S]*?^typora-copy-images-to:\s*(.+?)\s*$[\s\S]*?^---$/m.exec(sourceEl.value)
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : null
}

/** Copies/saves images according to the settings and inserts them (at `pos` or the caret). */
async function insertImages(sources: ImageSource[], pos?: number) {
  for (const image of sources) {
    try {
      const src = await placeImage(image, { settings, docPath: filePath, frontMatterFolder: frontMatterFolder(), ensureSaved })
      if (!src) continue
      const alt = image.kind === 'data' ? imageAlt(image.name) || imageAlt(src) : imageAlt(src)
      if (mode === 'source') {
        const at = sourceEl.selectionStart
        sourceEl.setRangeText(`![${alt}](${src})`, at, sourceEl.selectionEnd, 'end')
        sourceEl.dispatchEvent(new Event('input'))
      } else {
        editor.insertImage(src, alt, pos)
        pos = undefined
      }
    } catch (err) {
      alert(`Could not insert the image.\n\n${err}`)
    }
  }
}

/** "Apply above rules to online images": download images that came in with pasted web content. */
async function localizeOnlineImages(urls: string[]) {
  if (!native || !settings.imageApplyOnline || mode !== 'rich') return
  for (const url of new Set(urls)) {
    try {
      const local = await placeImage({ kind: 'url', url }, { settings, docPath: filePath, frontMatterFolder: frontMatterFolder(), ensureSaved })
      if (local && local !== url) editor.replaceImageSrc(url, local)
    } catch (err) {
      console.warn('Could not download', url, err)
    }
  }
}

async function insertImageDialog() {
  const picked = await platform.pickImages()
  if (!picked.length) return
  await insertImages(picked.map((p): ImageSource => (typeof p === 'string' ? { kind: 'file', path: p } : { kind: 'data', data: p, name: p.name })))
}

/** Resolves true when the window may close (saved, discarded or nothing to save). */
async function confirmClose(): Promise<boolean> {
  if (!isDirty()) return true
  const choice = await platform.askSaveChanges(fileName(filePath))
  if (choice === 'cancel') return false
  if (choice === 'save') return saveFile()
  return true
}

// ---------------------------------------------------------------------------
// Commands (menu items in the app, keyboard shortcuts in the browser)
// ---------------------------------------------------------------------------

const ZOOM_KEY = 'mdl-zoom'
let zoom = Number(safeGet(ZOOM_KEY)) || 1
applyZoom()
function applyZoom() {
  document.documentElement.style.setProperty('--zoom', String(zoom))
  safeSet(ZOOM_KEY, String(zoom))
}
function safeGet(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function safeSet(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* ignore */ } }

const BLOCKS = new Set(BLOCK_COMMANDS)
const INLINE = new Set(INLINE_COMMANDS)

async function run(command: string) {
  if (BLOCKS.has(command)) {
    if (mode === 'source') source.block(sourceEl, command as BlockCommand)
    else editor.block(command as BlockCommand)
    return scheduleRefresh()
  }
  if (INLINE.has(command)) {
    if (mode === 'source') source.inline(sourceEl, command as InlineCommand)
    else editor.inline(command as InlineCommand)
    return scheduleRefresh()
  }
  switch (command) {
    case 'new': return platform.newWindow()
    case 'open': return openDialog()
    case 'save': return void saveFile()
    case 'save_as': return void saveAs()
    case 'toggle_source': return setMode(mode === 'rich' ? 'source' : 'rich')
    case 'image': return insertImageDialog()
    case 'settings': return settingsDialog.open()
    case 'toggle_sidebar': return sidebar.toggle('files')
    case 'outline': return sidebar.toggle('outline')
    case 'add_folder': {
      const dir = await workspace.pickFolder()
      if (dir) await workspace.addRecentFolder(dir)
      return sidebar.show('files')
    }
    case 'undo': return mode === 'source' ? void document.execCommand('undo') : editor.undo()
    case 'redo': return mode === 'source' ? void document.execCommand('redo') : editor.redo()
    case 'zoom_in': zoom = Math.min(2, +(zoom + 0.1).toFixed(2)); return applyZoom()
    case 'zoom_out': zoom = Math.max(0.6, +(zoom - 0.1).toFixed(2)); return applyZoom()
    case 'zoom_reset': zoom = 1; return applyZoom()
    case 'close': {
      if (await confirmClose()) await getCurrentWebviewWindow().destroy()
      return
    }
    case 'quit': {
      // Sent by the app when quitting with unsaved documents, one window at a time.
      if (await confirmClose()) {
        await invoke('set_dirty', { dirty: false })
        await invoke('continue_quit')
      }
      return
    }
  }
}

sourceEl.addEventListener('input', () => {
  source.autosize(sourceEl)
  scheduleRefresh()
})
sourceEl.addEventListener('keydown', (e) => source.handleKey(sourceEl, e))
// Clicking the empty area below the text focuses the end of the document.
scroller.addEventListener('mousedown', (e) => {
  if (e.target !== scroller) return
  e.preventDefault()
  if (mode === 'source') {
    sourceEl.focus()
    sourceEl.setSelectionRange(sourceEl.value.length, sourceEl.value.length)
  } else {
    editor.focusEnd()
  }
})

if (native) {
  const win = getCurrentWebviewWindow()
  await win.listen<string>('menu', (e) => run(e.payload))
  await win.listen('files-pending', () => takePendingFiles())
  // Dropped Markdown files open; dropped images are inserted where they land.
  await getCurrentWebview().onDragDropEvent(async (e) => {
    if (e.payload.type !== 'drop') return
    const images = e.payload.paths.filter((p) => IMAGE_EXT.test(p))
    if (images.length) {
      const { x, y } = e.payload.position
      const pos = editor.posAtCoords(x / devicePixelRatio, y / devicePixelRatio) ?? undefined
      await insertImages(images.map((path) => ({ kind: 'file', path })), pos)
    }
    for (const path of e.payload.paths) if (/\.(md|markdown|mdown|mkd|txt)$/i.test(path)) await openPath(path)
  })
  await win.onCloseRequested(async (e) => {
    if (!(await confirmClose())) e.preventDefault()
  })
  if (window.__MDL_INITIAL_FILE__) await openPath(window.__MDL_INITIAL_FILE__)
  await takePendingFiles()
} else {
  // In the browser there is no native menu, so mirror its shortcuts here.
  const shortcuts: Record<string, string> = {
    'o': 'open', 's': 'save', 'S': 'save_as', '/': 'toggle_source',
    '1': 'h1', '2': 'h2', '3': 'h3', '4': 'h4', '5': 'h5', '6': 'h6', '0': 'paragraph',
    '=': 'zoom_in', '-': 'zoom_out', 'e': 'code', 'X': 'strike', 'H': 'highlight', 'k': 'link',
    'm': 'math_inline', 'B': 'math_block', ',': 'settings', 'I': 'image', 'L': 'toggle_sidebar', '!': 'outline',
  }
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return
    const command = shortcuts[e.shiftKey ? e.key.toUpperCase() : e.key]
    if (!command) return
    e.preventDefault()
    void run(command)
  })
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault()
  })
}

async function takePendingFiles() {
  const paths = await invoke<string[]>('take_pending_files')
  for (const path of paths) await openPath(path)
}

document.body.dataset.mode = mode
applySettings(settings)
refresh()
editor.focus()
