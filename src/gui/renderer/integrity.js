// Pure summary of `git annex fsck --json` output (one JSON object per checked file).
export function summarizeFsck(stdout) {
  let checked = 0
  const damaged = []
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.command !== 'fsck') {
      continue
    }
    checked++
    if (entry.success === false) {
      damaged.push(entry.file)
    }
  }
  return { checked, damaged }
}
