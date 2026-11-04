import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectNotices, skipNotice } from '../src/datalad/tool-notices.js'

const BREW = '/opt/homebrew/Cellar/x/bin/'
const mk = async (over = {}) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'notices-'))
  const calls = []
  const out = { datalad: 'datalad 1.7.2\n', 'git-annex': 'git-annex version: 10.20261026\n', ...over.out }
  const runner = async (command, args, options) => {
    calls.push([command, args, options])
    const name = command.endsWith('datalad') ? 'datalad' : 'git-annex'
    if (out[name] === null) return { failed: true, exitCode: 1, stdout: '', stderr: 'x' }
    return { failed: false, exitCode: 0, stdout: out[name], stderr: '' }
  }
  const latest = { dl: '1.8.0', ga: '10.20261026', ...over.latest }
  const fetchJson = async (url) => {
    if (over.fetchFails) throw new Error('offline')
    calls.push(url)
    if (url === 'https://pypi.org/pypi/datalad/json') return { info: { version: latest.dl } }
    if (url === 'https://formulae.brew.sh/api/formula/datalad.json') return { versions: { stable: latest.brewDl ?? latest.dl } }
    if (url === 'https://formulae.brew.sh/api/formula/git-annex.json') return { versions: { stable: latest.ga } }
    throw new Error('unexpected ' + url)
  }
  const resolve = (n) => (over.noResolve ? null : (over.dir ?? BREW) + n)
  return { userDataDir, runner, fetchJson, resolve, calls, platform: over.platform ?? 'darwin' }
}

test('newer DataLad gives one notice naming both versions', async () => {
  const c = await mk()
  const n = await collectNotices(c)
  assert.equal(n.length, 1)
  assert.equal(n[0].tool, 'datalad')
  assert.equal(n[0].installed, '1.7.2')
  assert.equal(n[0].latest, '1.8.0')
  assert.match(n[0].message, /1\.8\.0/)
  assert.match(n[0].message, /1\.7\.2/)
  assert.deepEqual(c.calls[0], [BREW + 'datalad', ['--version'], { timeoutMs: 15000 }]) // a hanging version check must not hang the start
})

test('equal or newer installed gives no notice', async () => {
  assert.deepEqual(await collectNotices(await mk({ latest: { dl: '1.7.2' } })), [])
})

test('git-annex with date-like versions', async () => {
  const n = await collectNotices(await mk({ latest: { dl: '1.7.2', ga: '10.20261105' } }))
  assert.equal(n.length, 1)
  assert.equal(n[0].tool, 'git-annex')
  assert.match(n[0].message, /brew upgrade git-annex/)
})

test('Homebrew path adds the brew line, other paths do not', async () => {
  const brew = await collectNotices(await mk())
  assert.match(brew[0].message, /\nUpdate it with: brew upgrade datalad$/)
  const other = await collectNotices(await mk({ dir: 'C:\\Users\\a\\AppData\\' }))
  assert.doesNotMatch(other[0].message, /brew/)
  assert.match(other[0].message, /Update it the same way you installed it\./)
})

test('skip applies to exactly that latest, a newer one shows again', async () => {
  const c = await mk()
  await skipNotice({ userDataDir: c.userDataDir, tool: 'datalad', version: '1.8.0' })
  await skipNotice({ userDataDir: c.userDataDir, tool: 'git-annex', version: '10.1' }) // keeps the datalad entry
  assert.deepEqual(await collectNotices(c), [])
  const saved = JSON.parse(await readFile(join(c.userDataDir, 'update-notices.json'), 'utf8'))
  assert.deepEqual(saved.skipped, { datalad: '1.8.0', 'git-annex': '10.1' })
  const n = await collectNotices({ ...c, fetchJson: async () => ({ info: { version: '1.9.0' }, versions: { stable: '1.9.0' } }) })
  assert.equal(n[0].latest, '1.9.0')
})

