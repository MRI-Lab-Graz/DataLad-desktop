import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cancelledResult,
  createRunId,
  formatActivityLine,
  renderRunningRows,
  shouldStopSequence
} from '../src/gui/renderer/run-activity.js'

test('createRunId yields distinct ids the main process accepts', () => {
  const ids = new Set(Array.from({ length: 50 }, () => createRunId()))
  assert.equal(ids.size, 50)
  for (const id of ids) {
    assert.match(id, /^[\w-]{1,80}$/)
  }
})

test('formatActivityLine strips terminal escapes, collapses whitespace and truncates', () => {
  assert.equal(formatActivityLine('\u001b[32mget(ok)\u001b[0m:   sub-01/T1w.nii.gz  '), 'get(ok): sub-01/T1w.nii.gz')
  assert.equal(formatActivityLine(undefined), '')
  const long = formatActivityLine('x'.repeat(500), 40)
  assert.equal(long.length, 40)
  assert.ok(long.endsWith('…'))
})

// Review focus 2: process output is untrusted, it must never become markup.
test('renderRunningRows escapes labels and activity text', () => {
  const html = renderRunningRows([
    { runId: 'r1', label: '<img src=x onerror=alert(1)>', line: '<script>alert(2)</script> & "quoted"', stopping: false }
  ])

  assert.doesNotMatch(html, /<img|<script/)
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt; &amp; &quot;quoted&quot;/)
})

test('renderRunningRows offers a named Cancel button, or a disabled Stopping state', () => {
  const [active, stopping] = [
    renderRunningRows([{ runId: 'run-1', label: 'Save', line: 'adding', stopping: false }]),
    renderRunningRows([{ runId: 'run-1', label: 'Save', line: 'adding', stopping: true }])
  ]

  assert.match(active, /data-cancel-run="run-1"/)
  assert.match(active, /aria-label="Cancel Save"/)
  assert.doesNotMatch(stopping, /data-cancel-run/)
  assert.match(stopping, /disabled>Stopping…/)
  assert.equal(renderRunningRows([]), '')
})

// Review focus 4: a cancelled step must end a multi-step sequence.
test('shouldStopSequence is true only for a cancelled result', () => {
  assert.equal(shouldStopSequence({ ok: false, cancelled: true }), true)
  assert.equal(shouldStopSequence({ ok: false, userError: { code: 'CANCELLED' } }), true)
  assert.equal(shouldStopSequence({ ok: false, userError: { code: 'REPO_LOCKED' } }), false)
  assert.equal(shouldStopSequence({ ok: true }), false)
  assert.equal(shouldStopSequence(null), false)
})

// A stopped multi-step sequence must not start its next step; it gets this
// result instead, shaped like a real runner result so renderers accept it.
test('cancelledResult is a renderable cancelled result that stops sequences', () => {
  const result = cancelledResult('save')

  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(result.commandName, 'save')
  assert.equal(result.userError.code, 'CANCELLED')
  assert.equal(shouldStopSequence(result), true)
  for (const field of ['stdout', 'stderr']) {
    assert.equal(result[field], '')
  }
  assert.deepEqual(result.warnings, [])
})

// Review minor #11: OSC titles, BEL, backspace and stray ESC are inert in the
// DOM but show up as garbage in the activity line.
test('formatActivityLine also strips OSC sequences and control characters', () => {
  assert.equal(formatActivityLine('\u001b]0;window title\u0007hello\u0007\bworld\u001b'), 'helloworld')
  assert.equal(formatActivityLine('keep\ttabs\nand\rwhitespace'), 'keep tabs and whitespace')
})
