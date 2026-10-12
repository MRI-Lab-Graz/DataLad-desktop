// Keyboard movement inside a role="tablist": arrows step to the next or
// previous visible tab (wrapping), Home/End jump to the ends.
// Returns the new index, or -1 when the key is not a tab-movement key.

/**
 * @param {number} current
 * @param {string} key
 * @param {boolean[]} hidden one entry per tab
 */
export function nextTabIndex(current, key, hidden) {
  const visible = hidden.flatMap((isHidden, index) => (isHidden ? [] : [index]))
  if (visible.length === 0) {
    return -1
  }
  const position = visible.indexOf(current)
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return visible[(position + 1) % visible.length]
    case 'ArrowUp':
    case 'ArrowLeft':
      return visible[(position - 1 + visible.length) % visible.length]
    case 'Home':
      return visible[0]
    case 'End':
      return visible[visible.length - 1]
    default:
      return -1
  }
}
