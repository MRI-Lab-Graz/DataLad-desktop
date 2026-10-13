// Pure logic for the Run & record form. No DOM access; same pattern as save-gating.js.

/** One trimmed entry per non-empty line of a textarea. */
export function linesOf(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

const MESSAGE_COMMAND_CHARS = 60

/** "Run: python summarize.py", from the command's first line. */
export function defaultRunMessage(command) {
  const first = String(command ?? '').trim().split(/\r?\n/)[0].trim()
  if (!first) {
    return ''
  }
  return `Run: ${first.length > MESSAGE_COMMAND_CHARS ? `${first.slice(0, MESSAGE_COMMAND_CHARS)}…` : first}`
}

/**
 * @param {{ command: string, message: string, clean: boolean | undefined }} input clean: no unsaved changes
 *   (undefined until the status was read; DataLad refuses a dirty project anyway)
 */
export function computeRunGating({ command, message, clean }) {
  if (clean === false) {
    return { disabled: true, hint: 'Save your changes first, so the result contains only what this command made.' }
  }
  return { disabled: !String(command ?? '').trim() || !String(message ?? '').trim(), hint: '' }
}
