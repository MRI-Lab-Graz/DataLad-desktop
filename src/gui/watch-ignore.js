const IGNORED_DIR_NAMES = ['.git', '.datalad', '.github', 'node_modules']

const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

const IGNORED_FILE_PATTERNS = [/^~\$/, /\.tmp$/, /\.swp$/]

function normalizeSegments(relativePath) {
  return relativePath.split(/[/\\]/).filter(Boolean)
}

export function getIgnoredDirectoryNames() {
  return [...IGNORED_DIR_NAMES]
}

export function shouldIgnorePath(relativePath) {
  if (!relativePath) {
    return false
  }

  const segments = normalizeSegments(relativePath)
  if (segments.some((segment) => IGNORED_DIR_NAMES.includes(segment))) {
    return true
  }

  const baseName = segments[segments.length - 1] ?? ''
  if (IGNORED_FILE_NAMES.has(baseName)) {
    return true
  }

  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(baseName))
}
