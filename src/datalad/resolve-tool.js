import { accessSync, statSync, constants } from 'node:fs'
import { isAbsolute, join, delimiter } from 'node:path'

// Windows searches the child's cwd before PATH, so a dataset could ship its own
// git.exe/datalad.exe. Resolve tools ourselves and spawn by absolute path.
// Only absolute PATH entries count: '', '.' and relative ones mean "the cwd".
export function resolveTool(
  name,
  {
    pathEnv = process.env.PATH ?? process.env.Path ?? '',
    platform = process.platform
  } = {}
) {
  if (/[\\/]/.test(name)) {
    return null
  }
  // Windows runs only .exe/.com directly; .cmd/.bat shims need a shell, which we never use here.
  const exts = platform === 'win32' ? ['.exe', '.com'] : ['']
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir || !isAbsolute(dir)) {
      continue
    }
    for (const ext of exts) {
      const candidate = join(dir, name + ext)
      try {
        if (!statSync(candidate).isFile()) {
          continue
        }
        if (platform !== 'win32') {
          accessSync(candidate, constants.X_OK)
        }
        return candidate
      } catch {
        // not here, keep looking
      }
    }
  }
  return null
}
