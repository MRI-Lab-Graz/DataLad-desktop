import test from 'node:test'
import assert from 'node:assert/strict'
import { isRunCommit, parseRunRecord } from '../src/gui/renderer/run-record.js'

const REAL = `[DATALAD RUNCMD] count bytes

=== Do not change lines below ===
{
 "chain": [],
 "cmd": "wc -c big.bin > size.txt",
 "dsid": "78724cf9-1a42-46be-946f-db4fd4fcf173",
 "exit": 0,
 "extra_inputs": [],
 "inputs": ["big.bin"],
 "outputs": ["size.txt"],
 "pwd": "."
}
^^^ Do not change lines above ^^^`

test('parseRunRecord reads the command, exit code, inputs and outputs of a datalad run commit', () => {
  assert.deepEqual(parseRunRecord(REAL), {
    cmd: 'wc -c big.bin > size.txt', exit: 0, inputs: ['big.bin'], outputs: ['size.txt'], pwd: '.'
  })
})

test('parseRunRecord copes with Windows line endings', () => {
  assert.equal(parseRunRecord(REAL.replace(/\n/g, '\r\n'))?.cmd, 'wc -c big.bin > size.txt')
})

test('parseRunRecord reports a record kept in a sidecar file', () => {
  const sidecar = '[DATALAD RUNCMD] s\n\n=== Do not change lines below ===\n"096af45aed7a10156f034044fb8f7849"\n^^^ Do not change lines above ^^^'
  assert.deepEqual(parseRunRecord(sidecar), { sidecar: true })
})

test('parseRunRecord joins a command stored as a list', () => {
  assert.equal(parseRunRecord(REAL.replace('"wc -c big.bin > size.txt"', '["python", "a.py"]'))?.cmd, 'python a.py')
})

test('parseRunRecord returns null for ordinary saves and hand-edited records', () => {
  assert.equal(parseRunRecord('ordinary save'), null)
  assert.equal(parseRunRecord(REAL.replace('"exit": 0,', '"exit": 0,,')), null)
  assert.equal(parseRunRecord('[DATALAD RUNCMD] no block'), null)
  assert.equal(parseRunRecord(undefined), null)
})

test('isRunCommit recognises the run subject prefix', () => {
  assert.equal(isRunCommit('[DATALAD RUNCMD] count bytes'), true)
  assert.equal(isRunCommit('fix typo'), false)
})
