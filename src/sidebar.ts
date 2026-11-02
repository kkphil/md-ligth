/**
 * Collapsible sidebar: every folder the user opened or saved files in (with
 * its Markdown files and subfolders, and a "+" to start a new file there),
 * plus an outline of the open document.
 */
import { dirname, stem } from './paths'
import { type DirEntry, folderName, workspace } from './workspace'

export interface Heading { level: number; text: string; pos: number }

export interface SidebarHooks {
  currentPath(): string | null
  open(path: string): void
  headings(): Heading[]
  goToHeading(h: Heading): void
  onLayoutChange(): void
}

type Tab = 'files' | 'outline'
const STATE_KEY = 'mdl-sidebar'
const icons = {
  folder: '<svg viewBox="0 0 16 14" width="15" height="13"><path d="M1 3a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.6h6.2A1.5 1.5 0 0 1 15 4.6v7A1.5 1.5 0 0 1 13.5 13h-11A1.5 1.5 0 0 1 1 11.5z" fill="currentColor"/></svg>',
  file: '<svg viewBox="0 0 14 16" width="12" height="14"><path d="M2.5 1h6L12 4.5V15h-9.5z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8.5 1v3.5H12" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  chevron: '<svg viewBox="0 0 10 10" width="9" height="9"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

interface Persisted { tab: Tab | null; width: number; expanded: string[] }

function loadState(): Persisted {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null')
    if (s && typeof s === 'object') return { tab: s.tab ?? null, width: s.width || 260, expanded: Array.isArray(s.expanded) ? s.expanded : [] }
  } catch { /* ignore */ }
  return { tab: null, width: 260, expanded: [] }
}

