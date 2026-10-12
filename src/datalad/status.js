const STATUS_PRIORITY = {
  conflict: 6,
  deleted: 5,
  renamed: 4,
  added: 3,
  modified: 2,
  untracked: 1,
  changed: 0
}

const GIT_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

// git wraps a name in "..." with C-style escapes when it holds a space, tab, quote or backslash
// (and, unless core.quotePath=false, non-ASCII bytes as \303\251). The quotes are not part of the name.
// ponytail: status without -z is the shortcut; `status -z` would avoid quoting but changes the rename format.
function unquoteGitPath(value) {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value
  }
  const bytes = []
  const inner = value.slice(1, -1)
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]
    const octal = char === '\\' ? /^[0-7]{3}/.exec(inner.slice(index + 1))?.[0] : undefined
    if (octal) {
      bytes.push(parseInt(octal, 8))
      index += 3
    } else if (char === '\\' && inner[index + 1] in GIT_ESCAPES) {
      bytes.push(GIT_ESCAPES[inner[index + 1]])
      index += 1
    } else {
      bytes.push(...Buffer.from(char, 'utf8'))
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

export function normalizeGitStatusPath(pathValue, statusCode = '') {
  let nextPath = pathValue
  if ((statusCode.includes('R') || statusCode.includes('C')) && pathValue.includes(' -> ')) {
    nextPath = pathValue.split(' -> ').at(-1)?.trim() ?? pathValue
  }

  const trimmed = nextPath.trim()
  const unquoted = unquoteGitPath(trimmed)
  if (unquoted !== trimmed) {
    return unquoted // git quoted it, so it already uses "/" and any backslash is part of the name
  }

  return trimmed
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .trim()
}

export function mapGitStatusCode(statusCode) {
  if (statusCode === '??') {
    return 'untracked'
  }

  if (statusCode.includes('U')) {
    return 'conflict'
  }

  if (statusCode.includes('D')) {
    return 'deleted'
  }

  if (statusCode.includes('R')) {
    return 'renamed'
  }

  if (statusCode.includes('A')) {
    return 'added'
  }

  if (statusCode.includes('M')) {
    return 'modified'
  }

  return 'changed'
}

export function mergeGitStatusPriority(left, right) {
  if (!left) {
    return right
  }

  return (STATUS_PRIORITY[right] ?? 0) > (STATUS_PRIORITY[left] ?? 0) ? right : left
}

export function parseGitStatusPorcelain(output = '') {
  const filesByPath = new Map()
  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0
  let conflictCount = 0

  for (const line of output.split(/\r?\n/)) {
    if (!line || line.length < 3) {
      continue
    }

    const statusCode = line.slice(0, 2)
    const pathPortion = line.slice(3).trim()
    if (!pathPortion) {
      continue
    }

    const normalizedPath = normalizeGitStatusPath(pathPortion, statusCode)
    if (!normalizedPath) {
      continue
    }

    const staged = statusCode[0] !== ' ' && statusCode[0] !== '?'
    const unstaged = statusCode[1] !== ' ' && statusCode[1] !== '?'
    const conflicted = statusCode.includes('U') || statusCode === 'AA' || statusCode === 'DD'
    const status = mapGitStatusCode(statusCode)

    if (staged) {
      stagedCount += 1
    }

    if (unstaged) {
      unstagedCount += 1
    }

    if (statusCode === '??') {
      untrackedCount += 1
    }

    if (conflicted) {
      conflictCount += 1
    }

    const existing = filesByPath.get(normalizedPath)
    filesByPath.set(normalizedPath, {
      path: normalizedPath,
      status: mergeGitStatusPriority(existing?.status, status),
      statusCode,
      staged: Boolean(existing?.staged || staged),
      unstaged: Boolean(existing?.unstaged || unstaged),
      conflicted: Boolean(existing?.conflicted || conflicted)
    })
  }

  const files = [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path))

  return {
    clean: files.length === 0,
    totalChanged: files.length,
    stagedCount,
    unstagedCount,
    untrackedCount,
    conflictCount,
    files
  }
}

export function buildGitStatusMap(output = '') {
  const parsed = parseGitStatusPorcelain(output)
  return new Map(parsed.files.map((entry) => [entry.path, entry.status]))
}
// `git ls-files -u -z`: one "<mode> <sha> <stage>\t<path>" entry per stage of every unmerged path.
// Stage 1 is the common ancestor, 2 this branch, 3 the branch being merged in; a missing stage means that side has no such file.
export function parseUnmerged(output = '') {
  const byPath = new Map()
  for (const entry of output.split('\0')) {
    const tab = entry.indexOf('\t')
    if (tab === -1) {
      continue
    }
    const [mode, sha, stage] = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    byPath.set(path, { ...byPath.get(path), [stage]: { mode, sha } })
  }
  return byPath
}

// First line of .git/MERGE_MSG: "Merge branch 'x'" (merge) or "Merge remote-tracking branch 'origin/x'" (Update).
export function parseMergeBranch(message = '') {
  const match = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(message.split(/\r?\n/, 1)[0])
  return match ? match[1] : null
}
