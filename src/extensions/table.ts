/**
 * Tables: create them at a fixed size (`/table 3:5` = 3 columns, 5 rows
 * including the header row) and change their size later through a small
 * toolbar that appears while the caret is in a table.
 *
 * Every change rebuilds the table from a grid of its cells, so the result is
 * always a valid GFM table: one header row, at least one body row, and each
 * column keeping its alignment.
 */
import type { Node as PMNode, Schema } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export const MAX_COLS = 20
export const MAX_ROWS = 200

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n) || min))

/** Parses "3:5", "3x5", "3 × 5" (columns × rows). */
export function parseTableSize(text: string): { cols: number; rows: number } | null {
  const m = /^\s*(\d{1,3})\s*[:x×*]\s*(\d{1,3})\s*$/i.exec(text)
  return m ? { cols: clamp(+m[1], 1, MAX_COLS), rows: clamp(+m[2], 2, MAX_ROWS) } : null
}

function emptyCell(schema: Schema, header: boolean, alignment: unknown = null) {
  const type = header ? schema.nodes.table_header : schema.nodes.table_cell
  return type.create({ alignment }, schema.nodes.paragraph.create())
}

/** A table with `cols` columns and `rows` rows, the first of which is the header. */
export function createTable(schema: Schema, cols: number, rows: number) {
  cols = clamp(cols, 1, MAX_COLS)
  rows = clamp(rows, 2, MAX_ROWS)
  return fromGrid(schema, Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, () => emptyCell(schema, r === 0))))
}

function toGrid(table: PMNode): PMNode[][] {
  const grid: PMNode[][] = []
  table.forEach((row) => {
    const cells: PMNode[] = []
    row.forEach((cell) => { cells.push(cell) })
    grid.push(cells)
  })
  return grid
}

/** Builds a table from rows of cells, converting cells to header/body type as needed. */
function fromGrid(schema: Schema, grid: PMNode[][]) {
  const { table, table_header_row, table_row, table_header, table_cell } = schema.nodes
  const width = Math.max(...grid.map((r) => r.length))
  const alignments = grid[0].map((cell) => cell.attrs.alignment)
  const rows = grid.map((cells, r) => {
    const header = r === 0
    const cellType = header ? table_header : table_cell
    const full = [...cells]
    while (full.length < width) full.push(emptyCell(schema, header, alignments[full.length] ?? null))
    const converted = full.map((cell, c) =>
      cell.type === cellType ? cell : cellType.create({ ...cell.attrs, alignment: alignments[c] ?? null }, cell.content))
    return (header ? table_header_row : table_row).create(null, converted)
  })
  return table.create(null, rows)
}

interface TableContext { table: PMNode; pos: number; row: number; col: number }

/** The table around the caret, and the caret's row and column in it. */
export function tableAt(state: EditorState): TableContext | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'table') continue
    return {
      table: $from.node(d),
      pos: $from.before(d),
      row: d + 1 <= $from.depth ? $from.index(d) : 0,
      col: d + 2 <= $from.depth ? $from.index(d + 1) : 0,
    }
  }
  return null
}

/** Position inside the paragraph of cell (row, col) of the table at `tablePos`. */
function cellTextPos(table: PMNode, tablePos: number, row: number, col: number) {
  let pos = tablePos + 1
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize
  pos += 1 // into the row
  const cells = table.child(row)
  for (let c = 0; c < col; c++) pos += cells.child(c).nodeSize
  return pos + 2 // into cell, into paragraph
}

/** Replaces the table with `grid` and puts the caret into cell (row, col). */
function replaceTable(state: EditorState, ctx: TableContext, grid: PMNode[][], row: number, col: number): Transaction {
  const next = fromGrid(state.schema, grid)
  const tr = state.tr.replaceWith(ctx.pos, ctx.pos + ctx.table.nodeSize, next)
  const r = Math.max(0, Math.min(row, next.childCount - 1))
  const c = Math.max(0, Math.min(col, next.child(r).childCount - 1))
  return tr.setSelection(TextSelection.create(tr.doc, cellTextPos(next, ctx.pos, r, c))).scrollIntoView()
}

export type TableAction = 'add_row' | 'add_col' | 'remove_row' | 'remove_col' | 'delete'

