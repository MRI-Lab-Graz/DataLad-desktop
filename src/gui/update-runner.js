// Plumbing for the background update checks in main.js. The logic lives in
// src/datalad/validator-update.js and src/datalad/tool-notices.js.

const FEED_ORIGINS = ['https://pypi.org', 'https://formulae.brew.sh']

// e2e only (main.js never passes an override in a packaged app): point both feeds at a local server.
export function feedUrl(url, override) {
  if (!override) return url
  const u = new URL(url)
  return FEED_ORIGINS.includes(u.origin) ? new URL(u.pathname + u.search, override).toString() : url
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
    async start(onChange) {
      if (disabled || started) return
      started = true
      const done = (key) => (value) => {
        status[key] = value
        onChange()
      }
      await Promise.allSettled([
        guard.run(update).catch(() => ({ status: 'deferred' })).then(done('validator')),
        notices().catch(() => []).then(done('notices'))
      ])
    }
  }
}
