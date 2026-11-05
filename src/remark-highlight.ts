/**
 * remark plugin for `==highlight==` (Typora syntax). Used by the editor and
 * the Quick Look preview; `data.hName` makes it a <mark> in HTML.
 */

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> }
const SKIP = new Set(['code', 'inlineCode', 'inlineMath', 'math', 'html', 'yaml'])
const HIGHLIGHT = /==(?=\S)([^=\n]*?\S)==/g

/** remark plugin: parses `==text==` into `highlight` nodes and prints them back. */
export function remarkHighlight(this: { data(): Record<string, unknown[]> }) {
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
      out.push({ type: 'highlight', children: [{ type: 'text', value: m[1] }], data: { hName: 'mark' } })
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
