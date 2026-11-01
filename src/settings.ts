/** User preferences, shared by all windows (a JSON file in the app's config folder). */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { native } from './platform'

export type ImageAction = 'none' | 'current' | 'assets' | 'custom'

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  fontSize: number
  lineWidth: 'narrow' | 'normal' | 'wide' | 'full'
  spellcheck: boolean
  autoSave: boolean
  /** What to do with an image that is pasted, dropped or inserted (Typora's "When Insert…"). */
  imageAction: ImageAction
  /** Folder for `imageAction: 'custom'`: `./`/`../`-relative to the document, or absolute. `${filename}` = document name. */
  imageFolder: string
  imageApplyLocal: boolean
  imageApplyOnline: boolean
  imageRelative: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontSize: 16,
  lineWidth: 'normal',
  spellcheck: false,
  autoSave: false,
  imageAction: 'custom',
  imageFolder: './_assets',
  imageApplyLocal: true,
  imageApplyOnline: false,
  imageRelative: true,
}

const STORAGE_KEY = 'mdl-settings'

const withDefaults = (raw: unknown): Settings => ({ ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) })

export async function loadSettings(): Promise<Settings> {
  try {
    if (native) return withDefaults(await invoke('load_settings'))
    return withDefaults(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(settings: Settings) {
  if (native) return invoke('save_settings', { settings })
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* private mode */ }
}

/** Fires when another window (or this one) changed the settings. */
export function onSettingsChanged(cb: (s: Settings) => void) {
  if (native) void listen<Settings>('settings-changed', (e) => cb(withDefaults(e.payload)))
  else window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) void loadSettings().then(cb) })
}

const WIDTHS = { narrow: '680px', normal: '820px', wide: '1040px', full: '100%' }
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
let currentTheme: Settings['theme'] = 'system'

function applyScheme() {
  const dark = currentTheme === 'dark' || (currentTheme === 'system' && darkQuery.matches)
  document.documentElement.dataset.scheme = dark ? 'dark' : 'light'
}
darkQuery.addEventListener('change', applyScheme)

export function applyAppearance(s: Settings) {
  currentTheme = s.theme
  applyScheme()
  const root = document.documentElement.style
  root.setProperty('--font-size', `${s.fontSize}px`)
  root.setProperty('--line-width', WIDTHS[s.lineWidth] ?? WIDTHS.normal)
}