export function tableAction(view: EditorView, action: TableAction) {
  const { state } = view
  const ctx = tableAt(state)
  if (!ctx) return false
  const grid = toGrid(ctx.table)
  const { row, col } = ctx
  const align = (c: number) => grid[0][c]?.attrs.alignment ?? null
  let tr: Transaction | null = null
  switch (action) {
    case 'add_row': {
      const at = row + 1 // below the caret (the first body row when in the header)
      grid.splice(at, 0, grid[0].map((_, c) => emptyCell(state.schema, false, align(c))))
      tr = replaceTable(state, ctx, grid, at, col)
      break
    }
    case 'add_col': {
      const at = col + 1
      grid.forEach((cells, r) => cells.splice(at, 0, emptyCell(state.schema, r === 0, null)))
      tr = replaceTable(state, ctx, grid, row, at)
      break
    }
    case 'remove_row':
      if (row === 0 || grid.length <= 2) return false
      grid.splice(row, 1)
      tr = replaceTable(state, ctx, grid, Math.min(row, grid.length - 1), col)
      break
    case 'remove_col':
      if (grid[0].length <= 1) return false
      grid.forEach((cells) => cells.splice(col, 1))
      tr = replaceTable(state, ctx, grid, row, Math.min(col, grid[0].length - 1))
      break
    case 'delete': {
      const paragraph = state.schema.nodes.paragraph.create()
      tr = state.tr.replaceWith(ctx.pos, ctx.pos + ctx.table.nodeSize, paragraph)
      tr.setSelection(TextSelection.create(tr.doc, ctx.pos + 1))
      break
    }
  }
  view.dispatch(tr)
  view.focus()
  return true
}

/** Sets the table at the caret to exactly `cols` × `rows`, keeping existing content. */
export function resizeTable(view: EditorView, cols: number, rows: number) {
  const { state } = view
  const ctx = tableAt(state)
  if (!ctx) return
  cols = clamp(cols, 1, MAX_COLS)
  rows = clamp(rows, 2, MAX_ROWS)
  const grid = toGrid(ctx.table).slice(0, rows).map((cells) => cells.slice(0, cols))
  while (grid.length < rows) grid.push([])
  view.dispatch(replaceTable(state, ctx, grid.map((cells, r) => {
    const full = [...cells]
    while (full.length < cols) full.push(emptyCell(state.schema, r === 0, ctx.table.child(0).maybeChild(full.length)?.attrs.alignment ?? null))
    return full
  }), Math.min(ctx.row, rows - 1), Math.min(ctx.col, cols - 1)))
  view.focus()
}

/** Typora keys: ⌘↩ adds a row below; Tab in the last cell adds a row too. */
export const tableKeys = $prose(() => new Plugin({
  key: new PluginKey('mdl-table-keys'),
  props: {
    // A DOM handler runs before every keymap, including the table and indent ones that also want Tab.
    handleDOMEvents: {
      keydown: (view, event) => {
        if (event.altKey || event.shiftKey) return false
        const mod = event.metaKey || event.ctrlKey
        if (event.key === 'Enter' && mod) {
          if (!tableAt(view.state)) return false
          event.preventDefault()
          return tableAction(view, 'add_row')
        }
        if (event.key !== 'Tab' || mod) return false
        const ctx = tableAt(view.state)
        if (!ctx) return false
        const last = ctx.row === ctx.table.childCount - 1 && ctx.col === ctx.table.child(ctx.row).childCount - 1
        if (!last) return false
        event.preventDefault()
        const grid = toGrid(ctx.table)
        grid.push(grid[0].map((cell) => emptyCell(view.state.schema, false, cell.attrs.alignment)))
        view.dispatch(replaceTable(view.state, ctx, grid, grid.length - 1, 0))
        return true
      },
    },
  },
}))

// ---------------------------------------------------------------- toolbar

const GRID = 10

