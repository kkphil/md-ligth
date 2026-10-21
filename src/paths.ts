/** Minimal path helpers (the webview has no `path` module). Paths are handled with `/`. */

export const toPosix = (p: string) => p.replace(/\\/g, '/')

export const isAbsolute = (p: string) => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)

export function dirname(p: string) {
  const s = toPosix(p)
  const i = s.lastIndexOf('/')
  return i <= 0 ? (i === 0 ? '/' : '.') : s.slice(0, i)
}

export const basename = (p: string) => toPosix(p).split('/').pop() || ''

/** File name without its extension: `notes.md` → `notes`. */
export const stem = (p: string) => basename(p).replace(/\.[^.]*$/, '')

export const extname = (p: string) => /\.[^./]*$/.exec(basename(p))?.[0] ?? ''

/** Resolves `.` and `..` segments. */
export function normalize(p: string) {
  const s = toPosix(p)
  const root = /^([a-zA-Z]:)?\//.exec(s)?.[0] ?? ''
  const out: string[] = []
  for (const part of s.slice(root.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop()
    else if (part !== '..' || !root) out.push(part)
  }
  return root + out.join('/') || '.'
}

export const join = (...parts: string[]) => normalize(parts.filter(Boolean).join('/'))

/** Absolute `base`-relative resolution: `resolve('/a/b', '../c')` → `/a/c`. */
export const resolve = (base: string, p: string) => (isAbsolute(p) ? normalize(p) : join(base, p))

/** Relative path from directory `from` to `to` (both absolute). */
export function relative(from: string, to: string) {
  const a = normalize(from).split('/')
  const b = normalize(to).split('/')
  if (a[0] !== b[0]) return normalize(to) // different drives on Windows
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/') || '.'
}
