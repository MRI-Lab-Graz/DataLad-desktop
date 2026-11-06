// Runs the chosen data in command-line sized batches. Pure: the command runner is injected, no DOM, no I/O.
import { batchPaths, selectFiles, withCompanions } from './data-selection.js'

/** The exact paths a get or drop would touch (chosen files plus companions). */
export function planPaths(files, selection, mode) {
  return withCompanions(selectFiles(files, selection, mode), files, mode).map((f) => f.path)
}

/**
 * Stops at the first failure or when shouldStop(result) says so; later batches never run and are reported.
 * `paths` replaces the plan (used to retry only what failed). run(commandName, paths) returns a result with `ok`.
 * @returns {Promise<{ ok: boolean, done: number, failedPaths: string[], remainingPaths: string[], stopped: boolean }>}
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
        stopped: Boolean(result && shouldStop(result))
      }
    }
    done += batches[i].length
    onProgress?.({ batch: i + 1, batches: batches.length, done, total: planned.length })
  }
  return { ok: true, done, failedPaths: [], remainingPaths: [], stopped: false }
}

/** The "Delete without a safety check" button is offered only after a normal drop failed on its own (not stopped). */
export function needsRecklessOffer(outcome) {
  return !outcome.ok && !outcome.stopped && outcome.failedPaths.length + outcome.remainingPaths.length > 0
}

export const isDeleteWord = (text) => typeof text === 'string' && text.trim().toLowerCase() === 'delete'
