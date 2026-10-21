/**
 * The window's top bar, macOS document style: the file name in the middle
 * (click it to rename, move or – for an untitled document – save), and on the
 * right the word count, source mode, outline and sidebar buttons.
 */
import { native } from './platform'
import { basename, dirname, extname, join, stem } from './paths'
import { folderName, workspace } from './workspace'

export interface Stats { words: number; characters: number; charactersNoSpaces: number; paragraphs: number }

export interface TitlebarHooks {
  docPath(): string | null
  isDirty(): boolean
  /** Renames/moves the open file to `path`, or saves an untitled document there. */
  commit(path: string): Promise<boolean>
  stats(): Stats
  onToggleSidebar(): void
  onOutline(): void
  onToggleSource(): void
  sourceMode(): boolean
  sidebarTab(): 'files' | 'outline' | null
}

const icons = {
  doc: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M4 1.5h5.5L13 5v9.5H4z" fill="var(--bg)" stroke="currentColor" stroke-width="1.1"/><path d="M9.5 1.5V5H13" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M6 8h5M6 10h5M6 12h3.5" stroke="currentColor" stroke-width=".9" opacity=".6"/></svg>',
  chevron: '<svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  updown: '<svg viewBox="0 0 10 14" width="8" height="11"><path d="M2 5l3-3 3 3M2 9l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  outline: '<svg viewBox="0 0 18 16" width="17" height="15"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><rect x="6" y="2" width="11" height="2" rx="1"/><rect x="6" y="7" width="11" height="2" rx="1"/><rect x="6" y="12" width="11" height="2" rx="1"/></g></svg>',
  sidebar: '<svg viewBox="0 0 18 16" width="17" height="15"><rect x="1" y="1.5" width="16" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="1.7" y="2.2" width="5.3" height="11.6" rx="1.6" fill="currentColor"/></svg>',
  code: '<svg viewBox="0 0 18 16" width="17" height="15"><path d="M6 4L2 8l4 4M12 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

const STAT_LABELS: Record<keyof Stats | 'minutes', [string, string]> = {
  words: ['Word', 'Words'],
  characters: ['Character', 'Characters'],
  charactersNoSpaces: ['Character (no spaces)', 'Characters (no spaces)'],
  paragraphs: ['Paragraph', 'Paragraphs'],
  minutes: ['Min Read', 'Min Read'],
}
type StatKey = keyof typeof STAT_LABELS
const STAT_KEY = 'mdl-stat'

function statValue(stats: Stats, key: StatKey) {
  return key === 'minutes' ? Math.max(1, Math.round(stats.words / 230)) : stats[key]
}
const statText = (stats: Stats, key: StatKey) => {
  const n = statValue(stats, key)
  return `${n.toLocaleString()} ${STAT_LABELS[key][n === 1 ? 0 : 1]}`
}

export function createTitlebar(bar: HTMLElement, hooks: TitlebarHooks) {
  const isMac = /Mac/.test(navigator.userAgent)
  if (native && isMac) document.body.classList.add('mac-titlebar')

  bar.innerHTML = `
    <div class="tb-side tb-left" data-tauri-drag-region></div>
    <button type="button" class="tb-title" title="Rename, move or save">
      <span class="tb-doc-icon">${icons.doc}</span><span class="tb-name"></span><span class="tb-edited">— Edited</span>${icons.chevron}
    </button>
    <div class="tb-side tb-right" data-tauri-drag-region>
      <button type="button" class="tb-btn tb-stats" title="Document statistics"><span></span>${icons.updown}</button>
      <button type="button" class="tb-btn tb-source" title="Source code mode (⌘/)">${icons.code}</button>
      <button type="button" class="tb-btn tb-outline" title="Outline (⇧⌘1)">${icons.outline}</button>
      <button type="button" class="tb-btn tb-sidebar" title="Sidebar (⇧⌘L)">${icons.sidebar}</button>
    </div>`
  bar.setAttribute('data-tauri-drag-region', '')

  const q = <T extends HTMLElement>(sel: string) => bar.querySelector(sel) as T
  const titleBtn = q<HTMLButtonElement>('.tb-title')
  const nameEl = q<HTMLSpanElement>('.tb-name')
  const statsBtn = q<HTMLButtonElement>('.tb-stats')

  let statKey: StatKey = 'words'
  try { statKey = (localStorage.getItem(STAT_KEY) as StatKey) || 'words' } catch { /* ignore */ }
  if (!(statKey in STAT_LABELS)) statKey = 'words'

  // ------------------------------------------------------------ popovers

  let openPopup: { el: HTMLElement; close: (commit: boolean) => void } | null = null
  const closePopup = (commit = false) => openPopup?.close(commit)
  document.addEventListener('mousedown', (e) => {
    if (openPopup && !openPopup.el.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.tb-title, .tb-stats')) closePopup(true)
  }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openPopup) { e.preventDefault(); closePopup(false) } })

  function place(el: HTMLElement, anchor: HTMLElement, align: 'center' | 'right') {
    document.body.append(el)
    const r = anchor.getBoundingClientRect()
    const left = align === 'center' ? r.left + r.width / 2 - el.offsetWidth / 2 : r.right - el.offsetWidth
    el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - el.offsetWidth - 8))}px`
    el.style.top = `${r.bottom + 8}px`
  }

  async function showDocPopover() {
    if (openPopup) return closePopup(true)
    const path = hooks.docPath()
    const untitled = !path
    const ext = path ? extname(path) || '.md' : '.md'
    const folders = await workspace.recentFolders()
    const currentDir = path ? dirname(path) : folders[0] ?? (await workspace.documentsDir())
    const options = [currentDir, ...folders.filter((f) => f !== currentDir)]
    const names = options.map(folderName)
    const label = (dir: string, i: number) =>
      names.filter((n) => n === names[i]).length > 1 ? `${names[i]} — ${folderName(dirname(dir))}` : names[i]

    const el = document.createElement('div')
    el.className = 'popup doc-popover'
    el.innerHTML = `
      <form>
        <label><span>Name:</span><input name="name" spellcheck="false" autocomplete="off"></label>
        <label><span>Where:</span><select name="where"></select></label>
        <p class="doc-full"></p>
        ${untitled ? '<div class="doc-actions"><button type="submit" class="primary">Save</button></div>' : ''}
      </form>`
    const form = el.querySelector('form')!
    const input = form.elements.namedItem('name') as HTMLInputElement
    const select = form.elements.namedItem('where') as HTMLSelectElement
    const full = el.querySelector<HTMLParagraphElement>('.doc-full')!
    input.value = path ? stem(path) : 'Untitled'
    select.innerHTML = options.map((dir, i) => `<option value="${encodeURIComponent(dir)}" title="${dir.replace(/"/g, '&quot;')}">📁 ${label(dir, i).replace(/</g, '&lt;')}</option>`).join('')
      + '<option disabled>──────────</option><option value="__other">Other…</option>'
    let where = currentDir

    const target = () => {
      const name = input.value.trim().replace(/[/\\:]/g, '-').replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')
      return name ? join(where, `${name}${ext}`) : null
    }
    const showFull = () => { full.textContent = target() ?? '' }
    showFull()
    input.addEventListener('input', showFull)
    select.addEventListener('change', async () => {
      if (select.value === '__other') {
        const picked = await workspace.pickFolder()
        if (picked) {
          where = picked
          const opt = new Option(`📁 ${folderName(picked)}`, encodeURIComponent(picked))
          opt.title = picked
          select.add(opt, 0)
        }
        select.value = encodeURIComponent(where)
      } else {
        where = decodeURIComponent(select.value)
      }
      showFull()
      if (!untitled) void finish(true)
    })

    let done = false
    async function finish(commit: boolean) {
      if (done) return
      const next = target()
      if (commit && next && (untitled || next !== path)) {
        const ok = await hooks.commit(next)
        if (!ok) return input.focus()
      }
      done = true
      el.remove()
      openPopup = null
      titleBtn.classList.remove('open')
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); void finish(true) })

    openPopup = { el, close: (commit) => void finish(commit && !untitled) }
    titleBtn.classList.add('open')
    place(el, titleBtn, 'center')
    input.focus()
    input.select()
  }

  function showStatsMenu() {
    if (openPopup) return closePopup(false)
    const stats = hooks.stats()
    const el = document.createElement('div')
    el.className = 'popup stats-menu'
    for (const key of Object.keys(STAT_LABELS) as StatKey[]) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = key === statKey ? 'active' : ''
      row.innerHTML = '<span class="check">✓</span><span class="label"></span>'
      row.querySelector('.label')!.textContent = statText(stats, key)
      row.addEventListener('click', () => {
        statKey = key
        try { localStorage.setItem(STAT_KEY, key) } catch { /* ignore */ }
        closePopup(false)
        refresh()
      })
      el.append(row)
    }
    openPopup = { el, close: () => { el.remove(); openPopup = null } }
    place(el, statsBtn, 'right')
  }

  titleBtn.addEventListener('click', () => void showDocPopover())
  statsBtn.addEventListener('click', showStatsMenu)
  q('.tb-source').addEventListener('click', hooks.onToggleSource)
  q('.tb-outline').addEventListener('click', hooks.onOutline)
  q('.tb-sidebar').addEventListener('click', hooks.onToggleSidebar)

  function refresh() {
    const path = hooks.docPath()
    nameEl.textContent = path ? stem(basename(path)) : 'Untitled'
    titleBtn.title = path ?? 'Untitled — click to save'
    bar.classList.toggle('dirty', hooks.isDirty())
    statsBtn.querySelector('span')!.textContent = statText(hooks.stats(), statKey)
    q('.tb-source').classList.toggle('active', hooks.sourceMode())
    const tab = hooks.sidebarTab()
    q('.tb-outline').classList.toggle('active', tab === 'outline')
    q('.tb-sidebar').classList.toggle('active', tab === 'files')
  }

  return { refresh, showDocPopover }
}
