import { lstat, readdir, readFile } from 'node:fs/promises'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProcessRunner } from '../datalad/process-runner.js'
import { isSafeRelativeSubdatasetPath } from '../datalad/adapter.js'

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
// Only keys known to be inert are allowed; anything else in the repository's own config
// is reported. (A blocklist of "keys that run programs" misses new ones: gpg.ssh.defaultKeyCommand,
// annex.*-command, diff.*.command, datalad result hooks ...)
const HARMLESS_KEYS = [
  /^core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks|autocrlf|eol|safecrlf|quotepath|untrackedcache|longpaths|protectntfs|protecthfs|hidedotfiles|trustctime|checkstat|preloadindex|fscache)$/,
  /^extensions\.[a-z]+$/,
  /^user\.(name|email)$/,
  /^branch\..+\.(remote|merge|rebase|description)$/,
  /^remote\..+\.(fetch|push|tagopt)$/,
  /^datalad\.dataset\.id$/,
  /^submodule\.(active|.+\.(url|active|branch|datalad-id|datalad-url))$/
]
// Exactly the keys git-annex writes itself (macOS/Linux, and Windows "crippled filesystem" mode),
// plus inert booleans/numbers. Anything else is reported: new option families keep appearing
// (rsync-*-options, web-options, gnupg-*options all name programs or their arguments).
const ANNEX_HARMLESS = new Set(['uuid', 'version', 'crippledfilesystem', 'adjustedbranchrefresh', 'backend', 'freezecontent', 'sshcaching'])
const REMOTE_ANNEX_HARMLESS = new Set(['uuid', 'ignore', 'cost', 'sync', 'readonly', 'bare', 'config-uuid'])

const MAX_SUBDATASETS = 100
const MAX_DEPTH = 3
const GIT_TIMEOUT_MS = 15000

function isHarmless(key, value) {
  const filter = /^filter\.annex\.(smudge|clean|process)$/.exec(key.toLowerCase())
  if (filter) {
    return ANNEX_FILTER[filter[1]] === value
  }
  if (/^remote\..+\.(url|pushurl)$/.test(key)) {
    return !/^(ext|fd)::/i.test(value)
  }
  const annex = /^annex\.(.+)$/.exec(key)
  if (annex) {
    return ANNEX_HARMLESS.has(annex[1])
  }
  const remoteAnnex = /^remote\..+\.annex-(.+)$/.exec(key)
  if (remoteAnnex) {
    return REMOTE_ANNEX_HARMLESS.has(remoteAnnex[1])
  }
  return HARMLESS_KEYS.some((pattern) => pattern.test(key))
}

// git itself locates the repository (subfolders, linked worktrees) and parses its config.
// `rev-parse` and `config --list` run no hooks and no configured programs.
async function scan(runner, projectPath, depth, state, prefix = '') {
  const git = (args) => runner.run('git', ['-C', projectPath, ...args], { timeoutMs: GIT_TIMEOUT_MS })
  const dirs = await git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
  if (dirs.failed) {
    return []
  }
  const [gitDir, commonDir] = dirs.stdout.split(/\r?\n/)
  const found = []

  for (const scope of ['--local', '--worktree']) {
    const listed = await git(['config', scope, '--list', '-z'])
    for (const entry of listed.failed ? [] : listed.stdout.split('\0').filter(Boolean)) {
      const [key, ...rest] = entry.split('\n')
      if (!isHarmless(key, rest.join('\n'))) {
        found.push(`${prefix}config ${key.toLowerCase()}`)
      }
    }
  }

  let hooks = []
  try {
    hooks = await readdir(join(commonDir, 'hooks'), { withFileTypes: true })
  } catch {
    // no hooks directory
  }
  for (const entry of hooks) {
    if (entry.name.endsWith('.sample')) {
      continue
    }
    try {
      const body = (await readFile(join(commonDir, 'hooks', entry.name), 'utf8')).replace(/\r\n/g, '\n').trimEnd()
      if (!entry.isFile() || !ANNEX_HOOKS.has(body)) {
        found.push(`${prefix}hook ${entry.name}`)
      }
    } catch {
      found.push(`${prefix}hook ${entry.name}`) // unreadable is not "safe"
    }
  }

  const top = await git(['rev-parse', '--show-toplevel'])
  if (!top.failed) {
    found.push(...(await scanDataladProcedures(runner, top.stdout.trim(), prefix)))
  }
  if (depth < MAX_DEPTH && !top.failed) {
    const root = top.stdout.trim()
    const paths = await runner.run('git', ['config', '--file', join(root, '.gitmodules'), '--get-regexp', '^submodule\\..*\\.path$'])
    for (const line of paths.failed ? [] : paths.stdout.split(/\r?\n/).filter(Boolean)) {
      const rel = line.slice(line.indexOf(' ') + 1).trim()
      if (state.count >= MAX_SUBDATASETS || !isSafeRelativeSubdatasetPath(rel)) {
        continue
      }
      state.count += 1
      const sub = join(root, rel)
      try {
        const info = await lstat(sub)
        if (info.isSymbolicLink()) {
          found.push(`${prefix}${rel}: path is a symlink`)
        } else if (info.isDirectory()) {
          found.push(...(await scan(runner, sub, depth + 1, state, `${prefix}${rel}: `)))
        }
      } catch {
        // subdataset not installed
      }
    }
  }
  return [...new Set(found)]
}

// datalad prefers a dataset's own .datalad/procedures over its built-in ones, and reads
// procedure settings from the committed .datalad/config.
async function scanDataladProcedures(runner, root, prefix) {
  const found = []
  let procedures = []
  try {
    procedures = await readdir(join(root, '.datalad', 'procedures'))
  } catch {
    // none shipped
  }
  for (const name of procedures) found.push(`${prefix}datalad procedure ${name}`)

  const configFile = join(root, '.datalad', 'config')
  if (!(await lstat(configFile).then(() => true, () => false))) {
    return found
  }
  // git exits 128 for a missing and for a broken file alike, hence the lstat above.
  const listed = await runner.run('git', ['config', '--file', configFile, '--list', '-z'], { timeoutMs: GIT_TIMEOUT_MS })
  if (listed.failed) {
    found.push(`${prefix}datalad config (unreadable)`)
  }
  for (const entry of listed.failed ? [] : listed.stdout.split('\0').filter(Boolean)) {
    const key = entry.split('\n')[0].toLowerCase()
    if (/^datalad\.(procedures|locations|clone|get)\./.test(key)) found.push(`${prefix}datalad config ${key}`)
  }
  return found
}

export function findExecVectors(projectPath, { runner = new ProcessRunner() } = {}) {
  return scan(runner, projectPath, 0, { count: 0 })
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
