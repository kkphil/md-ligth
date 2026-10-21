import { Editor, editorViewCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  commonmark,
  createCodeBlockCommand,
  imageSchema,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import {
  gfm,
  tableCellSchema,
  tableHeaderRowSchema,
  tableHeaderSchema,
  tableRowSchema,
  tableSchema,
  toggleStrikethroughCommand,
} from '@milkdown/kit/preset/gfm'
import { history, redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { indent } from '@milkdown/kit/plugin/indent'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { keymap } from '@milkdown/kit/prose/keymap'
import type { Node as PMNode, Schema } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose, $view, callCommand, getMarkdown, replaceAll } from '@milkdown/kit/utils'

export interface EditorOptions {
  /** Called after every document change. */
  onChange: () => void
  /** Maps a Markdown image `src` to something the webview can load. */
  resolveImage: (src: string) => string
  /** Opens a link the user ⌘/Ctrl-clicked. */
  openLink: (href: string) => void
}

export type BlockCommand =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'paragraph'
  | 'quote' | 'bullet_list' | 'ordered_list' | 'code_block' | 'hr' | 'table'
export type InlineCommand = 'bold' | 'italic' | 'code' | 'strike'

/**
 * Typora shows the `#` markers of the heading the caret is in.
 * We render them as a non-editable hint in the left gutter.
 */
const headingHint = $prose(() => new Plugin({
  key: new PluginKey('mdl-heading-hint'),
  props: {
    decorations(state) {
      const { selection } = state
      if (!(selection instanceof TextSelection)) return null
      const { $from } = selection
      const node = $from.parent
      if (node.type.name !== 'heading') return null
      const level = node.attrs.level as number
      const widget = Decoration.widget($from.start(), () => {
        const span = document.createElement('span')
        span.className = 'md-hint'
        span.contentEditable = 'false'
        span.textContent = '#'.repeat(level)
        return span
      }, { side: -1, key: `h${level}`, ignoreSelection: true })
      return DecorationSet.create(state.doc, [widget])
    },
  },
}))

/** "Start writing…" placeholder for an empty document. */
const placeholder = $prose(() => new Plugin({
  key: new PluginKey('mdl-placeholder'),
  props: {
    decorations(state) {
      const { doc } = state
      const first = doc.firstChild
      const empty = doc.childCount === 1 && first?.type.name === 'paragraph' && first.content.size === 0
      if (!empty) return null
      return DecorationSet.create(doc, [
        Decoration.node(0, first.nodeSize, { class: 'is-empty', 'data-placeholder': 'Start writing…' }),
      ])
    },
  },
}))

/**
 * Builds a table with a header row and one empty body row. Cells get no
 * alignment so they serialize as plain `| --- |` instead of `| :-- |`.
 */
function buildTable(ctx: Ctx, schema: Schema, headers: string[]) {
  const cell = (type: typeof tableHeaderSchema | typeof tableCellSchema, text = '') =>
    type.type(ctx).create({ alignment: null }, schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined))
  return tableSchema.type(ctx).create(null, [
    tableHeaderRowSchema.type(ctx).create(null, headers.map((h) => cell(tableHeaderSchema, h))),
    tableRowSchema.type(ctx).create(null, headers.map(() => cell(tableCellSchema))),
  ])
}

/**
 * Typora-style table creation: type `| Name | Age |` and press Enter.
 * (Milkdown's own `|3x3| ` shortcut keeps working too.)
 */
const pipeTable = $prose((ctx) => keymap({
  Enter: (state, dispatch) => {
    const { selection } = state
    if (!selection.empty) return false
    const { $from } = selection
    const para = $from.parent
    if (para.type.name !== 'paragraph' || $from.depth !== 1) return false
    const text = para.textContent
    if ($from.parentOffset !== text.length) return false
    const match = /^\s*\|(.+)\|\s*$/.exec(text)
    if (!match) return false
    const cells = match[1].split('|').map((c) => c.trim())
    if (cells.length === 0) return false
    if (!dispatch) return true

    const table = buildTable(ctx, state.schema, cells)
    const start = $from.before()
    const tr = state.tr.replaceWith(start, $from.after(), table)
    // table > row > cell > paragraph: caret into the first body cell
    const firstBodyCell = start + 1 + table.firstChild!.nodeSize + 1 + 1 + 1
    tr.setSelection(TextSelection.create(tr.doc, firstBodyCell))
    dispatch(tr.scrollIntoView())
    return true
  },
}))

const changeNotifier = (onChange: () => void) => $prose(() => new Plugin({
  key: new PluginKey('mdl-change'),
  view: () => ({
    update: (view, prev) => {
      if (!view.state.doc.eq(prev.doc)) onChange()
    },
  }),
}))

