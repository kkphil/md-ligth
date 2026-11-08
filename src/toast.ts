/** Small notice at the bottom of the window, optionally with one action. */
let current: HTMLElement | null = null

export function toast(message: string, action?: { label: string; run: () => void }, ms = 5000) {
  current?.remove()
  const el = document.createElement('div')
  el.className = 'popup toast'
  el.textContent = message
  if (action) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = action.label
    b.addEventListener('click', () => { action.run(); el.remove() })
    el.append(b)
  }
  document.body.append(el)
  current = el
  setTimeout(() => { if (current === el) { el.remove(); current = null } }, ms)
}
