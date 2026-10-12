// A suggested save message for the files about to be saved ("Update a.tsv and 2 more").
// Pure; the UI shows it as a placeholder and lets the user accept it with one click.

const VERBS = { untracked: 'Add', added: 'Add', deleted: 'Delete', renamed: 'Rename' }
const verbFor = (status) => VERBS[status] ?? 'Update'
const baseName = (path) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** @param {Array<{ path: string, status: string }>} files */
export function suggestMessage(files) {
  if (files.length === 0) {
    return ''
  }
  const verbs = new Set(files.map((file) => verbFor(file.status)))
  const verb = verbs.size === 1 ? [...verbs][0] : 'Update'
  if (files.length === 1) {
    return `${verb} ${baseName(files[0].path)}`
  }
  if (files.length <= 3) {
    return `${verb} ${baseName(files[0].path)} and ${files.length - 1} more`
  }
  return `${verb} ${files.length} files`
}
