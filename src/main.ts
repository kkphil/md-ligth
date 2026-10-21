import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import '@milkdown/kit/prose/gapcursor/style/gapcursor.css'
import './style.css'

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { type BlockCommand, createEditor, type InlineCommand } from './editor'
import { fileName, native, platform } from './platform'
import * as source from './source'

declare global {
  interface Window { __MDL_INITIAL_FILE__?: string | null }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const editorEl = $<HTMLDivElement>('editor')
const sourceEl = $<HTMLTextAreaElement>('source')
const scroller = $<HTMLElement>('scroller')
const statusFile = $<HTMLSpanElement>('status-file')
const statusCount = $<HTMLSpanElement>('status-count')
const modeToggle = $<HTMLButtonElement>('mode-toggle')

// ---------------------------------------------------------------------------
// Document state
// ---------------------------------------------------------------------------

let filePath: string | null = null
let mode: 'rich' | 'source' = 'rich'
// While in source mode, the text and dirtiness at the moment we switched (or last saved).
let sourceBaseline = ''
let sourceBaselineDirty = false
let lastReportedDirty = false

const editor = await createEditor(editorEl, {
  onChange: scheduleRefresh,
  resolveImage: (src) => platform.resolveImage(src, filePath),
  openLink: (href) => platform.openLink(href),
})

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
  statusFile.textContent = filePath ?? 'Untitled'
  statusFile.title = filePath ?? ''
  document.body.classList.toggle('dirty', dirty)

  const text = mode === 'source' ? source.plainText(sourceEl.value) : editor.text()
  const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  statusCount.textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} · ${text.replace(/\s/g, '').length.toLocaleString()} characters`

  if (native && dirty !== lastReportedDirty) {
    lastReportedDirty = dirty
    void invoke('set_dirty', { dirty })
  }
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
  modeToggle.classList.toggle('active', mode === 'source')
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
    return true
  } catch (err) {
    alert(`Could not save ${path}\n\n${err}`)
    return false
  }
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

const BLOCKS = new Set<string>(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'paragraph', 'quote', 'bullet_list', 'ordered_list', 'code_block', 'hr', 'table'])
const INLINE = new Set<string>(['bold', 'italic', 'code', 'strike'])

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

modeToggle.addEventListener('click', () => run('toggle_source'))
sourceEl.addEventListener('input', () => {
  source.autosize(sourceEl)
  scheduleRefresh()
})
sourceEl.addEventListener('keydown', (e) => source.handleKey(sourceEl, e))
// Clicking the empty area below the text focuses the end of the document.
scroller.addEventListener('mousedown', (e) => {
  if (e.target !== scroller) return
  e.preventDefault()
  if (mode === 'source') sourceEl.focus()
  else editor.focus()
})

if (native) {
  const win = getCurrentWebviewWindow()
  await win.listen<string>('menu', (e) => run(e.payload))
  await win.listen('files-pending', () => takePendingFiles())
  // Dropping Markdown files onto a window opens them.
  await getCurrentWebview().onDragDropEvent(async (e) => {
    if (e.payload.type !== 'drop') return
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
    '=': 'zoom_in', '-': 'zoom_out', 'e': 'code', 'X': 'strike',
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
refresh()
editor.focus()
