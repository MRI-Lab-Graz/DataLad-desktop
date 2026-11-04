import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createAppUpdateChecks, createBusyCounter, createFetchJson, createUpdateChecks, feedUrl, runUnlessBusy } from '../src/gui/update-runner.js'

// LF endings, so slicing on "\n})\n" also works on a Windows (CRLF) checkout.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('src/gui/main.js')
const preload = read('src/gui/preload.js')
const handler = (channel) => {
  const start = main.indexOf(`handle('${channel}'`)
  assert.ok(start >= 0, `${channel} handler exists`)
  return main.slice(start, main.indexOf('\n})\n', start))
}

// --- real units ---

test('feedUrl: no override keeps the URL; an override swaps only the origin of the two feeds', () => {
  assert.equal(feedUrl('https://pypi.org/pypi/datalad/json'), 'https://pypi.org/pypi/datalad/json')
  assert.equal(feedUrl('https://pypi.org/pypi/datalad/json', 'http://127.0.0.1:4567'), 'http://127.0.0.1:4567/pypi/datalad/json')
  assert.equal(
    feedUrl('https://formulae.brew.sh/api/formula/git-annex.json', 'http://127.0.0.1:4567/'),
    'http://127.0.0.1:4567/api/formula/git-annex.json'
  )
  assert.equal(
    feedUrl('https://formulae.brew.sh/api/formula/datalad.json', 'http://127.0.0.1:4567'),
    'http://127.0.0.1:4567/api/formula/datalad.json'
  )
  assert.equal(feedUrl('https://example.org/x', 'http://127.0.0.1:4567'), 'https://example.org/x')
  // A path starting with // must not turn into a protocol-relative URL pointing at another host.
  assert.equal(feedUrl('https://pypi.org//evil.example/x?q=1', 'http://127.0.0.1:4567'), 'http://127.0.0.1:4567//evil.example/x?q=1')
})

test('createFetchJson: timeout signal, plain User-Agent only, rejects non-2xx, parses JSON', async () => {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    return url.endsWith('/bad') ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ a: 1 }) }
  }
  const fetchJson = createFetchJson({ fetch, override: 'http://127.0.0.1:9' })
  assert.deepEqual(await fetchJson('https://pypi.org/pypi/datalad/json'), { a: 1 })
  assert.equal(calls[0].url, 'http://127.0.0.1:9/pypi/datalad/json')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
  assert.deepEqual(calls[0].init.headers, { 'User-Agent': 'DataLad-Desktop' })
  await assert.rejects(fetchJson('https://pypi.org/bad'))
})

// --- createAppUpdateChecks: what main.js wires together ---
async function appChecks({ isPackaged = false, disabled = false } = {}) {
  const seen = { fetched: [] }
  const runner = { run: async (c, a, o) => (seen.ran = [c, a, o]) }
  const checks = createAppUpdateChecks({
    disabled,
    guard: { run: (fn) => fn() },
    isBusy: () => 'busy?',
    runner,
    paths: () => ({ uvPath: '/uv', envDir: '/env', userDataDir: '/data' }),
    isPackaged,
    feedOverride: 'http://127.0.0.1:9',
    fetch: async (url) => { seen.fetched.push(url); return { ok: true, json: async () => ({}) } },
    update: async (deps) => { seen.update = deps; await deps.fetchJson('https://pypi.org/pypi/prism-validator/json'); return { status: 'current' } },
    notices: async (deps) => { seen.notices = deps; await deps.runner('git-annex', ['version'], { timeoutMs: 15000 }); return [] }
  })
  await checks.start(() => {})
  return { seen, runner, checks }
}

test('createAppUpdateChecks: the build gets the plain runner (its own long timeouts), paths, busy check and a clock', async () => {
  const { seen, runner } = await appChecks()
  const { fetchJson, now, ...rest } = seen.update
  assert.deepEqual(rest, { runner, uvPath: '/uv', envDir: '/env', userDataDir: '/data', isBusy: rest.isBusy })
  assert.equal(rest.runner, runner)
  assert.equal(rest.isBusy(), 'busy?')
  assert.ok(now() instanceof Date)
  assert.equal(typeof fetchJson, 'function')
})

