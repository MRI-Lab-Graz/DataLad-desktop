// Network shares replace the SSH / studies-server workflow; nothing of the
// old feature may linger in the public surface.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { COMMAND_SCHEMAS } from '../src/datalad/schema.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'
import { DataLadAdapter } from '../src/datalad/adapter.js'

test('createSibling is not a supported command', () => {
  assert.equal(COMMAND_SCHEMAS.createSibling, undefined)
})

test('ProcessRunner has no SSH password support', () => {
  const runner = new ProcessRunner()
  for (const name of ['setSshPassword', 'clearSshPassword', 'hasSshPassword']) {
    assert.equal(runner[name], undefined, name)
  }
})

test('DataLadAdapter has no studies-server API', () => {
  const adapter = new DataLadAdapter()
  for (const name of ['listRemoteStudies', 'setStudiesServerPassword', 'clearStudiesServerPassword', 'hasStudiesServerPassword']) {
    assert.equal(adapter[name], undefined, name)
  }
})

test('SSH askpass helpers and studies-server settings are gone', () => {
  for (const file of [
    'src/datalad/ssh-askpass.sh',
    'src/datalad/ssh-askpass.cmd',
    'src/gui/settings.js',
    'config/studies-server.local.example.json'
  ]) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, file)
  }
})
