// Plumbing for the background update checks in main.js. The logic lives in
// src/datalad/validator-update.js and src/datalad/tool-notices.js.

const FEED_ORIGINS = ['https://pypi.org', 'https://formulae.brew.sh']

// e2e only (main.js never passes an override in a packaged app): point both feeds at a local server.
export function feedUrl(url, override) {
  if (!override) return url
  const u = new URL(url)
  if (!FEED_ORIGINS.includes(u.origin)) return url
  // Set the parts, never resolve a string: a path starting with // would otherwise name another host.
  const o = new URL(override)
  o.pathname = u.pathname
  o.search = u.search
  return o.toString()
}

export function createFetchJson({ fetch = globalThis.fetch, override } = {}) {
  return async (url) => {
    const res = await fetch(feedUrl(url, override), {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'DataLad-Desktop' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
}

// A version check that hangs must not hold the install lock forever.
export const withDefaultTimeout = (runner, timeoutMs = 15000) => ({
  run: (command, args, options = {}) => runner.run(command, args, { ...options, timeoutMs: options.timeoutMs ?? timeoutMs })
})

// Counts Save checks / validations in flight, so the validator is never swapped under one.
export function createBusyCounter() {
  let n = 0
  return {
    isBusy: () => n > 0,
    async track(fn) {
      n++
      try {
        return await fn()
      } finally {
        n--
      }
    }
  }
}

// Runs once per app start. Never throws; a busy install lock skips this start's update.
export function createUpdateChecks({ disabled, guard, update, notices }) {
  const status = { disabled, validator: null, notices: [] }
  let started = false
  return {
    status: () => status,
    // After a Skip: the cached status must stop showing that notice too.
    dropNotice(tool, version) {
      status.notices = status.notices.filter((n) => !(n.tool === tool && n.latest === version))
    },
    async start(onChange) {
      if (disabled || started) return
      started = true
      const done = (key) => (value) => {
        status[key] = value
        onChange()
      }
      await Promise.allSettled([
        // Lock busy (an Install is running), or update() threw before it started (e.g. bundled uv missing).
        guard.run(update).catch(() => ({ status: 'deferred' })).then(done('validator')),
        notices().catch(() => []).then(done('notices'))
      ])
    }
  }
}

// Runs fn under the lock; if the lock is already taken, returns busyResult instead of the lock's error.
export async function runUnlessBusy(guard, fn, busyResult) {
  let started = false
  try {
    return await guard.run(() => {
      started = true
      return fn()
    })
  } catch (err) {
    if (started) throw err
    return busyResult
  }
}
