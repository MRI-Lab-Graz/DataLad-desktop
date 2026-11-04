// Turns the update status from the main process into plain lines for the notice strip.
// Pure: text only, rendered later with textContent (never innerHTML).
export function describeUpdates(status) {
  if (!status || status.disabled) return { lines: [] }
  const lines = []
  const validator = status.validator
  const refreshEnv = validator?.status === 'updated' // the Setup status line still shows the old version
  if (refreshEnv) {
    lines.push({ text: `prism-validator was updated from ${validator.from} to ${validator.to}.` })
  } else if (validator?.status === 'failed') {
    lines.push({ text: 'prism-validator has a newer version that could not be installed. The current one keeps working.' })
  }
  for (const n of status.notices ?? []) {
    lines.push({ text: n.message, skip: { tool: n.tool, version: n.latest } })
  }
  return refreshEnv ? { lines, refreshEnv } : { lines }
}