/** Clicking the checkbox of a task item (`- [ ] …`) toggles it. */
const taskToggle = $prose(() => new Plugin({
  key: new PluginKey('mdl-task-toggle'),
  props: {
    handleDOMEvents: {
      mousedown: (view, event) => {
        const li = event.target as HTMLElement
        if (li.nodeName !== 'LI' || li.dataset.itemType !== 'task') return false
        const content = li.firstElementChild
        if (!content || event.clientX >= content.getBoundingClientRect().left) return false
        const $pos = view.state.doc.resolve(view.posAtDOM(li, 0))
        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d)
          if (node.type.name !== 'list_item') continue
          event.preventDefault()
          view.dispatch(view.state.tr.setNodeMarkup($pos.before(d), undefined, { ...node.attrs, checked: !node.attrs.checked }))
          return true
        }
        return false
      },
    },
  },
}))

export async function createEditor(root: HTMLElement, opts: EditorOptions) {
  // Resolves relative image paths against the open file's directory.
  const imageView = $view(imageSchema.node, () => (initial) => {
    const dom = document.createElement('img')
    let current: PMNode = initial
    const render = (node: PMNode) => {
      dom.src = opts.resolveImage(node.attrs.src)
      dom.alt = node.attrs.alt
      if (node.attrs.title) dom.title = node.attrs.title
      else dom.removeAttribute('title')
    }
    render(initial)
    return {
      dom,
      update: (node) => {
        if (node.type !== current.type) return false
        current = node
        render(node)
        return true
      },
    }
  })

  // ⌘/Ctrl-click opens links (a plain click just places the caret, like Typora).
  const linkClick = $prose(() => new Plugin({
    key: new PluginKey('mdl-link-click'),
    props: {
      handleDOMEvents: {
        click: (_view, event) => {
          const a = (event.target as HTMLElement | null)?.closest('a')
          if (!a || !(event.metaKey || event.ctrlKey)) return false
          event.preventDefault()
          const href = a.getAttribute('href')
          if (href) opts.openLink(href)
          return true
        },
      },
    },
  }))

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      // `-` bullets, like most hand-written Markdown.
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const }))
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(indent)
    .use(trailing)
    .use(cursor)
    .use(changeNotifier(opts.onChange))
    .use(pipeTable)
    .use(taskToggle)
    .use(headingHint)
    .use(placeholder)
    .use(imageView)
    .use(linkClick)
    .create()

  const view = () => editor.action((ctx: Ctx) => ctx.get(editorViewCtx))
  let cleanDoc = view().state.doc

  const call = <T>(key: Parameters<typeof callCommand>[0], payload?: T) =>
    editor.action(callCommand(key as never, payload as never))

  const insertTable = () => editor.action((ctx) => {
    const v = ctx.get(editorViewCtx)
    const { state } = v
    const table = buildTable(ctx, state.schema, ['', ''])
    const { $from } = state.selection
    // Replace the current block if it is an empty paragraph, otherwise insert below it.
    const block = $from.node(1)
    const emptyPara = block?.type.name === 'paragraph' && block.content.size === 0
    const at = emptyPara ? $from.before(1) : $from.after(1)
    const tr = state.tr.replaceWith(at, emptyPara ? $from.after(1) : at, table)
    tr.setSelection(TextSelection.create(tr.doc, at + 4))
    v.dispatch(tr.scrollIntoView())
  })

  return {
    getMarkdown: (): string => editor.action(getMarkdown()),

    /** Replaces the whole document. `fresh` also resets undo history. */
    setMarkdown(markdown: string, fresh = true) {
      editor.action(replaceAll(markdown, fresh))
      if (fresh) cleanDoc = view().state.doc
    },

    isDirty: () => !view().state.doc.eq(cleanDoc),
    markClean() { cleanDoc = view().state.doc },
    isEmpty() {
      const doc = view().state.doc
      return doc.childCount <= 1 && doc.textContent.length === 0
    },
    text: () => view().state.doc.textBetween(0, view().state.doc.content.size, '\n', ' '),

    focus() { view().focus() },
    undo() { call(undoCommand.key) },
    redo() { call(redoCommand.key) },

    inline(cmd: InlineCommand) {
      const key = {
        bold: toggleStrongCommand.key,
        italic: toggleEmphasisCommand.key,
        code: toggleInlineCodeCommand.key,
        strike: toggleStrikethroughCommand.key,
      }[cmd]
      call(key)
      view().focus()
    },

    block(cmd: BlockCommand) {
      const heading = /^h([1-6])$/.exec(cmd)
      if (heading) {
        // Pressing the shortcut for the current level toggles back to text, like Typora.
        const { $from } = view().state.selection
        const level = Number(heading[1])
        if ($from.parent.type.name === 'heading' && $from.parent.attrs.level === level) call(turnIntoTextCommand.key)
        else call(wrapInHeadingCommand.key, level)
      } else {
        switch (cmd) {
          case 'paragraph': call(turnIntoTextCommand.key); break
          case 'quote': call(wrapInBlockquoteCommand.key); break
          case 'bullet_list': call(wrapInBulletListCommand.key); break
          case 'ordered_list': call(wrapInOrderedListCommand.key); break
          case 'code_block': call(createCodeBlockCommand.key); break
          case 'hr': call(insertHrCommand.key); break
          case 'table': insertTable(); break
        }
      }
      view().focus()
    },

    destroy: () => editor.destroy(),
  }
}

export type MdEditor = Awaited<ReturnType<typeof createEditor>>
