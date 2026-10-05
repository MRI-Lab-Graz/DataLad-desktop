// Reads the provenance record `datalad run` writes into its commit message. Display only:
// re-running it would execute a command taken from (possibly cloned) history.
const RUN_PREFIX = '[DATALAD RUNCMD]'
const RECORD_BLOCK = /=== Do not change lines below ===\n([\s\S]*?)\n\^\^\^ Do not change lines above \^\^\^/
const list = (value) => (Array.isArray(value) ? value.map(String) : [])

export function isRunCommit(subject) {
  return String(subject ?? '').startsWith(RUN_PREFIX)
}

export function parseRunRecord(message) {
  const text = String(message ?? '').replace(/\r\n/g, '\n')
  const block = isRunCommit(text) && text.match(RECORD_BLOCK)
  if (!block) {
    return null
  }
  let record
  try {
    record = JSON.parse(block[1])
  } catch {
    return null
  }
  if (typeof record === 'string') {
    return { sidecar: true }
  }
  const cmd = Array.isArray(record?.cmd) ? record.cmd.join(' ') : record?.cmd
  if (typeof cmd !== 'string') {
    return null
  }
  return {
    cmd,
    exit: Number.isInteger(record.exit) ? record.exit : null,
    inputs: list(record.inputs),
    outputs: list(record.outputs),
    pwd: typeof record.pwd === 'string' ? record.pwd : '.'
  }
}
