import { lstat, readdir } from 'node:fs/promises'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { ProcessRunner } from '../datalad/process-runner.js'

// A repo copied from a zip, USB stick or shared folder brings its own .git/config, and git runs
// programs named there (filters, ssh commands, ...). Hooks are not part of this: every command the app
// starts uses only the stock git-annex hooks (process-runner.js), so a repository's own hooks never run.
// Anything else that can run a program, other than what git-annex itself installs, needs the user's
// explicit OK before we open the folder. Every repository under the folder is judged, wherever it hides.

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

const MAX_REPOS = 200
const MAX_ENTRIES = 200000
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

// `config --list` and `ls-files` run no hooks and no configured programs.
async function scanRepo(runner, repo, prefix) {
  const git = (args) => runner.run('git', ['-C', repo, ...args], { timeoutMs: GIT_TIMEOUT_MS })
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
  found.push(...(await scanDataladProcedures(runner, repo, prefix)))
  return found
}

// Gitlinks (mode 160000) in the index name nested repositories whether or not .gitmodules lists them.
async function gitlinks(runner, repo) {
  const staged = await runner.run('git', ['-C', repo, 'ls-files', '--stage', '-z'], { timeoutMs: GIT_TIMEOUT_MS })
  return (staged.failed ? [] : staged.stdout.split('\0'))
    .filter((entry) => entry.startsWith('160000 '))
    .map((entry) => join(repo, entry.slice(entry.indexOf('\t') + 1)))
}

// Every directory under `root` that holds a .git entry (folder or gitfile). Symlinks are not followed
// and .git folders are not entered. Stops after `maxEntries` directory entries.
async function findRepoDirs(root, maxEntries) {
  const repos = []
  const queue = [root]
  let seen = 0
  while (queue.length > 0) {
    const dir = queue.pop()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable: git cannot read it either
    }
    for (const entry of entries) {
      seen += 1
      if (seen > maxEntries) {
        return { repos, truncated: true }
      }
      if (entry.name === '.git') {
        repos.push(dir)
      } else if (entry.isDirectory()) {
        queue.push(join(dir, entry.name))
      }
    }
  }
  return { repos, truncated: false }
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

const canonical = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

// Remembers, per folder, the findings the user accepted. The folder is re-scanned on every open,
// so a finding that was not there when the user said yes (a new hook-like setting, a nested repo that
// appeared) asks again. A file in the old format (a plain list of paths) accepts nothing.
export function createTrustStore(file) {
  let accepted = {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      accepted = parsed
    }
  } catch {
    // first run, or unreadable: start empty (fail closed: ask again)
  }
  return {
    accepts(path, vectors) {
      const known = accepted[canonical(path)]
      return vectors.every((vector) => Array.isArray(known) && known.includes(vector))
    },
    add(path, vectors) {
      accepted[canonical(path)] = [...vectors]
      writeFileSync(file, JSON.stringify(accepted))
    }
  }
}

export async function findExecVectors(projectPath, { runner = new ProcessRunner(), maxRepos = MAX_REPOS, maxEntries = MAX_ENTRIES } = {}) {
  const root = resolve(projectPath)
  const found = []
  const queued = new Set()
  const queue = []
  let limit = null
  const enqueue = (dir) => {
    const key = canonical(dir)
    if (queued.has(key)) {
      return
    }
    if (queued.size >= maxRepos) {
      limit = `more than ${maxRepos} repositories`
      return
    }
    queued.add(key)
    queue.push(dir)
  }

  const top = await runner.run('git', ['-C', root, 'rev-parse', '--show-toplevel'], { timeoutMs: GIT_TIMEOUT_MS })
  if (!top.failed) {
    enqueue(top.stdout.trim())
  }
  const walked = await findRepoDirs(root, maxEntries)
  walked.repos.forEach(enqueue)
  if (walked.truncated) {
    limit = `more than ${maxEntries} files and folders`
  }

  while (queue.length > 0) {
    const repo = queue.shift()
    const rel = relative(root, repo)
    const prefix = rel && !rel.startsWith('..') ? `${rel}: ` : ''
    found.push(...(await scanRepo(runner, repo, prefix)))
    for (const link of await gitlinks(runner, repo)) {
      const info = await lstat(link).catch(() => null)
      if (info?.isSymbolicLink()) {
        found.push(`${prefix}${relative(repo, link)}: path is a symlink`)
      } else if (info?.isDirectory() && (await lstat(join(link, '.git')).catch(() => null))) {
        enqueue(link)
      }
    }
  }

  if (limit) {
    found.push(`not fully scanned (${limit})`)
  }
  return [...new Set(found)]
}
