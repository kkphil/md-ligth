/**
 * Markdown syntax beyond CommonMark/GFM that Typora users expect:
 * ==highlight==, YAML front matter, [TOC], GitHub callouts (> [!NOTE]) and
 * typing [text](url) to make a link.
 */
import remarkFrontmatter from 'remark-frontmatter'
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { markRule } from '@milkdown/kit/prose'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $inputRule, $markSchema, $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'

// ---------------------------------------------------------------- ==highlight==

type MdNode = { type: string; value?: string; children?: MdNode[] }
const SKIP = new Set(['code', 'inlineCode', 'inlineMath', 'math', 'html', 'yaml'])
const HIGHLIGHT = /==(?=\S)([^=\n]*?\S)==/g

/** remark plugin: parses `==text==` into `highlight` nodes and prints them back. */
function remarkHighlight(this: { data(): Record<string, unknown[]> }) {
  const data = this.data()
  ;(data.toMarkdownExtensions ??= []).push({
    handlers: {
      highlight(node: MdNode, _parent: unknown, state: any, info: any) {
        const exit = state.enter('highlight')
        const value = state.containerPhrasing(node, { ...info, before: '=', after: '=' })
        exit()
        return `==${value}==`
      },
    },
  })

  const split = (node: MdNode): MdNode[] => {
    if (node.type !== 'text' || !node.value?.includes('==')) return [node]
    const out: MdNode[] = []
    let last = 0
    for (const m of node.value.matchAll(HIGHLIGHT)) {
      if (m.index! > last) out.push({ type: 'text', value: node.value.slice(last, m.index) })
      out.push({ type: 'highlight', children: [{ type: 'text', value: m[1] }] })
      last = m.index! + m[0].length
    }
    if (!out.length) return [node]
    if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) })
    return out
  }
  const walk = (node: MdNode) => {
    if (!node.children || SKIP.has(node.type)) return
    node.children = node.children.flatMap(split)
    node.children.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}

export const remarkHighlightPlugin = $remark('remarkHighlight', () => remarkHighlight as never)

export const highlightSchema = $markSchema('highlight', () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight')
    },
  },
}))

export const highlightInputRule = $inputRule((ctx) =>
  markRule(/(?<![\w=])(==)([^=\s](?:[^=]*[^=\s])?)\1$/, highlightSchema.type(ctx)))

// ---------------------------------------------------------------- front matter

export const remarkFrontmatterPlugin = $remark('remarkFrontmatter', () => remarkFrontmatter as never, ['yaml'] as never)

export const frontMatterSchema = $nodeSchema('front_matter', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [{ tag: 'pre[data-type="front-matter"]', preserveWhitespace: 'full', priority: 60 }],
  toDOM: () => ['pre', { 'data-type': 'front-matter', class: 'front-matter', spellcheck: 'false' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'yaml',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.value) state.addText(node.value as string)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'front_matter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.textContent)
    },
  },
}))

/** Reads a top-level `key: value` from the document's YAML front matter. */
export function frontMatterValue(doc: PMNode, key: string): string | null {
  const first = doc.firstChild
  if (first?.type.name !== 'front_matter') return null
  const m = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm').exec(first.textContent)
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : null
}

// ---------------------------------------------------------------- serializer

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i

/**
 * Keeps `> [!NOTE]` callouts and `[TOC]` readable on save. remark escapes
 * every `[` in text, which would turn them into `\[!NOTE]` / `\[TOC]`.
 */
export function configureSerializer(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (prev) => {
    const text = prev.handlers?.text
    return {
      ...prev,
      bullet: '-' as const,
      handlers: {
        ...prev.handlers,
        text: (node: any, parent: any, state: any, info: any) => {
          const out: string = text ? (text as any)(node, parent, state, info) : state.safe(node.value, info)
          return out.replace(/^\\\[(!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]|TOC\])/i, '[$1')
        },
      },
    }
  })
}

// ---------------------------------------------------------------- callouts & [TOC]

const CALLOUT_LABELS: Record<string, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }

function tocWidget(view: EditorView, headings: { level: number; text: string; pos: number }[]) {
  const nav = document.createElement('nav')
  nav.className = 'toc-widget'
  nav.contentEditable = 'false'
  if (!headings.length) nav.textContent = 'Table of contents — add headings to fill it'
  const min = Math.min(...headings.map((h) => h.level))
  for (const h of headings) {
    const a = document.createElement('a')
    a.textContent = h.text || 'Untitled'
    a.style.paddingLeft = `${(h.level - min) * 1.1}em`
    a.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const dom = view.nodeDOM(h.pos) as HTMLElement | null
      dom?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    nav.append(a)
  }
  return nav
}

export const calloutsAndToc = $prose(() => new Plugin({
  key: new PluginKey('mdl-callouts-toc'),
  props: {
    decorations(state) {
      const { doc, selection } = state
      const decos: Decoration[] = []
      const tocs: number[] = []
      const headings: { level: number; text: string; pos: number }[] = []
      const caretIn = (from: number, to: number) => selection.from >= from && selection.to <= to

      doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          headings.push({ level: node.attrs.level, text: node.textContent, pos })
          return false
        }
        if (node.type.name === 'paragraph') {
          if (node.textContent.trim() === '[TOC]') tocs.push(pos)
          return false
        }
        if (node.type.name === 'blockquote') {
          const first = node.firstChild
          const m = first?.type.name === 'paragraph' ? CALLOUT.exec(first.textContent) : null
          if (m) {
            const kind = m[1].toLowerCase()
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `callout callout-${kind}`, 'data-callout': CALLOUT_LABELS[kind] }))
            const start = pos + 2 // blockquote > paragraph > text
            const text = first!.textContent
            if (!caretIn(start, start + first!.content.size)) {
              if (text.trim() === m[0]) {
                // `> [!NOTE]` on a line of its own: hide the whole paragraph.
                decos.push(Decoration.node(pos + 1, pos + 1 + first!.nodeSize, { class: 'md-hidden-block' }))
              } else {
                const len = m[0].length + (text[m[0].length] === '\n' ? 1 : 0)
                decos.push(Decoration.inline(start, start + len, { class: 'md-hidden' }))
              }
            }
          }
        }
        return true
      })

      for (const pos of tocs) {
        const node = doc.nodeAt(pos)!
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'toc' }))
        if (!caretIn(pos + 1, pos + node.nodeSize - 1)) {
          decos.push(Decoration.inline(pos + 1, pos + node.nodeSize - 1, { class: 'md-hidden' }))
        }
        const key = `toc:${headings.map((h) => `${h.level}${h.text}@${h.pos}`).join('|')}`
        decos.push(Decoration.widget(pos + node.nodeSize - 1, (view) => tocWidget(view, headings), { key, side: 1, ignoreSelection: true }))
      }
      return decos.length ? DecorationSet.create(doc, decos) : null
    },
  },
}))

// ---------------------------------------------------------------- links

/** Typing `[text](https://…)` turns into a link. */
export const linkInputRule = $inputRule((ctx) =>
  new InputRule(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/, (state, match, start, end) => {
    const [, text, href, title] = match
    const mark = linkSchema.type(ctx).create({ href, title: title ?? null })
    return state.tr.replaceWith(start, end, state.schema.text(text, [mark])).removeStoredMark(mark.type)
  }))

export const markdownExtras = [
  remarkHighlightPlugin,
  highlightSchema,
  highlightInputRule,
  remarkFrontmatterPlugin,
  frontMatterSchema,
  calloutsAndToc,
  linkInputRule,
].flat()
