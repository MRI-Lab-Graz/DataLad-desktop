import test from 'node:test'
import assert from 'node:assert/strict'
import { createRunRegistry, createLatestLineThrottle } from '../src/gui/run-registry.js'
import { QUIT_ABORT_REASON } from '../src/datalad/kill-tree.js'

test('register returns a live signal and cancel aborts it exactly once', () => {
  const registry = createRunRegistry()
  const signal = registry.register('run-1')

  assert.equal(signal.aborted, false)
  assert.equal(registry.cancel('run-1'), true)
  assert.equal(signal.aborted, true)
  assert.equal(registry.cancel('run-1'), false, 'a second cancel is a no-op')
})

// Review focus 1: a cancel click that races completion must be a silent false.
test('cancel on a finished or unknown run returns false instead of throwing', () => {
  const registry = createRunRegistry()
  registry.register('run-1')
  registry.finish('run-1')

  assert.equal(registry.cancel('run-1'), false)
  assert.equal(registry.cancel('never-existed'), false)
  assert.equal(registry.size(), 0)
})

// Review focus 3: ids come from the renderer, which main does not fully trust.
test('register rejects invalid and duplicate run ids without registering them', () => {
  const registry = createRunRegistry()
  for (const bad of [undefined, null, 42, '', 'a b', '../x', 'x'.repeat(81), {}]) {
    assert.throws(() => registry.register(bad), /runId/)
  }
  registry.register('dup')
  assert.throws(() => registry.register('dup'), /already active/)
  assert.equal(registry.size(), 1)
})

// Review focus 5: quitting mid-command must not orphan child processes.
test('abortAll aborts every active run', () => {
  const registry = createRunRegistry()
  const signals = ['a', 'b', 'c'].map((id) => registry.register(id))
  registry.abortAll()

  assert.ok(signals.every((signal) => signal.aborted))
  assert.ok(signals.every((signal) => signal.reason === QUIT_ABORT_REASON), 'quit aborts carry the quit reason')
})

test('throttle sends the first line at once, then only the newest line per interval', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const sent = []
  const throttle = createLatestLineThrottle((line) => sent.push(line), 250)

  throttle.push('a')
  throttle.push('b')
  throttle.push('c')
  assert.deepEqual(sent, ['a'])

  t.mock.timers.tick(250)
  assert.deepEqual(sent, ['a', 'c'])

  t.mock.timers.tick(250)
  throttle.push('d')
  assert.deepEqual(sent, ['a', 'c', 'd'])
})

test('throttle stop drops the pending line and cancels the timer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const sent = []
  const throttle = createLatestLineThrottle((line) => sent.push(line), 250)

  throttle.push('a')
  throttle.push('b')
  throttle.stop()
  t.mock.timers.tick(1000)

  assert.deepEqual(sent, ['a'])
})