export function createSidebar(el: HTMLElement, hooks: SidebarHooks) {
  const state = loadState()
  const expanded = new Set(state.expanded)
  const listings = new Map<string, DirEntry[]>()
  let folders: string[] = []
  let creatingIn: string | null = null

  el.innerHTML = `
    <div class="sb-tabs">
      <button type="button" data-tab="files">Folders</button>
      <button type="button" data-tab="outline">Outline</button>
    </div>
    <div class="sb-panel sb-files"><div class="sb-tree"></div>
      <button type="button" class="sb-add">+ Add Folder…</button>
    </div>
    <div class="sb-panel sb-outline"></div>
    <div class="sb-resizer" title="Drag to resize"></div>`
  const tree = el.querySelector<HTMLDivElement>('.sb-tree')!
  const outline = el.querySelector<HTMLDivElement>('.sb-outline')!

  const save = () => {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ tab: state.tab, width: state.width, expanded: [...expanded] })) } catch { /* ignore */ }
  }

  function applyLayout() {
    el.hidden = !state.tab
    el.style.width = `${state.width}px`
    el.dataset.tab = state.tab ?? ''
    el.querySelectorAll<HTMLButtonElement>('.sb-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab))
    if (state.tab === 'outline') renderOutline()
    hooks.onLayoutChange()
  }

  // ------------------------------------------------------------ folders

  async function load(dir: string) {
    try {
      listings.set(dir, await workspace.listDir(dir))
    } catch {
      listings.set(dir, [])
    }
  }

  function row(depth: number, cls: string, html: string) {
    const r = document.createElement('div')
    r.className = `sb-row ${cls}`
    r.style.paddingLeft = `${8 + depth * 14}px`
    r.innerHTML = html
    return r
  }

  function renderDir(dir: string, depth: number, top: boolean): HTMLElement[] {
    const open = expanded.has(dir)
    const current = hooks.currentPath()
    const head = row(depth, `sb-folder${open ? ' open' : ''}${top ? ' top' : ''}`,
      `<span class="sb-chevron">${icons.chevron}</span><span class="sb-icon">${icons.folder}</span><span class="sb-name"></span>
       <span class="sb-actions"><button type="button" data-act="new" title="New file in this folder">+</button>${top ? '<button type="button" data-act="remove" title="Remove from sidebar">×</button>' : ''}</span>`)
    head.querySelector('.sb-name')!.textContent = folderName(dir)
    head.title = dir
    head.addEventListener('click', async (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
      if (act === 'new') return startCreate(dir)
      if (act === 'remove') {
        await workspace.removeRecentFolder(dir)
        return refresh()
      }
      if (expanded.has(dir)) expanded.delete(dir)
      else {
        expanded.add(dir)
        await load(dir)
      }
      save()
      render()
    })
    const out: HTMLElement[] = [head]
    if (!open) return out

    if (creatingIn === dir) {
      const r = row(depth + 1, 'sb-file sb-creating', `<span class="sb-icon">${icons.file}</span><input value="Untitled" spellcheck="false">`)
      const input = r.querySelector('input')!
      let finished = false
      const finish = async (create: boolean) => {
        if (finished) return
        finished = true
        creatingIn = null
        if (create && input.value.trim()) {
          const path = await workspace.createFile(dir, input.value.trim())
          await load(dir)
          hooks.open(path)
        }
        render()
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); void finish(true) }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void finish(false) }
      })
      input.addEventListener('blur', () => void finish(true))
      out.push(r)
      requestAnimationFrame(() => { input.focus(); input.select() })
    }

    const entries = listings.get(dir)
    if (!entries) {
      out.push(row(depth + 1, 'sb-empty', 'Loading…'))
      void load(dir).then(render)
      return out
    }
    for (const entry of entries) {
      if (entry.dir) {
        out.push(...renderDir(entry.path, depth + 1, false))
        continue
      }
      const r = row(depth + 1, `sb-file${entry.path === current ? ' current' : ''}`, `<span class="sb-icon">${icons.file}</span><span class="sb-name"></span>`)
      r.querySelector('.sb-name')!.textContent = stem(entry.name)
      r.title = entry.path
      r.addEventListener('click', () => hooks.open(entry.path))
      out.push(r)
    }
    if (!entries.length && creatingIn !== dir) out.push(row(depth + 1, 'sb-empty', 'No Markdown files'))
    return out
  }

  function render() {
    if (!folders.length) {
      tree.innerHTML = '<p class="sb-hint">Folders you open or save files in appear here.</p>'
      return
    }
    tree.replaceChildren(...folders.flatMap((dir) => renderDir(dir, 0, true)))
  }

  function startCreate(dir: string) {
    creatingIn = dir
    expanded.add(dir)
    save()
    void load(dir).then(render)
  }

  /** Re-reads the folder list and every expanded folder. */
  async function refresh() {
    folders = await workspace.recentFolders()
    await Promise.all([...expanded].map(load))
    render()
  }

  /** Expands the folders leading to `path` and highlights it. */
  async function reveal(path: string) {
    const dir = dirname(path)
    for (const top of folders) {
      if (dir !== top && !dir.startsWith(`${top}/`)) continue
      for (let d = dir; d.length >= top.length; d = dirname(d)) {
        expanded.add(d)
        if (d === top) break
      }
    }
    if (!folders.length || !folders.includes(dir)) folders = await workspace.recentFolders()
    expanded.add(dir)
    save()
    await refresh()
    tree.querySelector('.sb-file.current')?.scrollIntoView({ block: 'nearest' })
  }

  // ------------------------------------------------------------ outline

  function renderOutline() {
    if (state.tab !== 'outline') return
    const headings = hooks.headings()
    if (!headings.length) {
      outline.innerHTML = '<p class="sb-hint">Headings of this document appear here.</p>'
      return
    }
    const min = Math.min(...headings.map((h) => h.level))
    outline.replaceChildren(...headings.map((h) => {
      const r = document.createElement('div')
      r.className = `sb-row sb-heading level-${h.level}`
      r.style.paddingLeft = `${10 + (h.level - min) * 14}px`
      r.textContent = h.text || 'Untitled'
      r.addEventListener('click', () => hooks.goToHeading(h))
      return r
    }))
  }

  // ------------------------------------------------------------ wiring

  el.querySelectorAll<HTMLButtonElement>('.sb-tabs button').forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.tab as Tab)))
  el.querySelector('.sb-add')!.addEventListener('click', async () => {
    const dir = await workspace.pickFolder()
    if (!dir) return
    await workspace.addRecentFolder(dir)
    expanded.add(dir)
    save()
    await refresh()
  })

  const resizer = el.querySelector<HTMLDivElement>('.sb-resizer')!
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    resizer.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = state.width
    const move = (ev: PointerEvent) => {
      state.width = Math.max(180, Math.min(480, startW + ev.clientX - startX))
      el.style.width = `${state.width}px`
    }
    const up = () => {
      resizer.removeEventListener('pointermove', move)
      resizer.removeEventListener('pointerup', up)
      save()
    }
    resizer.addEventListener('pointermove', move)
    resizer.addEventListener('pointerup', up)
  })

  workspace.onRecentChanged((list) => {
    folders = list
    render()
  })
  window.addEventListener('focus', () => { if (state.tab === 'files') void refresh() })

  function show(tab: Tab) {
    state.tab = tab
    save()
    applyLayout()
    if (tab === 'files') void refresh()
  }

  /** The sidebar button: open on the folder list, or close. */
  function toggle(tab: Tab = 'files') {
    if (state.tab === tab) state.tab = null
    else state.tab = tab
    save()
    applyLayout()
    if (state.tab === 'files') void refresh()
  }

  applyLayout()
  void refresh()

  return {
    toggle,
    show,
    refresh,
    reveal,
    refreshOutline: renderOutline,
    tab: () => state.tab,
  }
}
