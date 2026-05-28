const STATUS_PRIORITY = {
  conflict: 6,
  deleted: 5,
  renamed: 4,
  added: 3,
  modified: 2,
  untracked: 1,
  changed: 0
}

export function normalizeGitStatusPath(pathValue, statusCode = '') {
  let nextPath = pathValue
  if ((statusCode.includes('R') || statusCode.includes('C')) && pathValue.includes(' -> ')) {
    nextPath = pathValue.split(' -> ').at(-1)?.trim() ?? pathValue
  }

  return nextPath
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