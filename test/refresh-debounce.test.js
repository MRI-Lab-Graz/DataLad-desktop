import test from 'node:test'
import assert from 'node:assert/strict'
import { createDebouncer } from '../src/gui/refresh-debounce.js'

test('coalesces rapid triggers into a single call', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let callCount = 0
  const debouncer = createDebouncer(() => {
    callCount += 1
  }, 400)

  debouncer.trigger()
  t.mock.timers.tick(100)
  debouncer.trigger()
  t.mock.timers.tick(100)
  debouncer.trigger()
  t.mock.timers.tick(399)
  assert.equal(callCount, 0)

  t.mock.timers.tick(1)
  assert.equal(callCount, 1)
})

test('fires again for triggers spaced further apart than the delay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let callCount = 0
  const debouncer = createDebouncer(() => {
    callCount += 1
  }, 400)

  debouncer.trigger()
  t.mock.timers.tick(400)
  assert.equal(callCount, 1)

  debouncer.trigger()
  t.mock.timers.tick(400)
  assert.equal(callCount, 2)
})

test('cancel prevents a pending call from firing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let callCount = 0
  const debouncer = createDebouncer(() => {
    callCount += 1
  }, 400)

  debouncer.trigger()
  debouncer.cancel()
  t.mock.timers.tick(1000)
  assert.equal(callCount, 0)
})

test('passes trigger arguments through to the callback', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let received = null
  const debouncer = createDebouncer((payload) => {
    received = payload
  }, 400)

  debouncer.trigger({ projectPath: '/tmp/project' })
  t.mock.timers.tick(400)
  assert.deepEqual(received, { projectPath: '/tmp/project' })
})
