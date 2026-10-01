// Pure helpers for the "running commands" strip, kept out of app.js so they are
// unit-testable (same idea as save-gating.js).
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

// The activity line is process output (untrusted): always escape.
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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
        `<span class="running-line" aria-live="off">${escapeHtml(run.line)}</span>` +
        button +
        '</div>'
      )
    })
    .join('')
}

// Multi-step flows (BIDS nesting) must stop at the first cancelled step.
export function shouldStopSequence(result) {
  return Boolean(result?.cancelled) || result?.userError?.code === 'CANCELLED'
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
