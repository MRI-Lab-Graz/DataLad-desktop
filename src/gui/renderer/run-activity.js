// Pure helpers for the "running commands" strip, kept out of app.js so they are
// unit-testable (same idea as save-gating.js).
import { escapeHtml } from './escape-html.js'

const ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
// OSC sequences (window titles, hyperlinks) end with BEL or ESC \\.
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g
// Everything non-printable except tab, newline and carriage return.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

export function createRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatActivityLine(line, max = 120) {
  const clean = String(line ?? '')
    .replace(ANSI_ESCAPE, '')
    .replace(OSC_SEQUENCE, '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function formatProgress(done, total) {
  if (total > 0) {
    return `${Math.min(done, total)} of ${total} files`
  }
  return `${done} file${done === 1 ? '' : 's'} done`
}

export function renderRunningRows(runs) {
  return runs
    .map((run) => {
      const id = escapeHtml(run.runId)
      const label = escapeHtml(run.label)
      const button = run.stopping
        ? '<button type="button" class="button button-ghost button-inline" disabled>Stopping…</button>'
        : `<button type="button" class="button button-ghost button-inline" data-cancel-run="${id}" aria-label="Cancel ${label}">Cancel</button>`
      return (
        `<div class="running-row" data-run-row="${id}">` +
        `<span class="running-label">${label}…</span>` +
        (run.progress ? `<span class="running-progress">${escapeHtml(run.progress)}</span>` : '') +
        `<span class="running-line" aria-live="off">${escapeHtml(run.line)}</span>` +
        button +
        '</div>'
      )
    })
    .join('')
}

// Multi-step flows (BIDS nesting) must stop at the first cancelled step, or at a
// missing git identity (every later step would fail the same way).
export function shouldStopSequence(result) {
  const code = result?.userError?.code
  return Boolean(result?.cancelled) || code === 'CANCELLED' || code === 'IDENTITY_MISSING'
}

// Returned instead of starting another step once a sequence has been stopped.
// Shaped like a real runner result so the result renderers accept it.
export function cancelledResult(commandName) {
  return {
    ok: false,
    cancelled: true,
    commandName,
    exitCode: 130,
    stdout: '',
    stderr: '',
    failed: true,
    warnings: [],
    userError: {
      code: 'CANCELLED',
      title: 'Stopped',
      message: 'Stopped by you. Nothing was rolled back - check the project status before continuing.',
      technicalDetails: ''
    }
  }
}

export function formatDurationLine(durationMs, cancelled = false) {
  const seconds = durationMs / 1000
  const text = seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)
  return cancelled ? `Stopped after ${text}s.` : `Command finished in ${text}s.`
}

// A cancelled result's message is already the headline; repeating it as the
// body paragraph made the panel say the same sentence twice.
export function shouldShowUserErrorMessage(result) {
  return !result.ok && Boolean(result.userError) && !result.cancelled
}
