import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPolicy, policyFiles } from '../src/gui/policy.js'

test('loadPolicy has no trusted roots by default', () => {
  assert.deepEqual(loadPolicy({ env: {}, files: ['/nonexistent/policy.json'] }), { trustedRoots: [], runDisabled: false })
})

test('loadPolicy ignores keys it does not know, such as the old consoleDisabled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, JSON.stringify({ consoleDisabled: true, trustedRoots: ['/lab/share'] }))
  assert.deepEqual(loadPolicy({ env: {}, files: [file] }), { trustedRoots: ['/lab/share'], runDisabled: false })
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

test('loadPolicy: an unreadable policy file contributes no trusted roots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const good = join(dir, 'good.json')
  const bad = join(dir, 'bad.json')
  await writeFile(good, JSON.stringify({ trustedRoots: [join(dir, 'share')] }))
  await writeFile(bad, '{ not json')
  assert.deepEqual(loadPolicy({ env: {}, files: [bad, good] }), { trustedRoots: [join(dir, 'share')], runDisabled: true })
  assert.deepEqual(loadPolicy({ env: {}, files: [bad] }).trustedRoots, [])
})

test('loadPolicy: DATALAD_DESKTOP_DISABLE_RUN=1 or runDisabled in policy.json turns Run & record off', async () => {
  assert.equal(loadPolicy({ env: { DATALAD_DESKTOP_DISABLE_RUN: '1' }, files: ['/nonexistent'] }).runDisabled, true)
  assert.equal(loadPolicy({ env: {}, files: ['/nonexistent'] }).runDisabled, false)
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const off = join(dir, 'a.json')
  const on = join(dir, 'b.json')
  await writeFile(off, JSON.stringify({ runDisabled: true }))
  await writeFile(on, JSON.stringify({ runDisabled: false }))
  assert.equal(loadPolicy({ env: {}, files: [on, '/nonexistent', off] }).runDisabled, true)
  assert.equal(loadPolicy({ env: {}, files: [on] }).runDisabled, false)
})

test('loadPolicy fails closed: a policy.json that exists but cannot be read turns Run & record off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const bad = join(dir, 'bad.json')
  await writeFile(bad, '{ not json')
  assert.equal(loadPolicy({ env: {}, files: [bad] }).runDisabled, true)
})
