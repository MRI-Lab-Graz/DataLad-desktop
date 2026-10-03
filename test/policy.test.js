import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPolicy, policyFiles } from '../src/gui/policy.js'

test('loadPolicy leaves the console allowed by default', () => {
  assert.deepEqual(loadPolicy({ env: {}, files: ['/nonexistent/policy.json'] }), { consoleDisabled: false })
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
    assert.ok(policyFiles({ platform, env: {}, resourcesDir: resources }).some((f) => f.startsWith(resources)), 'resources policy still honoured')
  }
})