test('skipNotice creates the folder', async () => {
  const base = await mkdtemp(join(tmpdir(), 'notices-'))
  const dir = join(base, 'new', 'dir')
  await skipNotice({ userDataDir: dir, tool: 'datalad', version: '2.0' })
  assert.equal(JSON.parse(await readFile(join(dir, 'update-notices.json'), 'utf8')).skipped.datalad, '2.0')
})

test('corrupt skip file means nothing skipped', async () => {
  const c = await mk()
  await writeFile(join(c.userDataDir, 'update-notices.json'), '{nope')
  assert.equal((await collectNotices(c)).length, 1)
})

test('failures give no notice and never throw', async () => {
  assert.deepEqual(await collectNotices(await mk({ fetchFails: true })), [])
  assert.deepEqual(await collectNotices(await mk({ out: { datalad: null } })), [])
  assert.deepEqual(await collectNotices(await mk({ noResolve: true })), [])
  assert.deepEqual(await collectNotices(await mk({ latest: { dl: 'garbage' } })), [])
  const c = await mk()
  assert.deepEqual(await collectNotices({ ...c, runner: async () => { throw new Error('boom') } }), [])
})

// --- final fix wave ---
test('no DataLad notice for the DataLad the app installed itself (a datalad-env folder)', async () => {
  for (const dir of ['C:\\Users\\a\\AppData\\Local\\DataLad Desktop\\DataLad-Env\\Scripts\\', '/Applications/x/datalad-env/bin/']) {
    const n = await collectNotices(await mk({ dir, platform: 'win32' }))
    assert.deepEqual(n.map((x) => x.tool), [], dir)
  }
  // a folder merely starting with the name does not count
  assert.equal((await collectNotices(await mk({ dir: '/x/datalad-envy/bin/', platform: 'linux' }))).length, 1)
})

test('DataLad from Homebrew is compared with the Homebrew formula, not PyPI', async () => {
  const c = await mk({ latest: { dl: '1.8.0', brewDl: '1.7.2' } })
  assert.deepEqual(await collectNotices(c), []) // PyPI has 1.8.0 but Homebrew does not ship it yet
  assert.ok(c.calls.includes('https://formulae.brew.sh/api/formula/datalad.json'))
  assert.ok(!c.calls.includes('https://pypi.org/pypi/datalad/json'))
})

test('the brew hint and the Homebrew feed are for macOS only', async () => {
  for (const platform of ['linux', 'win32']) {
    const c = await mk({ platform })
    const n = await collectNotices(c)
    assert.equal(n.length, 1, platform)
    assert.doesNotMatch(n[0].message, /brew/, platform)
    assert.ok(c.calls.includes('https://pypi.org/pypi/datalad/json'), platform)
  }
  // a Windows path with a homebrew folder in it is not Homebrew
  const win = await collectNotices(await mk({ dir: 'C:\\tools\\homebrew\\bin\\', platform: 'win32' }))
  assert.doesNotMatch(win[0].message, /brew/)
  const mac = await collectNotices(await mk({ dir: '/opt/homebrew/bin/' }))
  assert.match(mac[0].message, /brew upgrade datalad/)
})

test('a hostile version string shows only its version number', async () => {
  const n = await collectNotices(await mk({ out: { datalad: 'datalad 1.7.2; rm -rf /' }, latest: { dl: '1.8.0; rm -rf' } }))
  assert.equal(n[0].latest, '1.8.0')
  assert.equal(n[0].installed, '1.7.2')
  assert.doesNotMatch(n[0].message, /rm -rf/)
})

test('skipNotice ignores an unknown tool or a version that is not a plain version number', async () => {
  const c = await mk()
  await skipNotice({ userDataDir: c.userDataDir, tool: 'datalad', version: '1.8.0' })
  for (const [tool, version] of [['__proto__', '1.0'], ['git', '1.0'], ['git-annex', '1.0; rm'], ['git-annex', 10], ['git-annex', undefined], ['git-annex', 'v1.0']]) {
    await skipNotice({ userDataDir: c.userDataDir, tool, version })
  }
  const saved = JSON.parse(await readFile(join(c.userDataDir, 'update-notices.json'), 'utf8'))
  assert.deepEqual(saved, { skipped: { datalad: '1.8.0' } })
})