export const tableToolbar = $prose(() => {
  const bar = document.createElement('div')
  bar.className = 'popup table-toolbar'
  bar.hidden = true
  bar.innerHTML = `
    <button type="button" data-act="add_row" title="Add row below (⌘↩)">+ Row</button>
    <button type="button" data-act="add_col" title="Add column to the right">+ Column</button>
    <span class="sep"></span>
    <button type="button" data-act="remove_row" title="Delete this row">− Row</button>
    <button type="button" data-act="remove_col" title="Delete this column">− Column</button>
    <span class="sep"></span>
    <button type="button" data-act="size" class="size" title="Change size"></button>
    <button type="button" data-act="delete" class="danger" title="Delete table">Delete</button>`

  const picker = document.createElement('div')
  picker.className = 'popup table-picker'
  picker.hidden = true
  picker.innerHTML = `<div class="tp-grid"></div><div class="tp-label"></div>
    <form class="tp-form"><label>Columns <input name="cols" type="number" min="1" max="${MAX_COLS}"></label>
    <label>Rows <input name="rows" type="number" min="2" max="${MAX_ROWS}"></label><button type="submit">Apply</button></form>`
  const gridEl = picker.querySelector<HTMLDivElement>('.tp-grid')!
  const label = picker.querySelector<HTMLDivElement>('.tp-label')!
  const form = picker.querySelector<HTMLFormElement>('.tp-form')!
  for (let r = 1; r <= GRID; r++) {
    for (let c = 1; c <= GRID; c++) {
      const cell = document.createElement('span')
      cell.dataset.r = String(r)
      cell.dataset.c = String(c)
      gridEl.append(cell)
    }
  }

  let view: EditorView | null = null
  let current = { cols: 0, rows: 0 }

  const highlight = (cols: number, rows: number) => {
    gridEl.querySelectorAll<HTMLSpanElement>('span').forEach((s) =>
      s.classList.toggle('on', +s.dataset.c! <= cols && +s.dataset.r! <= rows))
    label.textContent = `${cols} × ${rows}`
  }
  const closePicker = () => { picker.hidden = true }
  const openPicker = () => {
    picker.hidden = false
    highlight(current.cols, current.rows)
    ;(form.elements.namedItem('cols') as HTMLInputElement).value = String(current.cols)
    ;(form.elements.namedItem('rows') as HTMLInputElement).value = String(current.rows)
    const r = bar.querySelector('.size')!.getBoundingClientRect()
    picker.style.left = `${Math.min(r.left, window.innerWidth - picker.offsetWidth - 8)}px`
    picker.style.top = `${r.bottom + 6}px`
  }

  gridEl.addEventListener('mousemove', (e) => {
    const t = e.target as HTMLElement
    if (t.dataset.c) highlight(+t.dataset.c, Math.max(2, +t.dataset.r!))
  })
  gridEl.addEventListener('mouseleave', () => highlight(current.cols, current.rows))
  gridEl.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement
    if (!t.dataset.c || !view) return
    e.preventDefault()
    closePicker()
    resizeTable(view, +t.dataset.c, Math.max(2, +t.dataset.r!))
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!view) return
    closePicker()
    resizeTable(view, +(form.elements.namedItem('cols') as HTMLInputElement).value, +(form.elements.namedItem('rows') as HTMLInputElement).value)
  })
  bar.addEventListener('mousedown', (e) => e.preventDefault()) // keep the caret in the table
  bar.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (!act || !view) return
    if (act === 'size') return picker.hidden ? openPicker() : closePicker()
    closePicker()
    tableAction(view, act as TableAction)
  })
  document.addEventListener('mousedown', (e) => {
    if (!picker.hidden && !picker.contains(e.target as Node) && !bar.contains(e.target as Node)) closePicker()
  })

  const position = () => {
    if (!view) return
    const ctx = view.hasFocus() || !picker.hidden || picker.contains(document.activeElement) ? tableAt(view.state) : null
    if (!ctx) {
      bar.hidden = true
      closePicker()
      return
    }
    current = { cols: ctx.table.child(0).childCount, rows: ctx.table.childCount }
    bar.querySelector('.size')!.textContent = `${current.cols} × ${current.rows} ▾`
    bar.querySelector<HTMLButtonElement>('[data-act=remove_row]')!.disabled = ctx.row === 0 || current.rows <= 2
    bar.querySelector<HTMLButtonElement>('[data-act=remove_col]')!.disabled = current.cols <= 1
    const dom = view.nodeDOM(ctx.pos) as HTMLElement | null
    const table = dom?.querySelector('table') ?? dom
    if (!table) return
    bar.hidden = false
    const rect = table.getBoundingClientRect()
    const top = Math.max(rect.top - bar.offsetHeight - 6, 46)
    bar.style.left = `${Math.max(8, rect.left)}px`
    bar.style.top = `${Math.min(top, rect.bottom - bar.offsetHeight)}px`
  }
  document.addEventListener('scroll', position, true)
  window.addEventListener('resize', position)

  return new Plugin({
    key: new PluginKey('mdl-table-toolbar'),
    view(editorView) {
      view = editorView
      document.body.append(bar, picker)
      return {
        update: () => requestAnimationFrame(position),
        destroy: () => { bar.remove(); picker.remove() },
      }
    },
    props: {
      handleDOMEvents: {
        blur: () => { setTimeout(position); return false },
        focus: () => { setTimeout(position); return false },
      },
    },
  })
})

export const tables = [tableKeys, tableToolbar].flat()