test('createAppUpdateChecks: notices get a runner function that passes options through unchanged', async () => {
  const { seen } = await appChecks()
  assert.equal(seen.notices.userDataDir, '/data')
  assert.equal(seen.notices.fetchJson, seen.update.fetchJson)
  assert.deepEqual(seen.ran, ['git-annex', ['version'], { timeoutMs: 15000 }])
})

test('createAppUpdateChecks: the feed override only in an unpackaged app; disabled means nothing runs', async () => {
  assert.deepEqual((await appChecks()).seen.fetched, ['http://127.0.0.1:9/pypi/prism-validator/json'])
  assert.deepEqual((await appChecks({ isPackaged: true })).seen.fetched, ['https://pypi.org/pypi/prism-validator/json'])
  const off = await appChecks({ disabled: true })
  assert.deepEqual(off.seen, { fetched: [] })
  assert.equal(off.checks.status().disabled, true)
})

test('createBusyCounter: busy while any tracked call runs, also when it throws', async () => {
  const busy = createBusyCounter()
  let release
  const a = busy.track(() => new Promise((r) => (release = r)))
  const b = busy.track(async () => { throw new Error('x') })
  assert.equal(busy.isBusy(), true)
  await assert.rejects(b)
  assert.equal(busy.isBusy(), true)
  release('done')
  assert.equal(await a, 'done')
  assert.equal(busy.isBusy(), false)
})

const guard = () => ({ run: (fn) => fn() })

test('createUpdateChecks: disabled = no update, no notices, status says disabled', async () => {
  let called = 0
  const checks = createUpdateChecks({ disabled: true, guard: guard(), update: async () => called++, notices: async () => called++ })
  await checks.start(() => called++)
  assert.equal(called, 0)
  assert.deepEqual(checks.status(), { disabled: true, validator: null, notices: [] })
})

test('createUpdateChecks: runs the update inside the guard, collects notices, emits changes, once only', async () => {
  let inGuard = false
  let changes = 0
  let updates = 0
  const checks = createUpdateChecks({
    disabled: false,
    guard: { run: async (fn) => { inGuard = true; try { return await fn() } finally { inGuard = false } } },
    update: async () => { updates++; assert.equal(inGuard, true); return { status: 'updated', from: '1.0.0', to: '1.1.0' } },
    notices: async () => [{ tool: 'datalad', installed: '1.0', latest: '1.1', message: 'm' }]
  })
  assert.deepEqual(checks.status(), { disabled: false, validator: null, notices: [] })
  await checks.start(() => changes++)
  await checks.start(() => changes++)
  assert.equal(updates, 1)
  assert.ok(changes >= 1)
  assert.deepEqual(checks.status().validator, { status: 'updated', from: '1.0.0', to: '1.1.0' })
  assert.equal(checks.status().notices.length, 1)
})

test('createUpdateChecks: a busy guard skips the update quietly; errors never escape', async () => {
  let updates = 0
  const checks = createUpdateChecks({
    disabled: false,
    guard: { run: async () => { throw new Error('Installation already running') } },
    update: async () => updates++,
    notices: async () => { throw new Error('boom') }
  })
  await checks.start(() => { throw new Error('window gone') })
  assert.equal(updates, 0)
  assert.deepEqual(checks.status(), { disabled: false, validator: { status: 'deferred' }, notices: [] })
})

test('runUnlessBusy: a busy lock gives the plain busy result; errors from the work itself still throw', async () => {
  const BUSY = { ready: false, code: 'BUSY' }
  const busyGuard = { run: async () => { throw new Error('Installation already running') } }
  assert.deepEqual(await runUnlessBusy(busyGuard, async () => 'x', BUSY), BUSY)
  assert.equal(await runUnlessBusy(guard(), async () => 'done', BUSY), 'done')
  await assert.rejects(runUnlessBusy(guard(), async () => { throw new Error('real') }, BUSY), /real/)
})

