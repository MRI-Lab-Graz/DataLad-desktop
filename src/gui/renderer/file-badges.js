// Only the exceptions get a badge: content that is here is the normal case.
export function renderAnnexBadge(annexPresent) {
  if (annexPresent === 'partial') {
    return '<span class="file-status file-status-partial">Partial</span>'
  }
  if (annexPresent === false) {
    return '<span class="file-status file-status-pointer">Not downloaded</span>'
  }
  return ''
}
