/**
 * Folders and files for the sidebar and the title popover: listing, creating,
 * renaming/moving, the folders the user pinned and the files opened recently.
 *
 * In the browser (`npm run dev`) there is no file system; `?demo` provides an
 * in-memory one so the sidebar can be tried out.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { basename, dirname, extname, join, stem } from './paths'
import { memfs, native } from './platform'

export interface DirEntry { name: string; path: string; dir: boolean }

const MD = /\.(md|markdown|mdown|mkd|txt)$/i

/** "folders": pinned by the user, kept until removed. "files": recently opened, newest first. */
export type PathKind = 'folders' | 'files'
const MAX_RECENT_FILES = 20

function memList(dir: string): DirEntry[] {
  const prefix = `${dir.replace(/\/$/, '')}/`
  const seen = new Map<string, DirEntry>()
  for (const path of memfs.keys()) {
    if (!path.startsWith(prefix)) continue
    const [head, ...rest] = path.slice(prefix.length).split('/')
    if (head.startsWith('.')) continue
    const isDir = rest.length > 0
    if (!isDir && !MD.test(head)) continue
    seen.set(head, { name: head, path: prefix + head, dir: isDir })
  }
  return [...seen.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function memLoad(kind: PathKind): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(`mdl-${kind}`) ?? 'null')
    if (Array.isArray(stored)) return stored
  } catch { /* ignore */ }
  return kind === 'folders' && memfs.size ? ['/demo/Notes', '/demo/Uni'] : []
}

const listeners: Record<PathKind, Set<(paths: string[]) => void>> = { folders: new Set(), files: new Set() }
function memSave(kind: PathKind, paths: string[]) {
  try { localStorage.setItem(`mdl-${kind}`, JSON.stringify(paths)) } catch { /* ignore */ }
  listeners[kind].forEach((cb) => cb(paths))
}

export const workspace = {
  async listDir(dir: string): Promise<DirEntry[]> {
    if (native) return invoke<DirEntry[]>('list_dir', { dir })
    return memList(dir)
  },

  /** Creates an empty Markdown file (never overwrites) and returns its path. */
  async createFile(dir: string, name: string): Promise<string> {
    if (native) return invoke<string>('create_file', { dir, name })
    let file = name.trim() || 'Untitled'
    if (!MD.test(file)) file += '.md'
    let path = join(dir, file)
    for (let n = 1; memfs.has(path); n++) path = join(dir, `${stem(file)}-${n}${extname(file)}`)
    memfs.set(path, '')
    return path
  },

  async rename(from: string, to: string): Promise<void> {
    if (native) return invoke('rename_file', { from, to })
    if (from === to) return
    if (memfs.has(to)) throw new Error(`“${basename(to)}” already exists`)
    memfs.set(to, memfs.get(from) ?? '')
    memfs.delete(from)
  },

  async list(kind: PathKind): Promise<string[]> {
    if (native) return invoke<string[]>('list_paths', { kind })
    return memLoad(kind)
  },

  /** Pins a folder, or records a file as recently opened. */
  async add(kind: PathKind, path: string): Promise<void> {
    if (native) {
      await invoke('add_path', { kind, path })
      return
    }
    const list = memLoad(kind)
    if (kind === 'folders') {
      if (!list.includes(path)) memSave(kind, [...list, path])
    } else if (list[0] !== path) {
      memSave(kind, [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENT_FILES))
    }
  },

  async remove(kind: PathKind, path: string): Promise<void> {
    if (native) {
      await invoke('remove_path', { kind, path })
      return
    }
    memSave(kind, memLoad(kind).filter((p) => p !== path))
  },

  /** Keeps a renamed/moved file in the recent list at its place. */
  async renameRecent(from: string, to: string): Promise<void> {
    if (native) {
      await invoke('rename_path', { kind: 'files', from, to })
      return
    }
    memSave('files', memLoad('files').map((p) => (p === from ? to : p)))
  },

  onChanged(kind: PathKind, cb: (paths: string[]) => void) {
    if (native) void listen<string[]>(kind === 'folders' ? 'folders-changed' : 'recent-files-changed', (e) => cb(e.payload))
    else listeners[kind].add(cb)
  },

  async pickFolder(): Promise<string | null> {
    if (native) {
      const dir = await open({ directory: true, multiple: false })
      return typeof dir === 'string' ? dir : null
    }
    const dir = window.prompt('Folder path (demo file system):', '/demo/New Folder')
    if (dir) memfs.set(join(dir, '.keep'), '')
    return dir
  },

  async documentsDir(): Promise<string> {
    if (native) return invoke<string>('documents_dir')
    return '/demo/Notes'
  },
}

export const folderName = (dir: string) => basename(dir) || dir
export const parentName = (dir: string) => basename(dirname(dir))
