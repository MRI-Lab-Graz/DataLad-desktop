// Counts DataLad's per-file result lines ("get(ok): a.nii (file) [...]") across output chunks.
const FILE_RESULT = /^(?:get|copy)\((?:ok|notneeded)\): .* \(file\)/

export function createResultCounter() {
  let partial = ''
  let count = 0
  return {
    push(chunk) {
      const lines = (partial + String(chunk)).split(/\r?\n/)
      partial = lines.pop()
      for (const line of lines) {
        if (FILE_RESULT.test(line)) {
          count++
        }
      }
      return count
    }
  }
}
