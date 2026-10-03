import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPolicy } from '../src/gui/policy.js'

test('loadPolicy leaves the console allowed by default', () => {
  assert.deepEqual(loadPolicy({ env: {}, file: '/nonexistent/policy.json' }), { consoleDisabled: false })
})

test('loadPolicy disables the console from the environment', () => {
  assert.equal(loadPolicy({ env: { DATALAD_DESKTOP_DISABLE_CONSOLE: '1' }, file: '/nonexistent' }).consoleDisabled, true)
})

test('loadPolicy disables the console from policy.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, JSON.stringify({ consoleDisabled: true }))
  assert.equal(loadPolicy({ env: {}, file }).consoleDisabled, true)
})

test('loadPolicy fails closed when policy.json exists but is unreadable JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-'))
  const file = join(dir, 'policy.json')
  await writeFile(file, '{ not json')
  assert.equal(loadPolicy({ env: {}, file }).consoleDisabled, true)
})
