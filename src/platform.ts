/**
 * Thin layer over the host: the native Tauri app, or a plain browser
 * (handy for `npm run dev` and for trying md-light without installing it).
 */
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ask, message, open, save } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'

export const native = isTauri()

export interface OpenedFile {
  path: string
  content: string
}

export type CloseChoice = 'save' | 'discard' | 'cancel'

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }]

export const fileName = (path: string | null) =>
  path ? path.split(/[\\/]/).pop() || path : 'Untitled'

const dirName = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

// ---------------------------------------------------------------------------
// Browser fallback: File System Access API where available, otherwise
// <input type=file> for opening and a download for saving.
// ---------------------------------------------------------------------------

type FsHandle = {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
}
const handles = new Map<string, FsHandle>()

/** In-memory files for trying the sidebar in a browser: open the page with `?demo`. */
export const memfs = new Map<string, string>()
if (!native && new URLSearchParams(location.search).has('demo')) {
  memfs.set('/demo/Notes/Ideas.md', '# Ideas\n\n- A lightweight Markdown editor\n- ==Typora== feeling\n')
  memfs.set('/demo/Notes/Reading list.md', '# Reading list\n\n- [ ] Gödel, Escher, Bach\n- [x] The Pragmatic Programmer\n')
  memfs.set('/demo/Uni/VL_26_10_21.md', '# Vorlesung 21.10.\n\n## Komplexität\n\n$O(n \\log n)$ für Sortieren.\n\n## Graphen\n\nBFS und DFS.\n')
  memfs.set('/demo/Uni/Analysis/Blatt 1.md', '# Blatt 1\n\n$$\n\\sum_{k=1}^n k = \\frac{n(n+1)}{2}\n$$\n')
}
const fsAccess = 'showOpenFilePicker' in window
const pickerTypes = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }]

function registerHandle(handle: FsHandle) {
  const key = `${handle.name}`
  handles.set(key, handle)
  return key
}

function pickFileWithInput(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain'
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? { path: file.name, content: await file.text() } : null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------------------

export const platform = {
  async pickAndRead(): Promise<OpenedFile | null> {
    if (native) {
      const path = await open({ multiple: false, directory: false, filters: MD_FILTERS })
      if (!path) return null
      return { path, content: await this.read(path) }
    }
    if (fsAccess) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({ types: pickerTypes })
        const path = registerHandle(handle)
        return { path, content: await (await handle.getFile()).text() }
      } catch {
        return null
      }
    }
    return pickFileWithInput()
  },

  async read(path: string): Promise<string> {
    if (native) return invoke<string>('read_file', { path })
    if (memfs.has(path)) return memfs.get(path)!
    const handle = handles.get(path)
    if (!handle) throw new Error(`Cannot read ${path} in the browser`)
    return (await handle.getFile()).text()
  },

  /** Writes to `path`; returns false when the browser can only offer a download. */
  async write(path: string, content: string): Promise<boolean> {
    if (native) {
      await invoke('write_file', { path, contents: content })
      return true
    }
    if (path.startsWith('/demo/')) {
      memfs.set(path, content)
      return true
    }
    const handle = handles.get(path)
    if (!handle) {
      download(fileName(path), content)
      return false
    }
    const w = await handle.createWritable()
    await w.write(content)
    await w.close()
    return true
  },

  /** Asks where to save; returns the chosen path or null if cancelled. */
  async pickSavePath(suggested: string): Promise<string | null> {
    if (native) {
      const path = await save({ defaultPath: suggested, filters: MD_FILTERS })
      if (!path) return null
      return /\.[a-z0-9]+$/i.test(fileName(path)) ? path : `${path}.md`
    }
    if (fsAccess) {
      try {
        const handle = await (window as any).showSaveFilePicker({ suggestedName: fileName(suggested), types: pickerTypes })
        return registerHandle(handle)
      } catch {
        return null
      }
    }
    return fileName(suggested)
  },

  async askSaveChanges(name: string): Promise<CloseChoice> {
    const text = `Do you want to save the changes you made to “${name}”?`
    if (native) {
      const answer = await message(`${text}\n\nYour changes will be lost if you don’t save them.`, {
        title: 'md-light',
        kind: 'warning',
        buttons: { yes: 'Save', no: 'Don’t Save', cancel: 'Cancel' },
      })
      if (answer === 'Yes' || answer === 'Save') return 'save'
      if (answer === 'No' || answer === 'Don’t Save') return 'discard'
      return 'cancel'
    }
    if (window.confirm(`${text}\n\nOK = save, Cancel = more options`)) return 'save'
    return window.confirm('Discard your changes?') ? 'discard' : 'cancel'
  },

  async ask(text: string, okLabel: string): Promise<boolean> {
    if (native) return ask(text, { title: 'md-light', kind: 'info', okLabel, cancelLabel: 'Cancel' })
    return window.confirm(text)
  },

  /** Image files to insert: paths in the app, File objects in the browser. */
  async pickImages(): Promise<(string | File)[]> {
    if (native) {
      const picked = await open({ multiple: true, directory: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'avif', 'heic'] }] })
      return picked ?? []
    }
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true })
      input.onchange = () => resolve([...(input.files ?? [])])
      input.oncancel = () => resolve([])
      input.click()
    })
  },

  setTitle(title: string) {
    document.title = title
    if (native) void getCurrentWebviewWindow().setTitle(title)
  },

  /** Image sources relative to the document are loaded through Tauri's asset protocol. */
  resolveImage(src: string, docPath: string | null): string {
    if (!native || !src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return src
    let path = decodeURI(src)
    if (!path.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(path)) {
      if (!docPath) return src
      path = `${dirName(docPath)}/${path.replace(/^\.\//, '')}`
    }
    return convertFileSrc(path)
  },

  openLink(href: string) {
    if (!/^(https?|mailto):/i.test(href)) return
    if (native) void openUrl(href)
    else window.open(href, '_blank', 'noopener')
  },

  newWindow(path?: string) {
    if (native) void invoke('new_window', { path: path ?? null })
    else window.open(location.pathname, '_blank')
  },
}
