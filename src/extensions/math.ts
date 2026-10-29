/**
 * LaTeX math, Typora style: `$E=mc^2$` inline and `$$ … $$` blocks.
 * Rendered with KaTeX; the LaTeX source appears while the caret is inside.
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'
import remarkMath from 'remark-math'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { keymap } from '@milkdown/kit/prose/keymap'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $inputRule, $nodeSchema, $prose, $remark, $view } from '@milkdown/kit/utils'

export const remarkMathPlugin = $remark('remarkMath', () => remarkMath)

export const mathInlineSchema = $nodeSchema('math_inline', () => ({
  group: 'inline',
  inline: true,
  content: 'text*',
  marks: '',
  parseDOM: [{ tag: 'span[data-type="math-inline"]' }],
  toDOM: () => ['span', { 'data-type': 'math-inline' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.value) state.addText(node.value as string)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, node.textContent)
    },
  },
}))

export const mathBlockSchema = $nodeSchema('math_block', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [{ tag: 'div[data-type="math-block"]', preserveWhitespace: 'full' }],
  toDOM: () => ['div', { 'data-type': 'math-block' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'math',
    runner: (state, node, type) => {
      state.openNode(type)
      if (node.value) state.addText(node.value as string)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_block',
    runner: (state, node) => {
      state.addNode('math', undefined, node.textContent)
    },
  },
}))

export function renderMath(target: HTMLElement, tex: string, displayMode: boolean) {
  if (!tex.trim()) {
    target.textContent = displayMode ? 'Empty formula' : '…'
    target.classList.add('math-empty')
    return
  }
  target.classList.remove('math-empty')
  katex.render(tex, target, { throwOnError: false, displayMode, output: 'htmlAndMathml' })
}

function mathView(displayMode: boolean) {
  return (initial: PMNode) => {
    const dom = document.createElement(displayMode ? 'div' : 'span')
    dom.className = displayMode ? 'math-block' : 'math-inline'
    const source = document.createElement(displayMode ? 'pre' : 'span')
    source.className = 'math-src'
    source.spellcheck = false
    const preview = document.createElement(displayMode ? 'div' : 'span')
    preview.className = 'math-render'
    preview.contentEditable = 'false'
    dom.append(source, preview)

    let tex: string | null = null
    const draw = (node: PMNode) => {
      if (node.textContent === tex) return
      tex = node.textContent
      renderMath(preview, tex, displayMode)
    }
    draw(initial)

    return {
      dom,
      contentDOM: source,
      update: (node: PMNode) => {
        if (node.type !== initial.type) return false
        draw(node)
        return true
      },
      ignoreMutation: (m: MutationRecord | { type: 'selection'; target: Node }) =>
        m.type !== 'selection' && preview.contains(m.target),
    }
  }
}

export const mathInlineView = $view(mathInlineSchema.node, () => mathView(false))
export const mathBlockView = $view(mathBlockSchema.node, () => mathView(true))

const isMath = (node: PMNode | null | undefined) =>
  !!node && (node.type.name === 'math_inline' || node.type.name === 'math_block')

/** Places the caret at the end of the math node starting at `pos`. */
function enter(state: EditorState, pos: number, node: PMNode, atStart = false): Transaction {
  const inside = atStart ? pos + 1 : pos + 1 + node.content.size
  return state.tr.setSelection(TextSelection.create(state.doc, inside))
}

/** Marks the math node holding the caret as `.editing` (shows its source) and lets the caret step into math. */
export const mathEditing = $prose(() => new Plugin({
  key: new PluginKey('mdl-math-editing'),
  props: {
    decorations(state) {
      const { $from, $to } = state.selection
      const decos: Decoration[] = []
      for (const $pos of [$from, $to]) {
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d)
          if (!isMath(node)) continue
          const start = $pos.before(d)
          if (!decos.some((x) => x.from === start)) decos.push(Decoration.node(start, start + node.nodeSize, { class: 'editing' }))
        }
      }
      return decos.length ? DecorationSet.create(state.doc, decos) : null
    },
    handleClickOn(view, _pos, node, nodePos, event) {
      if (!isMath(node)) return false
      if (!(event.target as HTMLElement).closest('.math-render')) return false
      view.dispatch(enter(view.state, nodePos, node))
      view.focus()
      return true
    },
    handleKeyDown(view, event) {
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
      const { state } = view
      const { selection } = state
      if (!selection.empty) return false
      const { $from } = selection
      if (event.key === 'ArrowRight' && isMath($from.nodeAfter)) {
        view.dispatch(enter(state, $from.pos, $from.nodeAfter!, true))
        return true
      }
      if (event.key === 'ArrowLeft' && isMath($from.nodeBefore)) {
        view.dispatch(enter(state, $from.pos - $from.nodeBefore!.nodeSize, $from.nodeBefore!))
        return true
      }
      // Moving vertically into a hidden math block from the block above/below.
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && view.endOfTextblock(event.key === 'ArrowDown' ? 'down' : 'up')) {
        const down = event.key === 'ArrowDown'
        const depth = $from.depth
        const index = $from.index(depth - 1) + (down ? 1 : -1)
        const parent = $from.node(depth - 1)
        if (index < 0 || index >= parent.childCount) return false
        const sibling = parent.child(index)
        if (sibling.type.name !== 'math_block') return false
        const pos = down ? $from.after(depth) : $from.before(depth) - sibling.nodeSize
        view.dispatch(enter(state, pos, sibling, down))
        return true
      }
      return false
    },
  },
}))

/** Typing `$x^2$` turns into inline math (unless the `$` is escaped). */
export const mathInlineInputRule = $inputRule((ctx) =>
  new InputRule(/(?<![\\$\w])\$([^\s$](?:[^$]*[^\s$\\])?)\$$/, (state, match, start, end) => {
    const type = mathInlineSchema.type(ctx)
    if (state.doc.resolve(start).parent.type.spec.code) return null
    const node = type.create(null, state.schema.text(match[1]))
    const tr = state.tr.replaceWith(start, end, node)
    return tr.setSelection(TextSelection.create(tr.doc, start + node.nodeSize))
  }))

/** `$$` + Enter on an empty line opens a math block. */
export const mathBlockKeymap = $prose((ctx) => keymap({
  Enter: (state, dispatch) => {
    const { $from, empty } = state.selection
    if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.textContent.trim() !== '$$') return false
    if (dispatch) {
      const start = $from.before()
      const tr = state.tr.replaceWith(start, $from.after(), mathBlockSchema.type(ctx).create())
      dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 1)).scrollIntoView())
    }
    return true
  },
}))

/** Wraps the selection in inline math, or inserts an empty formula. */
export function insertMathInline(view: EditorView) {
  const { state } = view
  const type = state.schema.nodes.math_inline
  const { from, to } = state.selection
  const text = state.doc.textBetween(from, to, ' ')
  const node = type.create(null, text ? state.schema.text(text) : undefined)
  const tr = state.tr.replaceSelectionWith(node, false)
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1 + node.content.size)).scrollIntoView())
}

export function insertMathBlock(view: EditorView) {
  const { state } = view
  const { $from } = state.selection
  const node = state.schema.nodes.math_block.create()
  const empty = $from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth >= 1
  const at = empty ? $from.before() : $from.after(Math.max(1, $from.depth))
  const tr = empty ? state.tr.replaceWith(at, $from.after(), node) : state.tr.insert(at, node)
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView())
}

export const math = [
  remarkMathPlugin,
  mathInlineSchema,
  mathBlockSchema,
  mathInlineView,
  mathBlockView,
  mathEditing,
  mathInlineInputRule,
  mathBlockKeymap,
].flat()
