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

// One matching definition for ticks, used by selectFiles and buildFilterGroups: a file lacking the entity never matches.
const matches = (parsed, key, set) => {
  const v = valueOf(parsed, key)
  return v != null && set.has(v)
}
const ticked = (selection) => Object.entries(selection).filter(([, set]) => set && set.size > 0)

/**
 * Faceted search: a value in a group is offered only if some file fits the ticks in all OTHER groups (a group's own
 * ticks do not narrow it). Ticked values always stay visible so they can be unticked; a group with a tick is never hidden.
 * Each file is parsed once and counted against the ticked groups once: files fitting all ticks feed every group,
 * files missing exactly one ticked group feed only that group.
 * @returns {Array<{ key: string, title: string, hint: string, values: string[] }>}
 */
export function buildFilterGroups(files, selection = {}) {
  const touched = ticked(selection)
  const seen = new Map([['sub', new Set()], ['ses', new Set()], ['modality', new Set()], ['suffix', new Set()], ['ext', new Set()]])
  const add = (key, v) => {
    if (!seen.has(key)) seen.set(key, new Set())
    seen.get(key).add(v)
  }
  for (const file of files) {
    const p = parseBidsPath(file.path)
    // A file missing exactly one ticked group still counts for that group's own list (its ticks never narrow it).
    let missed = null
    let misses = 0
    for (const [key, set] of touched) {
      if (!matches(p, key, set) && ++misses === 1) missed = key
      if (misses > 1) break
    }
    if (misses > 1) continue
    const offer = (key, v) => {
      if (v && (misses === 0 || missed === key)) add(key, v)
    }
    for (const key of ['sub', 'ses', 'modality', 'suffix', 'ext']) offer(key, valueOf(p, key))
    for (const [key, v] of Object.entries(p.entities)) if (key !== 'sub' && key !== 'ses') offer(key, v)
  }
  for (const [key, set] of touched) for (const v of set) add(key, v)
  const entityKeys = [...seen.keys()].filter((k) => !['modality', 'suffix', 'ext'].includes(k))
  const otherKeys = entityKeys.filter((k) => !ENTITY_ORDER.includes(k)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const order = ['sub', 'ses', 'modality', ...ENTITY_ORDER.slice(2), ...otherKeys, 'suffix', 'ext']
  const hasTick = new Set(touched.map(([key]) => key))
  return order
    .filter((key) => seen.has(key) && (seen.get(key).size >= 2 || hasTick.has(key)))
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
  const touched = ticked(selection)
  if (!touched.length) return []
  const wantPresent = mode === 'drop'
  return files.filter((file) => {
    if (file.present !== wantPresent) return false
    const p = parseBidsPath(file.path)
    return touched.every(([key, set]) => matches(p, key, set))
  })
}

const DATASET_FILES = /^(participants\.(tsv|json)|dataset_description\.json|(README|CHANGES)(\.(md|txt|rst))?)$/
const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1)
const entityKey = (entities) => JSON.stringify(Object.entries(entities).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/**
 * The selected files plus what must travel with them: same-folder files with the same entities (json, events,
 * bvec/bval ...). For get, also the top-level dataset files and task-*.json whose entities fit a selected file.
 * Companions follow the mode's presence rule (get: missing only, drop: present only).
 */
export function withCompanions(selected, all, mode) {
  const wantPresent = mode === 'drop'
  // A file with no name-value pair at all (data.csv) has nothing to match on: it never pairs with anything.
  const named = (p) => Object.keys(p.entities).length > 0
  const sel = selected.map((f) => parseBidsPath(f.path))
  const keyOf = (p) => dirOf(p.path) + '\0' + entityKey(p.entities)
  const sameName = new Set(sel.filter((p) => !p.datasetLevel && named(p)).map((p) => keyOf(p) + '\0' + p.suffix))
  const eventsDirs = new Set(sel.filter((p) => !p.datasetLevel && named(p)).map(keyOf))
  const out = new Map(selected.map((f) => [f.path, f]))
  for (const file of all) {
    if (file.present !== wantPresent || out.has(file.path)) continue
    const p = parseBidsPath(file.path)
    let take = !p.datasetLevel && named(p) && (sameName.has(keyOf(p) + '\0' + p.suffix) || (p.suffix === 'events' && eventsDirs.has(keyOf(p))))
    if (!take && mode === 'get' && !file.path.includes('/')) {
      take =
        DATASET_FILES.test(file.path) ||
        (p.ext === 'json' && p.suffix && Object.keys(p.entities).length > 0 &&
          sel.some((s) => s.suffix === p.suffix && Object.entries(p.entities).every(([k, v]) => Object.hasOwn(s.entities, k) && s.entities[k] === v)))
    }
    if (take) out.set(file.path, file)
  }
  return [...out.values()]
}

/** A new selection with one box ticked or unticked. Group keys come from file names, so no plain lookup by key. */
export function toggleValue(selection, group, value, checked) {
  const set = new Set(Object.hasOwn(selection, group) ? selection[group] : [])
  if (checked) set.add(value)
  else set.delete(value)
  return { ...selection, [group]: set }
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
