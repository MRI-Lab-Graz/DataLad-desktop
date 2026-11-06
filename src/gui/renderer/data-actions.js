// Runs the chosen data in command-line sized batches. Pure: the command runner is injected, no DOM, no I/O.
import { batchPaths, selectFiles, summarize, withCompanions } from './data-selection.js'
import { formatBytes } from './data-panel.js'

/** The exact paths a get or drop would touch (chosen files plus companions). */
export function planPaths(files, selection, mode) {
  return withCompanions(selectFiles(files, selection, mode), files, mode).map((f) => f.path)
}

/**
 * Stops at the first failure or when shouldStop(result) says so; later batches never run and are reported.
 * `paths` replaces the plan (used to retry only what failed). run(commandName, paths) returns a result with `ok`.
 * @returns {Promise<{ failedResult?: object|null, ok: boolean, done: number, failedPaths: string[], remainingPaths: string[], stopped: boolean }>}
 */
export async function runSelectedBatches({ mode, files, selection, paths, run, shouldStop, onProgress }) {
  const planned = paths ?? planPaths(files, selection, mode)
  const batches = batchPaths(planned)
  const command = mode === 'drop' ? 'drop' : 'get'
  let done = 0
  for (let i = 0; i < batches.length; i++) {
    const result = await run(command, batches[i])
    if (!result?.ok) {
      return {
        ok: false,
        done,
        failedPaths: batches[i],
        remainingPaths: batches.slice(i + 1).flat(),
        stopped: Boolean(result && shouldStop(result)),
        failedResult: result
      }
    }
    done += batches[i].length
    onProgress?.({ batch: i + 1, batches: batches.length, done, total: planned.length })
  }
  return { ok: true, done, failedPaths: [], remainingPaths: [], stopped: false }
}

/** Delete-anyway is offered only when DataLad itself refused for safety (DROP_UNSAFE, see errors.js), never for any other failure. */
export function needsRecklessOffer(outcome) {
  return !outcome.ok && !outcome.stopped && outcome.failedResult?.userError?.code === 'DROP_UNSAFE' && outcome.failedPaths.length > 0
}

const files = (n) => `${n} ${n === 1 ? 'file' : 'files'}`

/** Plain message after a drop that failed; the untried rest is named so nobody thinks it was refused. */
export function describeNotRemoved(outcome) {
  const n = outcome.failedPaths.length
  const rest = outcome.remainingPaths.length
  return (
    `${files(n)} ${n === 1 ? 'was' : 'were'} not removed. Usually no other copy could be confirmed, or the remote cannot be reached. Details are shown below.` +
    (rest ? ` ${files(rest)} ${rest === 1 ? 'was' : 'were'} not tried; press Free up space again for those.` : '')
  )
}

/** The note shown after an action (and kept through the reload that follows); '' when all went well. mode: get, drop or reckless. */
export function describeActionNote(mode, outcome) {
  if (outcome.ok) return ''
  if (outcome.stopped) return 'Stopped. The rest was not touched.'
  const left = outcome.failedPaths.length + outcome.remainingPaths.length
  if (mode === 'drop') return describeNotRemoved(outcome)
  if (mode === 'reckless') return `${files(left)} ${left === 1 ? 'was' : 'were'} not removed. Details are shown below.`
  return `${files(left)} ${left === 1 ? 'was' : 'were'} not downloaded. Details are shown below.`
}

export function describeRecklessDialog(paths) {
  const times = batchPaths(paths).length
  return `Up to ${files(paths.length)} in this project. You may be asked to confirm in a system window ${times === 1 ? '1 time' : `${times} times`}.`
}

/** True only while the panel's data belongs to the project that is open now. */
export const panelMatchesProject = (panel, rootPath) => Boolean(panel?.project) && panel.project === rootPath

/** Get all for a BIDS project: every file whose content is missing. */
export const planGetAll = (all) => all.filter((f) => !f.present).map((f) => f.path)

/** Confirm text for Get all; `all` is the file list or null when it could not be read. */
export function describeGetAll(all) {
  if (!all) return 'How many files and how big they are is not known.'
  const todo = all.filter((f) => !f.present)
  if (!todo.length) return 'No files that still need downloading were found in the list.'
  const { bytes, unknownSize } = summarize(todo)
  return `${files(todo.length)} will be downloaded, ${unknownSize ? 'size is not known for all of them' : `about ${formatBytes(bytes)}`}.`
}

export const isDeleteWord = (text) => typeof text === 'string' && text.trim().toLowerCase() === 'delete'

/** After an await: true only while the open project and the panel are still the ones the run started in. */
export const runStillCurrent = ({ panelProject, rootProject, runProject }) =>
  Boolean(runProject) && panelProject === runProject && rootProject === runProject

/** Delete-anyway needs the refusal, the panel and the open project to be one and the same project. */
export const canRunReckless = ({ unsafeProject, panelProject, rootProject }) =>
  Boolean(unsafeProject) && unsafeProject === panelProject && panelProject === rootProject

/** One panel sequence at a time: true and marks the gate busy, or false when a sequence is already running. */
export function startSequence(gate) {
  if (gate.running) return false
  gate.running = true
  return true
}
