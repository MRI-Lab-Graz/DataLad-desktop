// Create Project asks for a parent folder and a project name; the project lives at location/name.
// The name must stay one path segment so it cannot escape the chosen location.
export function joinProjectPath(location, name) {
  const parent = location.trim()
  const leaf = name.trim()
  if (!parent) return { error: 'Choose a location first.' }
  if (!leaf) return { error: 'Enter a project name.' }
  if (leaf === '.' || leaf === '..' || /[\\/]/.test(leaf)) {
    return { error: 'The project name cannot contain slashes or be . or ..' }
  }
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return { path: parent.endsWith(sep) ? parent + leaf : parent + sep + leaf }
}

// candidate is inspectBidsCandidate's answer for the target path. DataLad refuses a non-empty folder; a new project may
// still adopt one that looks like BIDS in place, a clone may not.
export function existingFolderProblem(candidate, { remote }) {
  if (!candidate?.exists || candidate.isEmpty || (candidate.bidsLikely && !remote)) return ''
  return 'A folder with this name already exists in the location and is not empty. Choose a different name.'
}
