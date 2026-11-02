import { Editor, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  commonmark,
  createCodeBlockCommand,
  remarkPreserveEmptyLinePlugin,
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
import { toggleMark } from '@milkdown/kit/prose/commands'
import { keymap } from '@milkdown/kit/prose/keymap'
import type { Node as PMNode, Schema, Slice } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $view, callCommand, getMarkdown, replaceAll } from '@milkdown/kit/utils'
import { code, configurePrism } from './extensions/code'
import { configureSerializer, frontMatterValue, markdownExtras } from './extensions/markdown'
import { insertMathBlock, insertMathInline, math } from './extensions/math'
import { linkEditor, slashMenu } from './extensions/popups'
import { IMAGE_EXT } from './images'

export interface EditorOptions {
  /** Called after every document change. */
  onChange: () => void
  /** Maps a Markdown image `src` to something the webview can load. */
  resolveImage: (src: string) => string
  /** Opens a link the user ⌘/Ctrl-clicked. */
  openLink: (href: string) => void
  /** A command picked from the `/` menu. */
  onCommand: (id: string) => void
  /** Image files pasted or dropped (browser drop / clipboard bitmaps). */
  onImageFiles: (files: File[], pos: number) => void
  /** Pasted content brought along images from the web. */
  onPastedImageUrls: (urls: string[]) => void
}

export type BlockCommand =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'paragraph'
  | 'quote' | 'bullet_list' | 'ordered_list' | 'task_list' | 'code_block' | 'hr' | 'table'
  | 'math_block' | 'callout' | 'toc' | 'mermaid' | 'front_matter'
export type InlineCommand = 'bold' | 'italic' | 'code' | 'strike' | 'highlight' | 'math_inline' | 'link'

export const BLOCK_COMMANDS: readonly string[] = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'paragraph', 'quote', 'bullet_list', 'ordered_list', 'task_list',
  'code_block', 'hr', 'table', 'math_block', 'callout', 'toc', 'mermaid', 'front_matter',
]
export const INLINE_COMMANDS: readonly string[] = ['bold', 'italic', 'code', 'strike', 'highlight', 'math_inline', 'link']

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
        Decoration.node(0, first.nodeSize, { class: 'is-empty', 'data-placeholder': 'Start writing… (type / for commands)' }),
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

const imageFiles = (list: FileList | undefined | null) =>
  [...(list ?? [])].filter((f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name))

