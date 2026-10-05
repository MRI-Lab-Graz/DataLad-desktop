import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
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

// A backup copy becomes an authorized, trusted folder. Taking over a filesystem root, the home folder, a folder
// above it, or a whole drive (a mount point) would authorize everything on it, including what other people put there
// later: the copy must live in a folder of its own.
export function isUnsafeBackupLocation(path, { home = homedir(), dev = (p) => statSync(p).dev } = {}) {
  const target = realpathLoose(path)
  if (dirname(target) === target || isWithinRoots(home, [target])) {
    return true
  }
  try {
    return dev(target) !== dev(dirname(target))
  } catch {
    return false // a folder that does not exist yet is not a mount point
  }
}

// A packaged app launched from Finder/Explorer has cwd `/` (or a system dir),
// which would authorize the whole disk. Only dev runs trust the cwd.
export function initialAuthorizedRoots({ cwd, isPackaged }) {
  return new Set(isPackaged ? [] : [resolve(cwd)])
}
