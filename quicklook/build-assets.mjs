// Bundles the Quick Look preview's CSS: our stylesheet + KaTeX with its fonts
// inlined (the preview can't load files from the extension bundle by URL).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const here = path.dirname(new URL(import.meta.url).pathname)
const out = process.argv[2] ?? path.join(here, 'build/resources')
const katexDir = path.dirname(createRequire(import.meta.url).resolve('katex/dist/katex.min.css'))

const katex = fs.readFileSync(path.join(katexDir, 'katex.min.css'), 'utf8').replace(
  /src:url\(fonts\/([^)]+)\.woff2\) format\("woff2"\)(,url\([^)]+\) format\("[^"]+"\))*/g,
  (_m, name) => {
    const font = fs.readFileSync(path.join(katexDir, 'fonts', `${name}.woff2`)).toString('base64')
    return `src:url(data:font/woff2;base64,${font}) format("woff2")`
  },
)
const css = `${fs.readFileSync(path.join(here, 'preview.css'), 'utf8')}\n${katex}\n`
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'preview.css'), css)
console.log(`preview.css ${(css.length / 1024).toFixed(0)} kB → ${out}`)
