/** Floating UI inside the editor: the Notion-style `/` menu and the link editor. */
import type { Mark, MarkType } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

// ---------------------------------------------------------------- slash menu

interface SlashItem { id: string; label: string; hint: string; icon: string; keywords: string }

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'paragraph', label: 'Text', hint: 'Plain paragraph', icon: '¶', keywords: 'text paragraph absatz' },
  { id: 'h1', label: 'Heading 1', hint: '#', icon: 'H1', keywords: 'heading title überschrift h1' },
  { id: 'h2', label: 'Heading 2', hint: '##', icon: 'H2', keywords: 'heading subtitle überschrift h2' },
  { id: 'h3', label: 'Heading 3', hint: '###', icon: 'H3', keywords: 'heading überschrift h3' },
  { id: 'bullet_list', label: 'Bulleted list', hint: '-', icon: '•', keywords: 'bullet list unordered liste aufzählung' },
  { id: 'ordered_list', label: 'Numbered list', hint: '1.', icon: '1.', keywords: 'numbered ordered list liste nummeriert' },
  { id: 'task_list', label: 'To-do list', hint: '- [ ]', icon: '☐', keywords: 'todo task checkbox aufgabe liste' },
  { id: 'quote', label: 'Quote', hint: '>', icon: '❝', keywords: 'quote blockquote zitat' },
  { id: 'callout', label: 'Callout', hint: '> [!NOTE]', icon: 'ⓘ', keywords: 'callout note tip warning alert hinweis' },
  { id: 'code_block', label: 'Code block', hint: '```', icon: '{}', keywords: 'code block snippet programm' },
  { id: 'math_block', label: 'Math block', hint: '$$', icon: '∑', keywords: 'math latex formula equation formel mathe katex' },
  { id: 'math_inline', label: 'Inline math', hint: '$x$', icon: '𝑥', keywords: 'math latex inline formel' },
  { id: 'table', label: 'Table', hint: '| a | b |', icon: '▦', keywords: 'table grid tabelle' },
  { id: 'image', label: 'Image…', hint: '![]()', icon: '🖼', keywords: 'image picture photo bild foto' },
  { id: 'hr', label: 'Divider', hint: '---', icon: '—', keywords: 'divider horizontal rule line trennlinie' },
  { id: 'toc', label: 'Table of contents', hint: '[TOC]', icon: '☰', keywords: 'toc table of contents inhaltsverzeichnis' },
  { id: 'mermaid', label: 'Diagram', hint: '```mermaid', icon: '⧉', keywords: 'mermaid diagram chart flowchart diagramm' },
  { id: 'front_matter', label: 'Front matter', hint: '---', icon: '⚙', keywords: 'yaml front matter metadata' },
]

interface SlashState { from: number; query: string }

function slashContext(state: EditorState): SlashState | null {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const { $from } = selection
  if ($from.parent.type.spec.code || $from.parent.type.name !== 'paragraph') return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const m = /(?:^|\s)\/([\p{L}\p{N} -]{0,20})$/u.exec(before)
  if (!m || m[1].startsWith(' ')) return null
  return { from: $from.pos - m[1].length - 1, query: m[1].trim().toLowerCase() }
}

export function slashMenu(onCommand: (id: string) => void) {
  return $prose(() => {
    const el = document.createElement('div')
    el.className = 'popup slash-menu'
    el.hidden = true
    let items: SlashItem[] = []
    let active = 0
    let ctx: SlashState | null = null
    let dismissedAt = -1
    let view: EditorView | null = null

    const run = (item: SlashItem) => {
      if (!view || !ctx) return
      const { state } = view
      view.dispatch(state.tr.delete(ctx.from, state.selection.from))
      hide()
      onCommand(item.id)
    }
    const hide = () => { el.hidden = true; ctx = null }
    const render = () => {
      el.replaceChildren(...items.map((item, i) => {
        const row = document.createElement('div')
        row.className = `slash-item${i === active ? ' active' : ''}`
        row.innerHTML = '<span class="slash-icon"></span><span class="slash-label"></span><span class="slash-hint"></span>'
        row.children[0].textContent = item.icon
        row.children[1].textContent = item.label
        row.children[2].textContent = item.hint
        row.addEventListener('mousedown', (e) => { e.preventDefault(); run(item) })
        row.addEventListener('mousemove', () => { if (active !== i) { active = i; render() } })
        return row
      }))
      el.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
    }

    return new Plugin({
      key: new PluginKey('mdl-slash'),
      view(editorView) {
        view = editorView
        document.body.append(el)
        return {
          update(v) {
            const next = slashContext(v.state)
            if (!next || next.from === dismissedAt || !v.hasFocus()) return hide()
            const query = next.query
            items = SLASH_ITEMS.filter((it) => !query || it.label.toLowerCase().includes(query) || it.keywords.includes(query))
            if (!items.length) return hide()
            if (!ctx || ctx.query !== query) active = 0
            ctx = next
            render()
            el.hidden = false
            const coords = v.coordsAtPos(next.from)
            const below = coords.bottom + 6
            const height = el.offsetHeight
            el.style.left = `${Math.min(coords.left, window.innerWidth - el.offsetWidth - 8)}px`
            el.style.top = `${below + height > window.innerHeight - 8 ? coords.top - height - 6 : below}px`
          },
          destroy: () => el.remove(),
        }
      },
      props: {
        handleKeyDown(_v, event) {
          if (el.hidden || !ctx) return false
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            render()
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            run(items[active])
            return true
          }
          if (event.key === 'Escape') {
            dismissedAt = ctx.from
            hide()
            return true
          }
          return false
        },
        handleDOMEvents: { blur: () => { hide(); return false } },
      },
    })
  })
}

