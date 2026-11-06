// Path list for the native "Delete without a safety check?" dialog. Names come from the dataset, so control,
// line-break and bidi characters become spaces: nothing can fake extra lines or reorder the text.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g
const MAX_LEN = 200

export function previewPaths(paths, max = 5) {
  const lines = paths.slice(0, max).map((p) => {
    const s = String(p).replace(UNSAFE, ' ')
    return '\n  ' + (s.length > MAX_LEN ? s.slice(0, MAX_LEN) + '…' : s)
  })
  if (paths.length > max) lines.push(`\n  and ${paths.length - max} more`)
  return lines.join('')
}
