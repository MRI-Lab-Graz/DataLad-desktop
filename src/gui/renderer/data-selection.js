// Filter groups and file selection for choosing which data to download or free up. Pure: no DOM, no I/O.
import { parseBidsPath } from './bids-path.js'

// Entity keys in PRISM order; every other entity key follows alphabetically.
const ENTITY_ORDER = ['sub', 'ses', 'task', 'acq', 'run', 'rec', 'dir', 'echo', 'ce', 'part', 'space', 'desc']
const TITLES = new Map(
  Object.entries({
    sub: 'Subjects', ses: 'Sessions', modality: 'Modalities', task: 'Task', acq: 'Acquisition', run: 'Run',
    rec: 'Reconstruction', dir: 'Direction', echo: 'Echo', ce: 'Contrast agent', part: 'Part', space: 'Space',
    desc: 'Description', suffix: 'Type', ext: 'File ending'
  })
)
const HINTS = new Map(
  Object.entries({ modality: 'folder such as anat or func', suffix: 'such as T1w or bold', ext: 'such as nii.gz or json' })
)

const natural = new Intl.Collator(undefined, { numeric: true })
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined)

// The value a file has for a group key, or null when it has none. Keys come from file names, so never index
// by them without hasOwn (constructor, toString ...).
function valueOf(parsed, key) {
  if (key === 'sub' || key === 'ses') return own(parsed.entities, key) ?? parsed[key]
  if (key === 'modality' || key === 'suffix' || key === 'ext') return parsed[key]
  return own(parsed.entities, key) ?? null
}

/** @returns {Array<{ key: string, title: string, hint: string, values: string[] }>} */
export function buildFilterGroups(files) {
  const seen = new Map([['sub', new Set()], ['ses', new Set()], ['modality', new Set()], ['suffix', new Set()], ['ext', new Set()]])
  for (const file of files) {
    const p = parseBidsPath(file.path)
    for (const key of ['sub', 'ses', 'modality', 'suffix', 'ext']) {
      const v = valueOf(p, key)
      if (v) seen.get(key).add(v)
    }
    for (const [key, v] of Object.entries(p.entities)) {
      if (key === 'sub' || key === 'ses') continue
      if (!seen.has(key)) seen.set(key, new Set())
      seen.get(key).add(v)
    }
  }
  const entityKeys = [...seen.keys()].filter((k) => !['modality', 'suffix', 'ext'].includes(k))
  const otherKeys = entityKeys.filter((k) => !ENTITY_ORDER.includes(k)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const order = ['sub', 'ses', 'modality', ...ENTITY_ORDER.slice(2), ...otherKeys, 'suffix', 'ext']
  return order
    .filter((key) => seen.has(key) && seen.get(key).size >= 2)
    .map((key) => ({
      key,
      title: TITLES.get(key) ?? key,
      hint: HINTS.get(key) ?? `${key}-`,
      values: [...seen.get(key)].sort(natural.compare)
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

const DATASET_FILES = /^(participants\.(tsv|json)|dataset_description\.json|README(\..*)?|CHANGES(\..*)?)$/
const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1)
const entityKey = (entities) => JSON.stringify(Object.entries(entities).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/**
 * The selected files plus what must travel with them: same-folder files with the same entities (json, events,
 * bvec/bval ...). For get, also the top-level dataset files and task-*.json whose entities fit a selected file.
 * Companions follow the mode's presence rule (get: missing only, drop: present only).
 */
export function withCompanions(selected, all, mode) {
  const wantPresent = mode === 'drop'
  const sel = selected.map((f) => parseBidsPath(f.path))
  const sameName = new Set(sel.filter((p) => !p.datasetLevel).map((p) => dirOf(p.path) + '\0' + entityKey(p.entities)))
  const out = new Map(selected.map((f) => [f.path, f]))
  for (const file of all) {
    if (file.present !== wantPresent || out.has(file.path)) continue
    const p = parseBidsPath(file.path)
    let take = !p.datasetLevel && sameName.has(dirOf(p.path) + '\0' + entityKey(p.entities))
    if (!take && mode === 'get' && !file.path.includes('/')) {
      take =
        DATASET_FILES.test(file.path) ||
        (p.ext === 'json' && Object.keys(p.entities).length > 0 &&
          sel.some((s) => Object.entries(p.entities).every(([k, v]) => Object.hasOwn(s.entities, k) && s.entities[k] === v)))
    }
    if (take) out.set(file.path, file)
  }
  return [...out.values()]
}

export function summarize(files) {
  let bytes = 0
  let unknownSize = 0
  for (const f of files) {
    if (typeof f.bytes === 'number') bytes += f.bytes
    else unknownSize++
  }
  return { count: files.length, bytes, unknownSize }
}

/** Splits paths into command-line sized groups (path lengths plus one separator each); order kept, paths never split. */
export function batchPaths(paths, maxChars = 6000) {
  const batches = []
  let cur = []
  let len = 0
  for (const p of paths) {
    const n = p.length + 1
    if (cur.length && len + n > maxChars) {
      batches.push(cur)
      cur = []
      len = 0
    }
    cur.push(p)
    len += n
  }
  if (cur.length) batches.push(cur)
  return batches
}
