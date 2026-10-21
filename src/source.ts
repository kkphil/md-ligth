/** Helpers for source mode, where the document is edited as plain Markdown in a <textarea>. */
import type { BlockCommand, InlineCommand } from './editor'

/** Replaces a range through execCommand so the change lands on the native undo stack. */
function replace(el: HTMLTextAreaElement, start: number, end: number, text: string, selStart?: number, selEnd?: number) {
  el.focus()
  el.setSelectionRange(start, end)
  const ok = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text)
  if (!ok) {
    el.setRangeText(text, start, end, 'end')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  if (selStart !== undefined) el.setSelectionRange(selStart, selEnd ?? selStart)
}

function lineBounds(value: string, from: number, to = from) {
  const start = value.lastIndexOf('\n', from - 1) + 1
  let end = value.indexOf('\n', to)
  if (end === -1) end = value.length
  return { start, end }
}

export function autosize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** Rough plain text of a Markdown document, for the word count. */
export function plainText(md: string) {
  return md
    .replace(/^```.*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_~`|]/g, ' ')
}

const INLINE_MARKERS: Record<Exclude<InlineCommand, 'link'>, string> = { bold: '**', italic: '*', code: '`', strike: '~~', highlight: '==', math_inline: '$' }

export function inline(el: HTMLTextAreaElement, cmd: InlineCommand) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const selected = value.slice(s, e)
  if (cmd === 'link') {
    const text = `[${selected || 'link'}](url)`
    const urlAt = s + text.length - 4
    return replace(el, s, e, text, urlAt, urlAt + 3)
  }
  const marker = INLINE_MARKERS[cmd]
  const n = marker.length
  // Already wrapped (markers just outside the selection)? Unwrap.
  if (value.slice(s - n, s) === marker && value.slice(e, e + n) === marker) {
    replace(el, s - n, e + n, selected, s - n, e - n)
  } else {
    replace(el, s, e, `${marker}${selected}${marker}`, s + n, e + n)
  }
}

const BLOCK_PREFIX = /^(\s{0,3})(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)?/

export function block(el: HTMLTextAreaElement, cmd: BlockCommand) {
  const { selectionStart: s, selectionEnd: e, value } = el
  const { start, end } = lineBounds(value, s, e)
  const lines = value.slice(start, end).split('\n')

  // Uses the current line if it is blank, otherwise starts a new block below it.
  const insertBlock = (text: string) => {
    if (lines.join('').trim() === '') return replace(el, start, end, text, start + text.length)
    const insert = `\n\n${text}\n`
    replace(el, end, end, insert, end + insert.length)
  }

  switch (cmd) {
    case 'hr': return insertBlock('---')
    case 'table': return insertBlock('| Column | Column |\n| ------ | ------ |\n|        |        |')
    case 'math_block': return insertBlock('$$\n\n$$')
    case 'toc': return insertBlock('[TOC]')
    case 'callout': return insertBlock('> [!NOTE]\n> ')
    case 'mermaid': return insertBlock('```mermaid\ngraph TD\n  A --> B\n```')
    case 'front_matter': {
      if (value.startsWith('---\n')) return el.setSelectionRange(4, 4)
      return replace(el, 0, 0, '---\ntitle: \n---\n\n', 11)
    }
    case 'code_block': {
      const body = value.slice(start, end)
      const text = `\`\`\`\n${body}\n\`\`\``
      return replace(el, start, end, text, start + 4, start + 4 + body.length)
    }
  }

  const heading = /^h([1-6])$/.exec(cmd)
  const prefixFor = (line: string, i: number) => {
    const current = BLOCK_PREFIX.exec(line)?.[2] ?? ''
    if (heading) {
      const want = `${'#'.repeat(Number(heading[1]))} `
      return current.trim() === want.trim() ? '' : want // same level again toggles off
    }
    switch (cmd) {
      case 'quote': return current.startsWith('>') ? '' : '> '
      case 'bullet_list': return /^[-*+]/.test(current) ? '' : '- '
      case 'task_list': return /\[[ xX]\]/.test(current) ? '' : '- [ ] '
      case 'ordered_list': return /^\d/.test(current) ? '' : `${i + 1}. `
      default: return '' // paragraph
    }
  }

  const out = lines.map((line, i) => line.replace(BLOCK_PREFIX, (_m, indent: string) => indent + prefixFor(line, i)))
  const text = out.join('\n')
  replace(el, start, end, text, start + text.length)
}

const LIST_ITEM = /^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/

export function handleKey(el: HTMLTextAreaElement, e: KeyboardEvent) {
  if (e.isComposing) return
  const { selectionStart: s, selectionEnd: end, value } = el

  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    const { start } = lineBounds(value, s)
    if (e.shiftKey) {
      const strip = /^(\t| {1,4})/.exec(value.slice(start))?.[0].length ?? 0
      if (strip) replace(el, start, start + strip, '', Math.max(start, s - strip))
    } else if (s === end) {
      replace(el, s, s, '\t', s + 1)
    } else {
      const { start: ls, end: le } = lineBounds(value, s, end)
      const text = value.slice(ls, le).replace(/^/gm, '\t')
      replace(el, ls, le, text, ls, ls + text.length)
    }
    return
  }

  // Continue lists on Enter; Enter on an empty item ends the list.
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && s === end) {
    const { start, end: lineEnd } = lineBounds(value, s)
    const line = value.slice(start, lineEnd)
    const m = LIST_ITEM.exec(line)
    if (!m || s - start < m[0].length) return
    e.preventDefault()
    if (line.trim() === m[0].trim()) {
      replace(el, start, lineEnd, '', start)
      return
    }
    const [, indent, bullet, num, delim, space, task] = m
    const marker = num ? `${Number(num) + 1}${delim}` : bullet
    const insert = `\n${indent}${marker}${space}${task ? '[ ] ' : ''}`
    replace(el, s, s, insert, s + insert.length)
  }
}
