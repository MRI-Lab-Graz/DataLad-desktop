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
