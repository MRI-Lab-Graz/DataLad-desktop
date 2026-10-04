import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPolicy, policyFiles } from '../src/gui/policy.js'

test('loadPolicy leaves the console allowed by default', () => {
  assert.deepEqual(loadPolicy({ env: {}, files: ['/nonexistent/policy.json'] }), { consoleDisabled: false, trustedRoots: [] })
})

test('loadPolicy disables the console from the environment', () => {
  assert.equal(loadPolicy({ env: { DATALAD_DESKTOP_DISABLE_CONSOLE: '1' }, files: ['/nonexistent'] }).consoleDisabled, true)
})

test('loadPolicy disables the console from policy.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, JSON.stringify({ consoleDisabled: true }))
  assert.equal(loadPolicy({ env: {}, files: [file] }).consoleDisabled, true)
})

test('loadPolicy fails closed when policy.json exists but is unreadable JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, '{ not json')
  assert.equal(loadPolicy({ env: {}, files: [file] }).consoleDisabled, true)
})

test('loadPolicy: any one of several policy files that disables the console wins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const off = join(dir, 'a.json')
  const on = join(dir, 'b.json')
  await writeFile(off, JSON.stringify({ consoleDisabled: true }))
  await writeFile(on, JSON.stringify({ consoleDisabled: false }))
  assert.equal(loadPolicy({ env: {}, files: [on, '/nonexistent', off] }).consoleDisabled, true)
  assert.equal(loadPolicy({ env: {}, files: [on, '/nonexistent'] }).consoleDisabled, false)
})

// An update removes the whole install folder, so an admin's policy must live outside it.
test('policyFiles puts the admin policy in a system location that survives updates, per platform', () => {
  const resources = '/opt/app/resources'
  const win = policyFiles({ platform: 'win32', env: { ProgramData: 'D:\\PD' }, resourcesDir: resources })
  assert.ok(win[0].endsWith('policy.json') && win[0].includes('PD') && win[0].includes('DataLad Desktop'))
  assert.deepEqual(policyFiles({ platform: 'darwin', env: {}, resourcesDir: resources })[0], '/Library/Application Support/DataLad Desktop/policy.json')
  assert.deepEqual(policyFiles({ platform: 'linux', env: {}, resourcesDir: resources })[0], '/etc/datalad-desktop/policy.json')
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.ok(policyFiles({ platform, env: {}, resourcesDir: resources }).some((f) => f.startsWith(join(resources))), 'resources policy still honoured')
  }
})

test('loadPolicy reads trustedRoots from every policy file and keeps only absolute paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const first = join(dir, 'a.json')
  const second = join(dir, 'b.json')
  const share = join(dir, 'share')
  const other = join(dir, 'other')
  await writeFile(first, JSON.stringify({ trustedRoots: [share, 'relative/path', 7, '', null] }))
  await writeFile(second, JSON.stringify({ trustedRoots: [other, share] }))
  assert.deepEqual(loadPolicy({ env: {}, files: [first, second] }).trustedRoots, [share, other])
})

test('loadPolicy ignores a trustedRoots value that is not a list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, JSON.stringify({ trustedRoots: join(dir, 'share') }))
  assert.deepEqual(loadPolicy({ env: {}, files: [file] }).trustedRoots, [])
})

test('loadPolicy: an unreadable policy file contributes no trusted roots and still locks the console', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const good = join(dir, 'good.json')
  const bad = join(dir, 'bad.json')
  await writeFile(good, JSON.stringify({ trustedRoots: [join(dir, 'share')] }))
  await writeFile(bad, '{ not json')
  const policy = loadPolicy({ env: {}, files: [bad, good] })
  assert.deepEqual(policy.trustedRoots, [join(dir, 'share')])
  assert.equal(policy.consoleDisabled, true)
  assert.deepEqual(loadPolicy({ env: {}, files: [bad] }).trustedRoots, [])
})
