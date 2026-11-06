// Plumbing for the background update checks in main.js. The logic lives in
// src/datalad/validator-update.js and src/datalad/tool-notices.js.
import { collectNotices } from '../datalad/tool-notices.js'
import { updateValidator } from '../datalad/validator-update.js'

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
      headers: { 'User-Agent': 'Worldline-Desktop' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }
}

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
    // The user's "Update now" click, for the exact version they confirmed (no cooldown). Same lock as Install; never throws.
    async updateNow(onChange, confirmedVersion) {
      if (disabled) return { status: 'disabled' }
      if (typeof confirmedVersion !== 'string' || !/^\d+(\.\d+)*$/.test(confirmedVersion)) return { status: 'current' }
      const result = await guard.run(() => update({ confirmedVersion })).catch(() => ({ status: 'deferred' }))
      // Anything else keeps the "newer version" line and the button; a newer release found meanwhile replaces the number.
      if (result.status === 'updated' || (result.status === 'current' && result.newer)) status.validator = result
      try { onChange() } catch {}
      return result
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

// What main.js runs once per start. The build gets the plain runner (it sets its own long timeouts); the version
// checks in collectNotices set their own 15 s timeout. The feed override is for e2e only: never in a packaged app.
export function createAppUpdateChecks({ disabled, guard, isBusy, runner, paths, isPackaged, feedOverride, fetch,
  update = updateValidator, notices = collectNotices }) {
  const fetchJson = createFetchJson({ fetch, override: isPackaged ? undefined : feedOverride })
  return createUpdateChecks({
    disabled,
    guard,
    update: (extra) => update({ runner, ...paths(), fetchJson, now: () => new Date(), isBusy, ...extra }),
    notices: () => notices({ runner: (command, args, options) => runner.run(command, args, options), fetchJson, userDataDir: paths().userDataDir })
  })
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
