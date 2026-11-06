// Filter groups and file selection for choosing which data to download or free up. Pure: no DOM, no I/O.
import { parseBidsPath } from './bids-path.js'

// Entity keys in PRISM/BIDS order; unknown keys come alphabetically after these.
const ENTITY_ORDER = ['task', 'acq', 'ce', 'trc', 'stain', 'rec', 'dir', 'run', 'mod', 'echo', 'flip', 'inv', 'mt', 'part', 'proc', 'hemi', 'space', 'split', 'recording', 'chunk', 'res', 'den', 'label', 'desc']
const TITLES = { sub: 'Subjects', ses: 'Sessions', modality: 'Modalities', task: 'Task', acq: 'Acquisition', run: 'Run', suffix: 'Type', ext: 'File ending' }
const HINTS = { modality: 'folder such as anat or func', suffix: 'such as T1w or bold', ext: 'such as nii.gz or json' }

const natural = new Intl.Collator(undefined, { numeric: true })

// The value a file has for a group key, or null when it has none.
function valueOf(parsed, key) {
  if (key === 'sub' || key === 'ses') return parsed.entities[key] ?? parsed[key]
  if (key === 'modality' || key === 'suffix' || key === 'ext') return parsed[key]
  return parsed.entities[key] ?? null
}

function keyRank(key) {
  const i = ENTITY_ORDER.indexOf(key)
  return i < 0 ? ENTITY_ORDER.length : i
}

/** @returns {Array<{ key: string, title: string, hint: string, values: string[] }>} */
export function buildFilterGroups(files) {
  const seen = { sub: new Set(), ses: new Set(), modality: new Set(), suffix: new Set(), ext: new Set() }
  const other = {}
  for (const file of files) {
    const p = parseBidsPath(file.path)
    for (const key of Object.keys(seen)) {
      const v = valueOf(p, key)
      if (v) seen[key].add(v)
    }
    for (const [key, v] of Object.entries(p.entities)) {
      if (key === 'sub' || key === 'ses') continue
      ;(other[key] ??= new Set()).add(v)
    }
  }
  const otherKeys = Object.keys(other).sort((a, b) => keyRank(a) - keyRank(b) || (a < b ? -1 : 1))
  const order = ['sub', 'ses', 'modality', ...otherKeys, 'suffix', 'ext']
  return order
    .map((key) => ({ key, set: seen[key] ?? other[key] }))
    .filter(({ set }) => set.size >= 2)
    .map(({ key, set }) => ({
      key,
      title: TITLES[key] ?? key,
      hint: HINTS[key] ?? `${key}-`,
      values: [...set].sort(natural.compare)
    }))
}

/**
 * Untouched group (missing or empty Set) = no filter; every group untouched = nothing selected.
 * get keeps files not yet present, drop keeps files that are present.
 */
export function selectFiles(files, selection, mode) {
  const touched = Object.entries(selection).filter(([, set]) => set && set.size > 0)
  if (!touched.length) return []
  const wantPresent = mode === 'drop'
  return files.filter((file) => {
    if (file.present !== wantPresent) return false
    const p = parseBidsPath(file.path)
    return touched.every(([key, set]) => {
      const v = valueOf(p, key)
      return v != null && set.has(v)
    })
  })
}