// --- wiring in main.js / preload.js ---

test('updates:status returns the cached status; updates:skip validates tool and version before writing', () => {
  assert.match(handler('updates:status'), /updateChecks\.status\(\)/)
  const skip = handler('updates:skip')
  assert.match(skip, /tool !== 'datalad' && tool !== 'git-annex'/)
  assert.match(skip, /typeof version !== 'string' \|\| parseVersion\(version\) !== version/)
  assert.match(skip, /throw new Error/)
  assert.ok(skip.indexOf('throw new Error') < skip.indexOf('skipNotice('), 'rejects before writing')
  assert.match(skip, /return \{ ok: true \}/)
})

test('main.js builds the background run from the policy switch, the install lock, the busy counter and isPackaged', () => {
  const call = main.slice(main.indexOf('createAppUpdateChecks({'), main.indexOf('\n})', main.indexOf('createAppUpdateChecks({')))
  assert.match(call, /disabled:\s*policy\.updateCheckDisabled\b/)
  assert.match(call, /guard:\s*ensureGuard\b/)
  assert.match(call, /isBusy:\s*validatorUse\.isBusy\b/)
  assert.match(call, /isPackaged:\s*app\.isPackaged\b/)
})

test('both validator call sites are wrapped by the busy counter', () => {
  assert.match(handler('adapter:runCommand'), /validatorUse\.track\(\(\) =>\s*gateSave\(/)
  assert.match(handler('prism:inspect'), /validatorUse\.track\(\(\) =>\s*inspectProject\(/)
})

test('the run starts after the window loaded, delayed, and the env is repaired before the window exists', () => {
  assert.match(main, /webContents\.once\('did-finish-load', \(\) =>\s*setTimeout\(\(\) => void updateChecks\.start\(/)
  assert.match(main, /BrowserWindow\.getAllWindows\(\)[\s\S]{0,120}webContents\.send\('updates:changed'\)/)
  const ready = main.slice(main.indexOf('app.whenReady()'))
  assert.ok(ready.indexOf('await repairEnvDir({ envDir: managedEnvDir() })') >= 0, 'repair on every start')
  assert.ok(ready.indexOf('repairEnvDir') < ready.indexOf('createMainWindow()'), 'repair before the window')
})

test('env:ensure answers a busy install lock with a plain message, not a raw error', () => {
  const body = main.slice(main.indexOf("handle('env:ensure'"), main.indexOf("handle('updates:status'"))
  assert.match(body, /runUnlessBusy\(\s*ensureGuard,/)
  assert.match(body, /\{ ready: false, code: 'BUSY', message: 'Another update or install is running\. Please try again in a minute\.' \}/)
})

test('preload exposes the three update functions', () => {
  assert.match(preload, /getUpdateStatus: \(\) => ipcRenderer\.invoke\('updates:status'\)/)
  assert.match(preload, /skipUpdateNotice: \(\{ tool, version \}\) => ipcRenderer\.invoke\('updates:skip', \{ tool, version \}\)/)
  assert.match(preload, /onUpdatesChanged: \(callback\) => \{[\s\S]*?ipcRenderer\.on\('updates:changed', listener\)[\s\S]*?return \(\) => ipcRenderer\.removeListener\('updates:changed', listener\)/)
})

test('createUpdateChecks: dropNotice removes a skipped notice from the status', async () => {
  const checks = createUpdateChecks({
    disabled: false,
    guard: guard(),
    update: async () => ({ status: 'current' }),
    notices: async () => [
      { tool: 'datalad', latest: '2.0', message: 'a' },
      { tool: 'git-annex', latest: '2.0', message: 'b' }
    ]
  })
  await checks.start(() => {})
  checks.dropNotice('datalad', '2.0')
  assert.deepEqual(checks.status().notices.map((n) => n.tool), ['git-annex'])
})

test('updates:skip handler drops the notice from the cached status', () => {
  assert.match(handler('updates:skip'), /updateChecks\.dropNotice\(tool, version\)/)
})
