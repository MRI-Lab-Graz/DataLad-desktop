import { QUIT_ABORT_REASON } from '../datalad/kill-tree.js'

// Electron-free bookkeeping for cancellable runs, kept out of main.js so it is
// unit-testable. Run ids come from the renderer, so they are validated.
const RUN_ID_PATTERN = /^[\w-]{1,80}$/

export function createRunRegistry() {
  const runs = new Map()

  return {
    register(runId) {
      if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
        throw new Error('Invalid runId')
      }
      if (runs.has(runId)) {
        throw new Error(`runId already active: ${runId}`)
      }
      const controller = new AbortController()
      runs.set(runId, controller)
      return controller.signal
    },

    // false when the run is unknown, finished or already cancelled, so a cancel
    // click that races completion is harmless.
    cancel(runId) {
      const controller = runs.get(runId)
      if (!controller || controller.signal.aborted) {
        return false
      }
      controller.abort()
      return true
    },

    finish(runId) {
      runs.delete(runId)
    },

    // Only used on app quit: the reason makes the runner SIGKILL at once, because
    // nothing is left running afterwards to escalate later.
    abortAll() {
      for (const controller of runs.values()) {
        controller.abort(QUIT_ABORT_REASON)
      }
    },

    size() {
      return runs.size
    }
  }
}

// Sends the first line immediately, then at most one (the newest) per interval.
// stop() drops anything pending so nothing is sent after the run finished.
export function createLatestLineThrottle(send, intervalMs = 250) {
  let lastSentAt = -Infinity
  let pending = null
  let timer = null

  const emit = (line) => {
    lastSentAt = Date.now()
    send(line)
  }

  return {
    push(line) {
      const wait = lastSentAt + intervalMs - Date.now()
      if (wait <= 0 && timer === null) {
        emit(line)
        return
      }
      pending = line
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          const latest = pending
          pending = null
          if (latest !== null) {
            emit(latest)
          }
        }, Math.max(wait, 0))
      }
    },

    stop() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    }
  }
}
