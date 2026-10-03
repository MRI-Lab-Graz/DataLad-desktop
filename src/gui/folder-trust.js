import { readFileSync, readdirSync, realpathSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// A repo copied from a zip, USB stick or shared folder brings its own .git/config
// and hooks, and git runs programs named there. Anything that can do that, other
// than what git-annex itself installs, needs the user's explicit OK before we open it.

const ANNEX_HOOKS = new Set(
  [
    'git annex pre-commit .',
    'git annex smudge --update',
    'if git annex post-receive --help >/dev/null 2>&1; then git annex post-receive; fi'
  ].map((cmd) => `#!/bin/sh\n# automatically configured by git-annex\n${cmd}`)
)
const ANNEX_FILTER = {
  smudge: 'git-annex smudge -- %f',
  clean: 'git-annex smudge --clean -- %f',
  process: 'git-annex filter-process'
}
const RUNS_PROGRAMS = new Set([
  'sshcommand', 'hookspath', 'fsmonitor', 'editor', 'pager', 'askpass', 'external', 'textconv',
  'driver', 'clean', 'smudge', 'process', 'gitproxy', 'uploadpack', 'receivepack', 'helper', 'program'
])

function gitDirOf(projectPath) {
  const dotGit = join(projectPath, '.git')
  try {
    if (statSync(dotGit).isDirectory()) {
      return dotGit
    }
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
    return match ? resolve(projectPath, match[1].trim()) : null
  } catch {
    return null
  }
}

function* configEntries(text) {
  let section = ''
  let sub = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[\s*([^\s\]"]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line)
    if (header) {
      section = header[1].toLowerCase()
      sub = header[2] ?? ''
      continue
    }
    const entry = /^([A-Za-z][\w-]*)\s*(?:=\s*(.*))?$/.exec(line)
    if (entry && !line.startsWith('#') && !line.startsWith(';')) {
      yield { section, sub, key: entry[1].toLowerCase(), value: (entry[2] ?? '').trim().replace(/^"(.*)"$/, '$1') }
    }
  }
}

export function findExecVectors(projectPath) {
  const gitDir = gitDirOf(projectPath)
  if (!gitDir) {
    return []
  }
  const found = []
  try {
    for (const { section, sub, key, value } of configEntries(readFileSync(join(gitDir, 'config'), 'utf8'))) {
      const name = [section, sub, key].filter(Boolean).join('.')
      const stockAnnex = section === 'filter' && sub === 'annex' && ANNEX_FILTER[key] === value
      if (stockAnnex) {
        continue
      }
      if (section === 'include' || section === 'includeif' || RUNS_PROGRAMS.has(key) || value.startsWith('!')) {
        found.push(`config ${name}`)
      }
    }
  } catch {
    // no readable config: nothing to run from it
  }
  try {
    for (const name of readdirSync(join(gitDir, 'hooks'))) {
      if (name.endsWith('.sample')) {
        continue
      }
      const body = readFileSync(join(gitDir, 'hooks', name), 'utf8').replace(/\r\n/g, '\n').trimEnd()
      if (!ANNEX_HOOKS.has(body)) {
        found.push(`hook ${name}`)
      }
    }
  } catch {
    // no hooks directory
  }
  return found
}

const canonical = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

export function createTrustStore(file) {
  let trusted = new Set()
  try {
    trusted = new Set(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    // first run, or unreadable: start empty (fail closed: ask again)
  }
  return {
    has: (path) => trusted.has(canonical(path)),
    add(path) {
      trusted.add(canonical(path))
      writeFileSync(file, JSON.stringify([...trusted]))
    }
  }
}
