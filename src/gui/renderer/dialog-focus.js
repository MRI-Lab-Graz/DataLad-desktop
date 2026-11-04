// Keeps keyboard focus inside an open dialog and hands it back to whatever opened it.
// wrapTarget is the pure decision; trapFocus is the small DOM glue.
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Where Tab (or Shift+Tab) must land to stay inside the dialog; null = let the browser move focus normally.
 * @param {unknown[]} items the dialog's focusable elements, in order
 * @param {unknown} active the element that has focus now
 */
export function wrapTarget(items, active, shift) {
  if (items.length === 0) {
    return null
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (!items.includes(active)) {
    return shift ? last : first
  }
  if (shift && active === first) {
    return last
  }
  return !shift && active === last ? first : null
}

export function trapFocus(overlay) {
  let opener = null
  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') {
      return
    }
    const items = [...overlay.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.getClientRects().length > 0)
    const target = wrapTarget(items, document.activeElement, event.shiftKey)
    if (target || items.length === 0) {
      event.preventDefault()
      target?.focus()
    }
  })
  return {
    remember() {
      opener = document.activeElement
    },
    restore() {
      opener?.focus?.()
      opener = null
    }
  }
}