function collectImageUrls(slice: Slice) {
  const urls: string[] = []
  slice.content.descendants((node) => {
    if (node.type.name === 'image' && /^https?:\/\//i.test(node.attrs.src)) urls.push(node.attrs.src)
  })
  return urls
}

/** Collapses runs of blank lines (left by empty paragraphs) outside code and math fences. */
function tidyMarkdown(md: string) {
  const out: string[] = []
  let fence: string | null = null
  let blank = 0
  for (const line of md.split('\n')) {
    const trimmed = line.trim()
    if (fence) {
      out.push(line)
      if (trimmed.startsWith(fence) && trimmed.replace(/[`~$]/g, '') === '') fence = null
      continue
    }
    const open = /^(`{3,}|~{3,})/.exec(trimmed)?.[1] ?? (trimmed === '$$' ? '$$' : null)
    if (open) fence = open
    if (trimmed === '') {
      if (++blank > 1) continue
    } else {
      blank = 0
    }
    out.push(line)
  }
  return out.join('\n')
}

export async function createEditor(root: HTMLElement, opts: EditorOptions) {
  // Resolves relative image paths against the open file's directory.
  const imageView = $view(imageSchema.node, () => (initial) => {
    const dom = document.createElement('img')
    let current: PMNode = initial
    const render = (node: PMNode) => {
      const src = opts.resolveImage(node.attrs.src)
      if (dom.getAttribute('src') !== src) dom.src = src
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

  // ⌘/Ctrl-click opens links; pasted/dropped images go through the image rules.
  const interactions = $prose(() => new Plugin({
    key: new PluginKey('mdl-interactions'),
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
      handlePaste(view, event) {
        const data = event.clipboardData
        const files = imageFiles(data?.files)
        // Screenshots and copied image files; pasted web content keeps its own handling.
        if (!files.length || data?.getData('text/html') || data?.getData('text/plain')) return false
        event.preventDefault()
        opts.onImageFiles(files, view.state.selection.from)
        return true
      },
      handleDrop(view, event) {
        const files = imageFiles((event as DragEvent).dataTransfer?.files)
        if (!files.length) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
        opts.onImageFiles(files, pos)
        return true
      },
      transformPasted(slice) {
        const urls = collectImageUrls(slice)
        if (urls.length) setTimeout(() => opts.onPastedImageUrls(urls))
        return slice
      },
    },
  }))

  const links = linkEditor(opts.openLink)

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      configureSerializer(ctx)
      configurePrism(ctx)
    })
    // Empty lines are just spacing, not `<br />` in the file.
    .use(commonmark.filter((plugin) => !(remarkPreserveEmptyLinePlugin as unknown[]).includes(plugin)))
    .use(gfm)
    .use(math)
    .use(markdownExtras)
    .use(code)
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
    .use(interactions)
    .use(links.plugin)
    .use(slashMenu(opts.onCommand))
    .create()

  const view = (): EditorView => editor.action((ctx: Ctx) => ctx.get(editorViewCtx))
  let cleanDoc = view().state.doc

  const call = <T>(key: Parameters<typeof callCommand>[0], payload?: T) =>
    editor.action(callCommand(key as never, payload as never))

  /** Replaces the caret's empty block with `node`, or inserts it after the current block. */
  const insertBlock = (node: PMNode, caretOffset = 1) => {
    const v = view()
    const { state } = v
    const { $from } = state.selection
    const depth = Math.max(1, $from.depth)
    const emptyBlock = $from.parent.isTextblock && $from.parent.content.size === 0
    const at = emptyBlock ? $from.before(depth) : $from.after(1)
    const tr = emptyBlock ? state.tr.replaceWith(at, $from.after(depth), node) : state.tr.insert(at, node)
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at + caretOffset, tr.doc.content.size))))
    v.dispatch(tr.scrollIntoView())
  }

  const insertTable = () => editor.action((ctx) => {
    const table = buildTable(ctx, view().state.schema, ['', ''])
    insertBlock(table, 4)
  })

  return {
    getMarkdown: (): string => tidyMarkdown(editor.action(getMarkdown())),

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
    frontMatter: (key: string) => frontMatterValue(view().state.doc, key),
    setSpellcheck(on: boolean) { view().dom.spellcheck = on },

    focus() { view().focus() },
    /** Caret to the end of the document (clicking below the text, like Typora). */
    focusEnd() {
      const v = view()
      v.dispatch(v.state.tr.setSelection(Selection.atEnd(v.state.doc)).scrollIntoView())
      v.focus()
    },
    undo() { call(undoCommand.key) },
    redo() { call(redoCommand.key) },

    inline(cmd: InlineCommand) {
      const v = view()
      switch (cmd) {
        case 'bold': call(toggleStrongCommand.key); break
        case 'italic': call(toggleEmphasisCommand.key); break
        case 'code': call(toggleInlineCodeCommand.key); break
        case 'strike': call(toggleStrikethroughCommand.key); break
        case 'highlight': toggleMark(v.state.schema.marks.highlight)(v.state, v.dispatch); break
        case 'math_inline': insertMathInline(v); break
        case 'link': links.api.open(v); return
      }
      v.focus()
    },

    block(cmd: BlockCommand) {
      const v = view()
      const { schema } = v.state
      const heading = /^h([1-6])$/.exec(cmd)
      if (heading) {
        // Pressing the shortcut for the current level toggles back to text, like Typora.
        const { $from } = v.state.selection
        const level = Number(heading[1])
        if ($from.parent.type.name === 'heading' && $from.parent.attrs.level === level) call(turnIntoTextCommand.key)
        else call(wrapInHeadingCommand.key, level)
      } else {
        switch (cmd) {
          case 'paragraph': call(turnIntoTextCommand.key); break
          case 'quote': call(wrapInBlockquoteCommand.key); break
          case 'bullet_list': call(wrapInBulletListCommand.key); break
          case 'ordered_list': call(wrapInOrderedListCommand.key); break
          case 'task_list': {
            call(wrapInBulletListCommand.key)
            const { state } = view()
            const { $from } = state.selection
            for (let d = $from.depth; d > 0; d--) {
              const node = $from.node(d)
              if (node.type.name !== 'list_item') continue
              view().dispatch(state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, checked: false }))
              break
            }
            break
          }
          case 'code_block': call(createCodeBlockCommand.key); break
          case 'hr': call(insertHrCommand.key); break
          case 'table': insertTable(); break
          case 'math_block': insertMathBlock(v); break
          case 'callout': {
            // blockquote > [!NOTE] paragraph, then an empty paragraph for the content
            const p = schema.nodes.paragraph
            const marker = p.create(null, schema.text('[!NOTE]'))
            insertBlock(schema.nodes.blockquote.create(null, [marker, p.create()]), 1 + marker.nodeSize + 1)
            break
          }
          case 'toc': {
            const p = schema.nodes.paragraph
            insertBlock(p.create(null, schema.text('[TOC]')), 0)
            const { state } = view()
            const after = state.selection.$from.after(1)
            const tr = state.tr.insert(after, p.create())
            view().dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)))
            break
          }
          case 'mermaid': {
            const sample = 'graph TD\n  A[Start] --> B{Idea?}\n  B -->|yes| C[Write it down]\n  B -->|no| D[Coffee]'
            insertBlock(schema.nodes.code_block.create({ language: 'mermaid' }, schema.text(sample)), 1 + sample.length)
            break
          }
          case 'front_matter': {
            const { state } = v
            const first = state.doc.firstChild
            if (first?.type.name === 'front_matter') {
              v.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1 + first.content.size)))
            } else {
              const tr = state.tr.insert(0, schema.nodes.front_matter.create(null, schema.text('title: ')))
              v.dispatch(tr.setSelection(TextSelection.create(tr.doc, 8)).scrollIntoView())
            }
            break
          }
        }
      }
      view().focus()
    },

    /** Inserts an image at `pos` (or the caret). */
    insertImage(src: string, alt = '', pos?: number) {
      const v = view()
      const { state } = v
      const { schema } = state
      const image = schema.nodes.image.create({ src, alt, title: '' })
      const at = Math.min(pos ?? state.selection.from, state.doc.content.size)
      const tr = state.doc.resolve(at).parent.inlineContent
        ? state.tr.insert(at, image)
        : state.tr.insert(at, schema.nodes.paragraph.create(null, image))
      v.dispatch(tr.scrollIntoView())
      v.focus()
    },

    /** After an online image was downloaded, point every copy of it at the local file. */
    replaceImageSrc(from: string, to: string) {
      const v = view()
      const tr = v.state.tr
      v.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === from) tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: to })
      })
      if (tr.docChanged) v.dispatch(tr)
    },

    headings() {
      const out: { level: number; text: string; pos: number }[] = []
      view().state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') out.push({ level: node.attrs.level, text: node.textContent, pos })
        return node.isBlock && node.type.name !== 'heading'
      })
      return out
    },

    /** Scrolls the block at `pos` to the top and puts the caret at its end. */
    goTo(pos: number) {
      const v = view()
      const node = v.state.doc.nodeAt(pos)
      if (!node) return
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos + node.nodeSize - 1)))
      ;(v.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      v.focus()
    },

    stats() {
      const doc = view().state.doc
      const text = doc.textBetween(0, doc.content.size, '\n', ' ')
      let paragraphs = 0
      doc.descendants((node) => {
        if (node.isTextblock && node.textContent.trim()) paragraphs++
        return !node.isTextblock
      })
      return { text, paragraphs }
    },

    posAtCoords(left: number, top: number) {
      return view().posAtCoords({ left, top })?.pos ?? null
    },

    destroy: () => editor.destroy(),
  }
}

export type MdEditor = Awaited<ReturnType<typeof createEditor>>
