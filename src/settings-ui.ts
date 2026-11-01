/** The Settings sheet (⌘,). Every change applies immediately and is saved for all windows. */
import { open } from '@tauri-apps/plugin-dialog'
import { native } from './platform'
import type { ImageAction, Settings } from './settings'

const IMAGE_ACTIONS: [ImageAction, string][] = [
  ['none', 'No special operation'],
  ['current', 'Copy image to current folder (./)'],
  ['assets', 'Copy image to ./${filename}.assets folder'],
  ['custom', 'Copy image to custom folder'],
]

const html = String.raw

export function createSettingsDialog(getSettings: () => Settings, onChange: (s: Settings) => void) {
  const dialog = document.createElement('dialog')
  dialog.className = 'settings'
  dialog.innerHTML = html`
    <form method="dialog">
      <header>
        <h2>Settings</h2>
        <button value="close" class="close" title="Close (Esc)">✕</button>
      </header>

      <section>
        <h3>Appearance</h3>
        <label class="row"><span>Theme</span>
          <select name="theme">
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label class="row"><span>Font size</span>
          <span class="range"><input type="range" name="fontSize" min="12" max="24" step="1"><output></output></span>
        </label>
        <label class="row"><span>Line width</span>
          <select name="lineWidth">
            <option value="narrow">Narrow</option>
            <option value="normal">Normal</option>
            <option value="wide">Wide</option>
            <option value="full">Full window</option>
          </select>
        </label>
      </section>

      <section>
        <h3>Editor</h3>
        <label class="check"><input type="checkbox" name="spellcheck"> Check spelling while typing</label>
        <label class="check"><input type="checkbox" name="autoSave"> Auto save (documents that already have a file)</label>
      </section>

      <section>
        <h3>Images <small>When Insert…</small></h3>
        <select name="imageAction" class="wide">
          ${IMAGE_ACTIONS.map(([v, l]) => `<option value="${v}">${l.replace('$', '&#36;')}</option>`).join('')}
        </select>
        <div class="folder">
          <input type="text" name="imageFolder" spellcheck="false" placeholder="./_assets">
          <button type="button" data-act="browse" title="Choose folder…">📁</button>
          <button type="button" data-act="clear" title="Reset">✕</button>
        </div>
        <p class="hint">Please specify a relative path to the current folder which begins with <code>./</code> or <code>../</code>, or an absolute folder path. <code>&#36;{filename}</code> stands for the current file name. A <code>typora-copy-images-to:</code> entry in the front matter takes precedence.</p>
        <label class="check"><input type="checkbox" name="imageApplyLocal"> Apply above rules to local images</label>
        <label class="check"><input type="checkbox" name="imageApplyOnline"> Apply above rules to online images</label>
        <label class="check"><input type="checkbox" name="imageRelative"> Use relative path if possible</label>
      </section>
    </form>`
  document.body.append(dialog)

  const form = dialog.querySelector('form')!
  const field = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as T
  const output = form.querySelector('output')!
  const folderRow = form.querySelector<HTMLDivElement>('.folder')!
  const browse = form.querySelector<HTMLButtonElement>('[data-act=browse]')!
  if (!native) browse.hidden = true

  const fill = (s: Settings) => {
    for (const [key, value] of Object.entries(s)) {
      const el = field<HTMLInputElement>(key)
      if (!el) continue
      if (el.type === 'checkbox') el.checked = Boolean(value)
      else el.value = String(value)
    }
    output.textContent = `${s.fontSize}px`
    folderRow.hidden = s.imageAction !== 'custom'
  }

  const read = (): Settings => ({
    ...getSettings(),
    theme: field<HTMLSelectElement>('theme').value as Settings['theme'],
    fontSize: Number(field<HTMLInputElement>('fontSize').value),
    lineWidth: field<HTMLSelectElement>('lineWidth').value as Settings['lineWidth'],
    spellcheck: field<HTMLInputElement>('spellcheck').checked,
    autoSave: field<HTMLInputElement>('autoSave').checked,
    imageAction: field<HTMLSelectElement>('imageAction').value as ImageAction,
    imageFolder: field<HTMLInputElement>('imageFolder').value.trim(),
    imageApplyLocal: field<HTMLInputElement>('imageApplyLocal').checked,
    imageApplyOnline: field<HTMLInputElement>('imageApplyOnline').checked,
    imageRelative: field<HTMLInputElement>('imageRelative').checked,
  })

  const commit = () => {
    const next = read()
    fill(next)
    onChange(next)
  }
  form.addEventListener('input', (e) => {
    // Don't save half-typed folder paths on every keystroke.
    if ((e.target as HTMLElement).getAttribute('name') === 'imageFolder') return
    commit()
  })
  form.addEventListener('change', commit)

  form.addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).dataset.act
    if (act === 'clear') {
      field<HTMLInputElement>('imageFolder').value = './_assets'
      commit()
    } else if (act === 'browse') {
      const dir = await open({ directory: true, multiple: false })
      if (typeof dir === 'string') {
        field<HTMLInputElement>('imageFolder').value = dir
        commit()
      }
    }
  })
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close() })

  return {
    open() {
      fill(getSettings())
      if (!dialog.open) dialog.showModal()
    },
    /** Another window changed the settings. */
    refresh() { if (dialog.open) fill(getSettings()) },
  }
}
