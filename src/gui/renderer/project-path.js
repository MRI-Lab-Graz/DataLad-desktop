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
