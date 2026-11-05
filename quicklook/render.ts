/**
 * Markdown → HTML for the Quick Look preview (space bar in Finder).
 *
 * Runs in a bare JavaScriptCore context inside the Quick Look extension: no
 * DOM, no `console`, no `URL`. The extension calls `mdlRender(markdown)` and
 * may provide `mdlResolveImage(src)` to turn image paths into attachments.
 */
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { remarkHighlight } from '../src/remark-highlight'

type Node = {
  type: string
  value?: string
  tagName?: string
  depth?: number
  children?: Node[]
  properties?: Record<string, unknown>
  data?: Record<string, unknown>
}

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i
const CALLOUT_TITLES: Record<string, string> = { note: 'ⓘ Note', tip: '💡 Tip', important: '❗ Important', warning: '⚠️ Warning', caution: '⛔ Caution' }

const textOf = (node: Node): string => node.value ?? (node.children ?? []).map(textOf).join('')

/** `> [!NOTE]` callouts and `[TOC]`, the way md-light shows them. */
function remarkMdLight() {
  return (tree: Node) => {
    const headings: Node[] = []
    const visit = (node: Node) => {
      if (node.type === 'heading') headings.push(node)
      node.children?.forEach(visit)
    }
    visit(tree)

    const walk = (node: Node) => {
      if (!node.children) return
      node.children = node.children.flatMap((child): Node[] => {
        if (child.type === 'paragraph' && textOf(child).trim() === '[TOC]') {
          if (!headings.length) return []
          const min = Math.min(...headings.map((h) => h.depth ?? 1))
          return [{
            type: 'toc',
            data: { hName: 'nav', hProperties: { className: ['toc'] } },
            children: headings.map((h) => ({
              type: 'tocItem',
              data: { hName: 'div', hProperties: { className: [`toc-item`, `toc-level-${(h.depth ?? 1) - min}`] } },
              children: [{ type: 'text', value: textOf(h) }],
            })),
          }]
        }
        if (child.type === 'blockquote') {
          const first = child.children?.[0]
          const text = first?.type === 'paragraph' ? first.children?.[0] : undefined
          const m = text?.type === 'text' ? CALLOUT.exec(text.value ?? '') : null
          if (m && text && first) {
            const kind = m[1].toLowerCase()
            text.value = text.value!.slice(m[0].length)
            if (!textOf(first).trim()) child.children!.shift()
            child.children!.unshift({ type: 'calloutTitle', data: { hName: 'p', hProperties: { className: ['callout-title'] } }, children: [{ type: 'text', value: CALLOUT_TITLES[kind] }] })
            child.data = { hProperties: { className: ['callout', `callout-${kind}`] } }
          }
        }
        walk(child)
        return [child]
      })
    }
    walk(tree)
  }
}

/** Lets the Quick Look extension swap image paths for attachments it can load. */
function rehypeImages() {
  return (tree: Node) => {
    const resolve = (globalThis as { mdlResolveImage?: (src: string) => string }).mdlResolveImage
    const walk = (node: Node) => {
      if (node.tagName === 'img' && resolve && typeof node.properties?.src === 'string') {
        node.properties.src = resolve(node.properties.src)
      }
      node.children?.forEach(walk)
    }
    walk(tree)
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkHighlight as never)
  .use(remarkMdLight)
  .use(remarkRehype, {
    handlers: {
      // YAML front matter as a muted block instead of dropping it.
      yaml: (_state: unknown, node: Node) => ({
        type: 'element',
        tagName: 'pre',
        properties: { className: ['front-matter'] },
        children: [{ type: 'text', value: node.value ?? '' }],
      }),
    } as never,
  })
  .use(rehypeKatex, { throwOnError: false } as never)
  .use(rehypeHighlight, { detect: false, ignoreMissing: true } as never)
  .use(rehypeImages)
  .use(rehypeStringify)

export function render(markdown: string): string {
  return String(processor.processSync(markdown))
}

;(globalThis as { mdlRender?: typeof render }).mdlRender = render
