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
  const runner = async (command, args) => {
    calls.push([command, args])
    const name = command.endsWith('datalad') ? 'datalad' : 'git-annex'
    if (out[name] === null) return { failed: true, exitCode: 1, stdout: '', stderr: 'x' }
    return { failed: false, exitCode: 0, stdout: out[name], stderr: '' }
  }
  const latest = { dl: '1.8.0', ga: '10.20261026', ...over.latest }
  const fetchJson = async (url) => {
    if (over.fetchFails) throw new Error('offline')
    if (url === 'https://pypi.org/pypi/datalad/json') return { info: { version: latest.dl } }
    if (url === 'https://formulae.brew.sh/api/formula/git-annex.json') return { versions: { stable: latest.ga } }
    throw new Error('unexpected ' + url)
  }
  const resolve = (n) => (over.noResolve ? null : (over.dir ?? BREW) + n)
  return { userDataDir, runner, fetchJson, resolve, calls }
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
  assert.deepEqual(c.calls[0], [BREW + 'datalad', ['--version']])
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
  await skipNotice({ userDataDir: c.userDataDir, tool: 'git-annex', version: '1' })
  assert.deepEqual(await collectNotices(c), [])
  const saved = JSON.parse(await readFile(join(c.userDataDir, 'update-notices.json'), 'utf8'))
  assert.deepEqual(saved.skipped, { datalad: '1.8.0', 'git-annex': '1' })
  const n = await collectNotices({ ...c, fetchJson: async () => ({ info: { version: '1.9.0' } }) })
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
