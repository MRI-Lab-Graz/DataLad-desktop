// "5 minutes ago" style ages for saves. Returns the whole phrase so no caller
// can produce "just now ago".
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ago = (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'} ago`

/** @param {number} ageMs */
export function formatAge(ageMs) {
  if (ageMs < MINUTE) {
    return 'just now'
  }
  if (ageMs < HOUR) {
    return ago(Math.floor(ageMs / MINUTE), 'minute')
  }
  if (ageMs < DAY) {
    return ago(Math.floor(ageMs / HOUR), 'hour')
  }
  if (ageMs < 7 * DAY) {
    return ago(Math.floor(ageMs / DAY), 'day')
  }
  return ago(Math.floor(ageMs / (7 * DAY)), 'week')
}
