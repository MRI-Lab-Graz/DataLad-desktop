import { access, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { buildGitStatusMap } from '../datalad/status.js'

const IGNORED_FOLDERS = new Set(['.git', '.datalad', '.github', 'node_modules'])
const DEFAULT_MAX_ENTRIES = 2000

const toPosix = (path) => path.split(sep).join('/')
const lines = (text) => (text ?? '').split(/\r?\n/).filter(Boolean)

// Nearest ancestor (up to rootPath) holding a .git: the repo that owns `dirPath`.
async function findRepoRoot(dirPath, rootPath) {
  for (let current = dirPath; ; current = dirname(current)) {
    try {
      await access(join(current, '.git'))
      return current
    } catch {}
    if (current === rootPath || dirname(current) === current) {
      return rootPath
    }
  }
}

// First path segment below `prefix` for each path under it ("a/b/c" → "a").
function childNames(paths, prefix) {
  const names = new Set()
  for (const path of paths) {
    if (path.startsWith(prefix)) {
      names.add(path.slice(prefix.length).split('/')[0])
    }
  }
  return names
}

/**
 * One level of a project folder with git / git-annex status, so huge or deeply
 * nested datasets load instantly and folders are read only when expanded.
 * ponytail: a folder's Partial/Not-downloaded badge only reflects files in the repo that
 * owns it; nested datasets get theirs once expanded.
 */
export async function listDirectory({ rootPath, dirPath = rootPath, run, maxEntries = DEFAULT_MAX_ENTRIES }) {
  const root = resolve(rootPath)
  const dir = resolve(dirPath)
  if (dir !== root && !dir.startsWith(`${root}${sep}`)) {
    throw new Error('That folder is outside the project folder.')
  }

  const children = (await readdir(dir, { withFileTypes: true }))
    .filter((child) => !(child.isDirectory() && IGNORED_FOLDERS.has(child.name)))
    .sort((left, right) => left.name.localeCompare(right.name))
  const truncated = children.length > maxEntries
  const shown = children.slice(0, maxEntries)

  const repoRoot = await findRepoRoot(dir, root)
  const dirInRepo = toPosix(relative(repoRoot, dir))
  const pathspec = dirInRepo || '.'
  const prefix = dirInRepo ? `${dirInRepo}/` : ''

  // `git annex find` initializes git-annex in any repo it runs in, so only ask a
  // repo that already uses it (annex.uuid is set); browsing must not change it.
  const [status, annexUuid] = await Promise.all([
    run('git', ['-C', repoRoot, '-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all', '--', pathspec]),
    run('git', ['-C', repoRoot, 'config', '--get', 'annex.uuid'])
  ])
  const [present, absent] = annexUuid.failed
    ? [{ failed: true }, { failed: true }]
    : await Promise.all([
        run('git', ['-C', repoRoot, 'annex', 'find', '--in=here', '--', pathspec]),
        run('git', ['-C', repoRoot, 'annex', 'find', '--not', '--in=here', '--', pathspec])
      ])

  const statusByPath = status.failed ? new Map() : buildGitStatusMap(status.stdout)
  const changedChildren = childNames(statusByPath.keys(), prefix)
  const annexKnown = !(present.failed && absent.failed)
  const presentPaths = new Set(annexKnown ? lines(present.stdout) : [])
  const absentPaths = new Set(annexKnown ? lines(absent.stdout) : [])
  const presentChildren = childNames(presentPaths, prefix)
  const absentChildren = childNames(absentPaths, prefix)

  const entries = shown.map((child) => {
    const absolutePath = join(dir, child.name)
    const key = `${prefix}${child.name}`
    const base = {
      name: child.name,
      absolutePath,
      relativePath: toPosix(relative(root, absolutePath)),
      type: child.isDirectory() ? 'directory' : 'file'
    }

    if (!child.isDirectory()) {
      const annexPresent = presentPaths.has(key) ? true : absentPaths.has(key) ? false : null
      return { ...base, gitStatus: statusByPath.get(key) ?? null, annexPresent }
    }

    const hasPresent = presentChildren.has(child.name)
    const hasAbsent = absentChildren.has(child.name)
    const annexPresent = hasPresent && !hasAbsent ? true : hasPresent ? 'partial' : hasAbsent ? false : null
    return { ...base, gitStatus: changedChildren.has(child.name) ? 'changed' : null, annexPresent }
  })

  return { rootPath: root, dirPath: dir, truncated, entries }
}
