/**
 * Code blocks: syntax highlighting (Prism), a language field like Typora's,
 * and live previews for ```mermaid diagrams and ```math formulas.
 */
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $view } from '@milkdown/kit/utils'
import { prism, prismConfig } from '@milkdown/plugin-prism'
import latex from 'refractor/latex'
import { renderMath } from './math'

const LANGUAGE_ALIASES: Record<string, string> = { sh: 'bash', shell: 'bash', zsh: 'bash', js: 'javascript', ts: 'typescript', py: 'python', yml: 'yaml', md: 'markdown', html: 'markup', xml: 'markup', tex: 'latex' }

let mermaidSeq = 0
let mermaidLoader: Promise<typeof import('mermaid').default> | null = null

/** One short line for a failed diagram, e.g. "Parse error on line 5". */
function mermaidError(err: unknown) {
  const message = String((err as Error)?.message ?? err)
  const parse = /(Parse|Lexical) error on line \d+/.exec(message)
  if (parse) return parse[0]
  if (/No diagram type detected/i.test(message)) return 'Unknown diagram type'
  return message.split('\n')[0].replace(/[:.]\s*$/, '')
}

/** Latest render per preview element, so a slow older render can't overwrite a newer one. */
const mermaidRuns = new WeakMap<HTMLElement, number>()

async function renderMermaid(target: HTMLElement, source: string) {
  const run = ++mermaidSeq
  mermaidRuns.set(target, run)
  const isCurrent = () => mermaidRuns.get(target) === run
  const show = (error: string | null, svg = '') => {
    if (!isCurrent()) return
    if (error === null) target.innerHTML = svg
    else target.textContent = error
    target.classList.toggle('preview-error', error !== null)
  }
  if (!source.trim()) return show(null)

  mermaidLoader ??= import('mermaid').then((m) => m.default)
  const mermaid = await mermaidLoader
  const dark = document.documentElement.dataset.scheme === 'dark'
  // Without suppressErrorRendering mermaid draws its own "Syntax error" graphic.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', suppressErrorRendering: true })
  const id = `mdl-mermaid-${run}`
  try {
    await mermaid.parse(source) // throws on a syntax error, before anything is drawn
    const { svg } = await mermaid.render(id, source)
    show(null, svg)
  } catch (err) {
    show(mermaidError(err))
  } finally {
    // mermaid renders into a scratch container in <body> (`d` + id) and leaves it
    // behind when it fails. The finished <svg> carries the plain id, so keep that.
    document.getElementById(`d${id}`)?.remove()
  }
}

const codeBlockView = $view(codeBlockSchema.node, () => (initial: PMNode, view: EditorView, getPos: () => number | undefined) => {
  let node = initial
  const dom = document.createElement('div')
  dom.className = 'code-block'

  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.spellcheck = false
  pre.append(code)

  const lang = document.createElement('input')
  lang.className = 'code-lang'
  lang.placeholder = 'language'
  lang.spellcheck = false
  lang.setAttribute('autocapitalize', 'off')
  const commitLanguage = () => {
    const pos = getPos()
    const raw = lang.value.trim().toLowerCase()
    const language = LANGUAGE_ALIASES[raw] ?? raw
    if (pos === undefined || language === node.attrs.language) return
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language }))
  }
  lang.addEventListener('change', commitLanguage)
  lang.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      commitLanguage()
      view.focus()
    }
  })

  const preview = document.createElement('div')
  preview.className = 'code-preview'
  preview.contentEditable = 'false'

  const frame = document.createElement('div')
  frame.className = 'code-frame'
  frame.append(pre, lang)
  dom.append(frame, preview)

  let rendered = ''
  let timer: number | undefined
  const sync = () => {
    const language = node.attrs.language as string
    if (document.activeElement !== lang) lang.value = language
    dom.dataset.language = language
    const kind = language === 'mermaid' ? 'mermaid' : language === 'math' ? 'math' : ''
    preview.hidden = !kind
    const key = `${kind}:${node.textContent}`
    if (!kind || key === rendered) return
    rendered = key
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (kind === 'math') renderMath(preview, node.textContent, true)
      else void renderMermaid(preview, node.textContent)
    }, rendered ? 250 : 0)
  }
  sync()

  return {
    dom,
    contentDOM: code,
    update(next: PMNode) {
      if (next.type !== node.type) return false
      node = next
      sync()
      return true
    },
    stopEvent: (e: Event) => e.target === lang,
    ignoreMutation: (m: MutationRecord | { type: 'selection'; target: Node }) => !code.contains(m.target),
    destroy: () => clearTimeout(timer),
  }
})

export const code = [
  prismConfig,
  prism,
  codeBlockView,
].flat()

/** Registers extra Prism languages; call before the editor is created. */
export function configurePrism(ctx: import('@milkdown/kit/ctx').Ctx) {
  ctx.set(prismConfig.key, {
    configureRefractor: (refractor) => {
      refractor.register(latex)
      refractor.alias({ bash: ['sh', 'shell', 'zsh'], markup: ['html', 'xml', 'svg'] })
    },
  })
}
