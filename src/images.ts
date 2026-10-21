/**
 * Where inserted images end up, following Typora's "When Insert…" rules:
 * copy into the document's folder, `./${filename}.assets`, or a custom folder
 * (`./_assets`, `../img`, an absolute path …), optionally also for images that
 * are already on disk or online.
 */
import { invoke } from '@tauri-apps/api/core'
import { native } from './platform'
import { basename, dirname, extname, isAbsolute, relative, resolve, stem } from './paths'
import type { Settings } from './settings'

export type ImageSource =
  | { kind: 'file'; path: string }
  | { kind: 'data'; data: Blob; name: string }
  | { kind: 'url'; url: string }

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic|ico)$/i

export interface PlaceContext {
  settings: Settings
  docPath: string | null
  /** `typora-copy-images-to` from the document's front matter, if any. */
  frontMatterFolder: string | null
  /** Asks the user to save an untitled document; resolves to its new path. */
  ensureSaved: () => Promise<string | null>
}

/** The folder rule in effect, before `${filename}` and relative paths are resolved. */
export function folderRule(settings: Settings, frontMatterFolder: string | null): string | null {
  if (frontMatterFolder) return frontMatterFolder
  switch (settings.imageAction) {
    case 'current': return './'
    case 'assets': return './${filename}.assets'
    case 'custom': return settings.imageFolder.trim() || null
    default: return null
  }
}

export function resolveFolder(rule: string, docPath: string) {
  const folder = rule.replace(/\$\{filename\}/g, stem(docPath))
  return resolve(dirname(docPath), folder)
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
/** Typora-style name for pasted bitmaps: image-20261021153012345.png */
function timestampName(ext: string) {
  const d = new Date()
  return `image-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}${ext}`
}

const EXT_BY_TYPE: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/tiff': '.tiff', 'image/avif': '.avif' }

export function blobName(blob: Blob, name: string) {
  const ext = extname(name) || EXT_BY_TYPE[blob.type] || '.png'
  return !name || /^image\.\w+$/i.test(name) ? timestampName(ext) : name
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((ok, fail) => {
  const reader = new FileReader()
  reader.onload = () => ok(reader.result as string)
  reader.onerror = () => fail(reader.error)
  reader.readAsDataURL(blob)
})

async function saveBlob(dir: string, data: Blob, name: string) {
  const bytes = new Uint8Array(await data.arrayBuffer())
  return invoke<string>('save_image', bytes, {
    headers: { 'x-dir': encodeURIComponent(dir), 'x-name': encodeURIComponent(blobName(data, name)) },
  })
}

/** How the Markdown should reference an image file on disk. */
function linkTo(path: string, ctx: PlaceContext, docPath: string | null) {
  if (!ctx.settings.imageRelative || !docPath) return path.replace(/ /g, '%20')
  return relative(dirname(docPath), path).replace(/ /g, '%20')
}

/**
 * Copies/saves/downloads the image according to the settings and returns
 * the `src` to put into the Markdown, or null if nothing should be inserted.
 */
export async function placeImage(source: ImageSource, ctx: PlaceContext): Promise<string | null> {
  if (!native) {
    // The browser build cannot write files; keep the image inline.
    if (source.kind === 'data') return blobToDataUrl(source.data)
    return source.kind === 'url' ? source.url : source.path
  }

  const rule = folderRule(ctx.settings, ctx.frontMatterFolder)
  const applies = source.kind === 'data'
    || (source.kind === 'file' && ctx.settings.imageApplyLocal)
    || (source.kind === 'url' && ctx.settings.imageApplyOnline)

  let docPath = ctx.docPath
  let dir: string | null = null
  if (rule && applies) {
    if (!docPath && (!isAbsolute(rule) || rule.includes('${filename}'))) docPath = await ctx.ensureSaved()
    if (docPath || isAbsolute(rule)) dir = resolveFolder(rule, docPath ?? '/untitled.md')
  }

  if (!dir) {
    if (source.kind === 'url') return source.url
    if (source.kind === 'file') return linkTo(source.path, ctx, docPath)
    // A pasted bitmap has to live somewhere: like Typora, fall back to the app's image folder.
    dir = await invoke<string>('app_image_dir')
  }

  let saved: string
  switch (source.kind) {
    case 'file': saved = await invoke<string>('copy_image', { src: source.path, dir }); break
    case 'url': saved = await invoke<string>('download_image', { url: source.url, dir }); break
    case 'data': saved = await saveBlob(dir, source.data, source.name); break
  }
  return linkTo(saved, ctx, docPath)
}

export function imageAlt(src: string) {
  const name = stem(basename(src.split(/[?#]/)[0]))
  try { return decodeURIComponent(name) } catch { return name }
}
