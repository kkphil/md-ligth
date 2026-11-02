/**
 * Folders and files for the sidebar and the title popover: listing, creating,
 * renaming/moving, and the list of folders the user worked in.
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
const RECENT_KEY = 'mdl-recent-folders'

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

function memRecent(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null')
    if (Array.isArray(stored)) return stored
  } catch { /* ignore */ }
  return memfs.size ? ['/demo/Notes', '/demo/Uni'] : []
}

const recentListeners = new Set<(folders: string[]) => void>()
function memSetRecent(folders: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(folders)) } catch { /* ignore */ }
  recentListeners.forEach((cb) => cb(folders))
  return folders
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

  async recentFolders(): Promise<string[]> {
    if (native) return invoke<string[]>('recent_folders')
    return memRecent()
  },

  async addRecentFolder(dir: string): Promise<void> {
    if (native) {
      await invoke('add_recent_folder', { dir })
      return
    }
    const list = memRecent()
    if (list[0] !== dir) memSetRecent([dir, ...list.filter((d) => d !== dir)].slice(0, 30))
  },

  async removeRecentFolder(dir: string): Promise<void> {
    if (native) {
      await invoke('remove_recent_folder', { dir })
      return
    }
    memSetRecent(memRecent().filter((d) => d !== dir))
  },

  onRecentChanged(cb: (folders: string[]) => void) {
    if (native) void listen<string[]>('recent-changed', (e) => cb(e.payload))
    else recentListeners.add(cb)
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
