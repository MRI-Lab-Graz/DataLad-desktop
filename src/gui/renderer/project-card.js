// Plain words for the project card. Pure: strings only, the page renders them with textContent (never innerHTML).

const SUBJECT = /^sub-[A-Za-z0-9._-]+$/
const plural = (n, one, many) => (n === 1 ? one : many)

// `datasets` = the app's list of datasets ({ relativePath }); '.' is the project itself.
export function describeFolders(datasets, { bidsLike }) {
  const nested = (Array.isArray(datasets) ? datasets : []).map((d) => d?.relativePath).filter((p) => typeof p === 'string' && p !== '.')
  if (nested.length === 0) return ''
  const top = nested.filter((p) => !p.includes('/') && !p.includes('\\'))
  const subjects = bidsLike ? top.filter((p) => SUBJECT.test(p)) : []
  const others = top.filter((p) => !subjects.includes(p))
  if (subjects.length === 0) {
    const named = bidsLike && others.length === nested.length && others.length === 1 ? `: ${others[0]}` : ''
    return `Contains ${nested.length} separately tracked ${plural(nested.length, 'folder', 'folders')}${named}`
  }
  const head =
    subjects.length === 1 ? '1 subject folder, tracked on its own' : `${subjects.length} subject folders, each tracked on its own`
  if (others.length === 0) return head
  const shown = others.slice(0, 3).join(', ')
  const more = others.length > 3 ? ` and ${others.length - 3} more` : ''
  return `${head}. Also on their own: ${shown}${more}`
}

// Only a plain Git folder (no data on demand) or an unknown one needs a badge; a DataLad project is the normal case.
export function describeTypeBadge(classification) {
  if (classification === 'git') {
    return { text: 'Git', hidden: false, className: 'badge-git', title: 'Plain Git: saves and history work, but there is no data on demand. DataLad is not set up in this folder.' }
  }
  if (classification === 'dataset') return { text: 'DataLad', hidden: true, className: 'badge-dataset' }
  if (classification === 'superdataset') return { text: 'DataLad', hidden: true, className: 'badge-superdataset' }
  return { text: 'Unknown', hidden: false, className: 'badge-unknown' }
}

// One badge per name (PRISM / BIDS). A PRISM project is checked for both at once, so both show the same result.
// Anything that is not an exact, known verdict reads as "not checked", never as valid.
export function describeValidity({ label, check }) {
  const verdict = check && typeof check === 'object' ? check.verdict : undefined
  if (verdict === 'valid') return { text: `${label} ✓ valid`, tone: 'ok', title: 'Checked with the validator: no problems found.' }
  if (verdict === 'invalid') {
    const n = Number.isSafeInteger(check.errorCount) ? check.errorCount : 0
    return { text: n > 0 ? `${label} ✗ ${n} ${plural(n, 'problem', 'problems')}` : `${label} ✗ not valid`, tone: 'bad', title: 'Click to see what to fix.' }
  }
  if (verdict === 'checking') return { text: `${label} · checking…`, tone: 'wait', title: 'Checking your data. You can keep working.' }
  if (verdict === 'unchecked') {
    const missing = check.reason === 'validator-missing'
    return {
      text: `${label} · not checked`,
      tone: 'unknown',
      title: missing ? 'The check needs a one-time install: open Setup and click Install under PRISM Validator.' : 'The check could not run. Use Check again.'
    }
  }
  return { text: label, tone: 'unknown', title: '' }
}

// What the changed files looked like when the check ran: if it differs later, the result is old.
export function changeSignature(files) {
  return (Array.isArray(files) ? files : []).map((f) => `${f?.status}:${f?.path}`).sort().join('\n')
}

// The validity box inside the Save area. null = nothing to show (not a BIDS/PRISM project, or no result yet).
// Only a fresh "not valid" holds Save back; Save checks again by itself, so an old result never blocks.
export function describeSaveValidity({ check, stale }) {
  const verdict = check && typeof check === 'object' ? check.verdict : undefined
  if (!['valid', 'invalid', 'checking', 'unchecked'].includes(verdict)) return null
  const names = check.kind === 'prism' ? 'PRISM and BIDS' : 'BIDS'
  const old = ' Files changed since: press Check again.'
  if (verdict === 'checking') return { text: 'Checking your data…', tone: 'wait', blocksSave: false }
  if (verdict === 'unchecked') {
    const missing = check.reason === 'validator-missing'
    return { text: missing ? 'Not checked: the check needs a one-time install (Setup, PRISM Validator).' : 'The check could not run. Press Check again.', tone: 'unknown', blocksSave: false }
  }
  if (verdict === 'valid') {
    return stale
      ? { text: `No problems when last checked.${old}`, tone: 'unknown', blocksSave: false }
      : { text: `✓ ${names}: no problems found.`, tone: 'ok', blocksSave: false }
  }
  const n = Number.isSafeInteger(check.errorCount) ? check.errorCount : 0
  const what = n > 0 ? `${n} ${plural(n, 'problem', 'problems')}` : 'Not valid'
  if (stale) return { text: `✗ ${what} when last checked.${old}`, tone: 'bad', blocksSave: false }
  return { text: `✗ ${what}. Save stays off until ${n === 1 || n === 0 ? 'it is' : 'they are'} fixed.`, tone: 'bad', blocksSave: true }
}
