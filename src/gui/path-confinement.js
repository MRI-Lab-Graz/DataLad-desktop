import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

// realpath of the nearest existing ancestor + the not-yet-existing remainder,
// so symlinks are resolved even for paths that are about to be created.
function realpathLoose(path) {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(realpathLoose(parent), basename(absolute))
  }
}

export function isWithinRoots(targetPath, roots) {
  const target = realpathLoose(targetPath)
  for (const root of roots) {
    const real = realpathLoose(root)
    if (target === real || target.startsWith(real.endsWith(sep) ? real : `${real}${sep}`)) {
      return true
    }
  }
  return false
}

// A packaged app launched from Finder/Explorer has cwd `/` (or a system dir),
// which would authorize the whole disk. Only dev runs trust the cwd.
export function initialAuthorizedRoots({ cwd, isPackaged }) {
  return new Set(isPackaged ? [] : [resolve(cwd)])
}
