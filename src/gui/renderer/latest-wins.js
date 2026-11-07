// Runs overlapping async tasks so every caller, including ones whose task was
// superseded, resolves to the newest task's result. Callers that await a
// refresh then never act on a stale snapshot while newer state is still loading.
export function createLatestWins() {
  let latest
  return (task) => {
    const mine = task().then((value) => (latest === mine ? value : latest))
    latest = mine
    return mine
  }
}

/** A pending fetch for the same path may be shared, unless the caller just changed something (fresh). */
export function reusePendingFetch({ pendingPath, projectPath, fresh = false }) {
  return !fresh && pendingPath !== undefined && pendingPath === projectPath
}
