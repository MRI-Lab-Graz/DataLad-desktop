import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createBusyCounter, createFetchJson, createUpdateChecks, feedUrl, runUnlessBusy, withDefaultTimeout } from '../src/gui/update-runner.js'

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

test('withDefaultTimeout: 15 s unless the caller passes its own', async () => {
  const seen = []
  const runner = withDefaultTimeout({ run: async (c, a, o) => seen.push(o) })
  await runner.run('x', [])
  await runner.run('x', [], { timeoutMs: 120000, env: { A: '1' } })
  assert.deepEqual(seen, [{ timeoutMs: 15000 }, { timeoutMs: 120000, env: { A: '1' } }])
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

test('the background run is built from the policy switch, the install lock and the busy counter', () => {
  assert.match(main, /disabled: policy\.updateCheckDisabled/)
  assert.match(main, /guard: ensureGuard/)
  assert.match(main, /isBusy: validatorUse\.isBusy/)
  // The 15 s default is for version checks only; the build has its own timeouts and must get the plain runner.
  const update = main.slice(main.indexOf('updateValidator({'), main.indexOf('})', main.indexOf('updateValidator({')))
  assert.match(update, /runner: toolRunner,/)
  assert.match(main, /const noticeRunner = withDefaultTimeout\(toolRunner\)/)
  assert.match(main, /collectNotices\(\{ runner: \(command, args, options\) => noticeRunner\.run\(command, args, options\)/)
})

test('both validator call sites are wrapped by the busy counter', () => {
  assert.match(handler('adapter:runCommand'), /validatorUse\.track\(\(\) =>\s*gateSave\(/)
  assert.match(handler('prism:inspect'), /validatorUse\.track\(\(\) =>\s*inspectProject\(/)
})

test('the feed override is honoured only in an unpackaged app', () => {
  assert.match(main, /createFetchJson\(\{ override: app\.isPackaged \? undefined : process\.env\.DLAD_UPDATE_FEED \}\)/)
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