// ---------------------------------------------------------------- link editor

function linkRange(state: EditorState, type: MarkType): { from: number; to: number; mark: Mark } | null {
  const { $from, from, to } = state.selection
  const mark = type.isInSet($from.marks()) ?? (from === to ? type.isInSet($from.nodeAfter?.marks ?? []) : null)
  if (!mark) return null
  // The contiguous run of text carrying this exact link that covers the selection.
  const start = $from.start()
  let runFrom = -1
  let runTo = -1
  let found: { from: number; to: number } | null = null
  $from.parent.forEach((child, offset) => {
    const a = start + offset
    const b = a + child.nodeSize
    if (!mark.isInSet(child.marks)) return
    if (runTo === a) runTo = b
    else [runFrom, runTo] = [a, b]
    if (runFrom <= from && runTo >= to) found = { from: runFrom, to: runTo }
  })
  const r = found as { from: number; to: number } | null
  return r ? { ...r, mark } : null
}

export interface LinkEditor {
  /** ⌘K: edit the link at the caret, or turn the selection into a link. */
  open(view: EditorView): void
}

export function linkEditor(openLink: (href: string) => void): { plugin: ReturnType<typeof $prose>; api: LinkEditor } {
  const el = document.createElement('div')
  el.className = 'popup link-editor'
  el.hidden = true
  el.innerHTML = '<input type="url" placeholder="Paste or type a link…" spellcheck="false"><button data-act="open" title="Open link">↗</button><button data-act="remove" title="Remove link">✕</button>'
  const input = el.querySelector('input')!
  let view: EditorView | null = null
  let forced = false

  const current = () => (view ? linkRange(view.state, view.state.schema.marks.link) : null)

  const apply = () => {
    if (!view) return
    const range = current()
    const href = input.value.trim()
    if (!range) return
    const { link } = view.state.schema.marks
    const tr = view.state.tr.removeMark(range.from, range.to, link)
    if (href) tr.addMark(range.from, range.to, link.create({ ...range.mark.attrs, href }))
    view.dispatch(tr)
  }

  const position = (v: EditorView) => {
    const range = current()
    if (!range || (!forced && !v.hasFocus() && !el.contains(document.activeElement))) {
      el.hidden = true
      return
    }
    if (document.activeElement !== input) input.value = range.mark.attrs.href ?? ''
    el.hidden = false
    const start = v.coordsAtPos(range.from)
    el.style.left = `${Math.max(8, Math.min(start.left, window.innerWidth - el.offsetWidth - 8))}px`
    el.style.top = `${start.bottom + 6}px`
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      apply()
      forced = false
      view?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      forced = false
      view?.focus()
    }
  })
  input.addEventListener('blur', () => {
    apply()
    forced = false
    setTimeout(() => view && position(view))
  })
  el.addEventListener('mousedown', (e) => { if (e.target !== input) e.preventDefault() })
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).dataset.act
    const range = current()
    if (!view || !range) return
    if (act === 'open' && range.mark.attrs.href) openLink(range.mark.attrs.href)
    if (act === 'remove') {
      view.dispatch(view.state.tr.removeMark(range.from, range.to, view.state.schema.marks.link))
      forced = false
      view.focus()
    }
  })

  const plugin = $prose(() => new Plugin({
    key: new PluginKey('mdl-link-editor'),
    view(editorView) {
      view = editorView
      document.body.append(el)
      return { update: position, destroy: () => el.remove() }
    },
  }))

  const api: LinkEditor = {
    open(v) {
      const { state } = v
      const { link } = state.schema.marks
      if (!linkRange(state, link)) {
        let { from, to } = state.selection
        let tr = state.tr
        if (from === to) {
          tr = tr.insertText('link', from)
          to = from + 4
        }
        tr.addMark(from, to, link.create({ href: '' }))
        tr.setSelection(TextSelection.create(tr.doc, from, to))
        v.dispatch(tr)
      }
      forced = true
      position(v)
      input.focus()
      input.select()
    },
  }
  return { plugin, api }
}
