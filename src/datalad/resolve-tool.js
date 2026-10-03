import { accessSync, statSync, constants } from 'node:fs'
import { isAbsolute, join, delimiter } from 'node:path'

// Windows searches the child's cwd before PATH, so a dataset could ship its own
// git.exe/datalad.exe. Resolve tools ourselves and spawn by absolute path.
// Only absolute PATH entries count: '', '.' and relative ones mean "the cwd".
export function resolveTool(
  name,
  {
    pathEnv = process.env.PATH ?? process.env.Path ?? '',
    platform = process.platform,
    pathExt = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  } = {}
) {
  if (/[\\/]/.test(name)) {
    return null
  }
  const exts = platform === 'win32' ? ['', ...pathExt.split(';').filter(Boolean)] : ['']
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
