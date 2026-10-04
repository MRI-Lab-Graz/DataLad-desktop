import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

export const NOT_FULLY_SCANNED = 'not fully scanned'
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
        found.push(`${prefix}config ${key.toLowerCase()} = ${rest.join('\n')}`)
      }
    }
  }
  found.push(...(await scanDataladProcedures(runner, repo, prefix)))
  const sites = await hookSites(runner, repo)
  if (!sites) {
    found.push(`${NOT_FULLY_SCANNED} (cannot find the git directory of ${prefix || 'the folder'})`)
  }
  for (const gitDir of sites ?? []) {
    found.push(...(await annexHooksIn(gitDir, prefix)))
  }
  found.push(...(await scanLocalRemotes(runner, repo, prefix)))
  return found
}

// A push to a remote that is a local path (a USB stick, a lab share) makes git-annex run THAT
// repository's hooks. The remotes are looked at the same way, with git's own answers for their URLs.
function localPath(url, repo) {
  if (/^file:\/\//i.test(url)) {
    try {
      return fileURLToPath(url)
    } catch {
      return null
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('\\\\') || url.startsWith('//') || isAbsolute(url)) {
    return url
  }
  if (/^[^/\\]*:/.test(url)) {
    return null // ssh://, https://, host:path, datalad-annex::...
  }
  return resolve(repo, url)
}

async function scanLocalRemotes(runner, repo, prefix) {
  const git = (args) => runner.run('git', ['-C', repo, ...args], { timeoutMs: GIT_TIMEOUT_MS })
  const names = await git(['remote'])
  if (names.failed) {
    return [`${NOT_FULLY_SCANNED} (cannot list the remotes of ${prefix || 'the folder'})`]
  }
  const paths = new Map()
  for (const name of names.stdout.split(/\r?\n/).filter(Boolean)) {
    for (const flags of [[], ['--push']]) {
      const urls = await git(['remote', 'get-url', ...flags, '--all', name])
      for (const url of urls.failed ? [] : urls.stdout.split(/\r?\n/).filter(Boolean)) {
        const path = localPath(url, repo)
        if (path && !paths.has(path)) {
          paths.set(path, name)
        }
      }
    }
  }
  const found = []
  for (const [path, name] of paths) {
    if (!(await lstat(path).then(() => true, () => false))) {
      continue // not there (an unplugged drive): nothing can run
    }
    // Git may refuse the folder (it belongs to someone else), so the usual layouts are also read directly.
    const asked = await runner.run('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--absolute-git-dir', '--git-common-dir'], { timeoutMs: GIT_TIMEOUT_MS })
    const dirs = new Set([join(path, '.git'), path, ...(asked.failed ? [] : asked.stdout.split(/\r?\n/).filter(Boolean))])
    for (const dir of dirs) {
      found.push(...(await annexHooksIn(dir, `${prefix}remote ${name} (${path}): `)))
    }
  }
  return found
}

// git's own hooks never run (core.hooksPath, process-runner.js), but git-annex runs hooks of its own
// from <git dir>/hooks and ignores core.hooksPath. The git dirs are whatever git says they are: the
// work tree's own (a linked worktree has its own) and the shared one.
async function hookSites(runner, repo) {
  const dirs = await runner.run('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--absolute-git-dir', '--git-common-dir'], { timeoutMs: GIT_TIMEOUT_MS })
  return dirs.failed ? null : [...new Set(dirs.stdout.split(/\r?\n/).filter(Boolean))]
}

// The hooks git-annex runs (git-annex 10.2026). Looked up by name with lstat, because executing a hook
// needs only the x bit on its folder: a folder that cannot be listed can still run them.
const ANNEX_HOOK_NAMES = ['pre-commit-annex', 'post-update-annex', 'freezecontent-annex', 'thawcontent-annex', 'secure-erase-annex', 'commitmessage-annex', 'http-headers-annex', 'pre-init-annex']
const ABSENT = new Set(['ENOENT', 'ENOTDIR'])

// A fingerprint of the whole hook makes a changed hook a new finding. Anything that cannot be read is
// reported as "not fully scanned" (accepted for this launch only), never silently skipped.
async function annexHooksIn(gitDir, prefix) {
  const hooksDir = join(gitDir, 'hooks')
  const found = []
  const inspect = async (name) => {
    const file = join(hooksDir, name)
    try {
      await lstat(file)
    } catch (error) {
      if (!ABSENT.has(error.code)) {
        found.push(`${NOT_FULLY_SCANNED} (cannot read hook ${name} in ${prefix}${hooksDir})`)
      }
      return
    }
    try {
      found.push(`${prefix}hook ${name} ${createHash('sha256').update(await readFile(file)).digest('hex')}`)
    } catch {
      found.push(`${NOT_FULLY_SCANNED} (cannot read hook ${name} in ${prefix}${hooksDir})`)
    }
  }

  let others = []
  try {
    others = (await readdir(hooksDir)).filter((name) => /annex/i.test(name) && !name.endsWith('.sample') && !ANNEX_HOOK_NAMES.includes(name))
  } catch (error) {
    if (!ABSENT.has(error.code)) {
      found.push(`${NOT_FULLY_SCANNED} (cannot list ${prefix}${hooksDir})`)
    }
  }
  for (const name of [...ANNEX_HOOK_NAMES, ...others]) {
    await inspect(name)
  }
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
    // Ask the filesystem what git asks: on macOS and Windows a folder named .GIT (or .Git) is the repository.
    if (await lstat(join(dir, '.git')).then(() => true, () => false)) {
      repos.push(dir)
    }
    for (const entry of entries) {
      seen += 1
      if (seen > maxEntries) {
        return { repos, truncated: true }
      }
      if (entry.isDirectory() && entry.name.toLowerCase() !== '.git') {
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
    const [name, ...rest] = entry.split('\n')
    const key = name.toLowerCase()
    if (/^datalad\.(procedures|locations|clone|get)\./.test(key)) found.push(`${prefix}datalad config ${key} = ${rest.join('\n')}`)
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
// so a finding that was not there when the user said yes (a new setting, a changed command, a nested
// repo that appeared) asks again. A file in the old format (a plain list of paths) accepts nothing.
// "Not fully scanned" is accepted for this launch only: remembering it would turn everything past
// the scan limit into a permanent pass.
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
  const thisLaunch = new Map()
  const unscanned = (vector) => vector.startsWith(NOT_FULLY_SCANNED)
  return {
    accepts(path, vectors) {
      const key = canonical(path)
      const known = accepted[key]
      return vectors.every((vector) => (Array.isArray(known) && known.includes(vector)) || thisLaunch.get(key)?.has(vector))
    },
    add(path, vectors) {
      const key = canonical(path)
      accepted[key] = vectors.filter((vector) => !unscanned(vector))
      thisLaunch.set(key, new Set(vectors.filter(unscanned)))
      writeFileSync(file, JSON.stringify(accepted))
    }
  }
}

// What the trust dialog shows: "not fully scanned" first (it must never hide behind the cap), each
// finding flattened to one short line, and a count of whatever did not fit.
export function describeVectors(vectors, { max = 5, width = 120 } = {}) {
  const oneLine = (vector) => {
    const flat = vector.replace(/\s+/g, ' ').trim()
    return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat
  }
  const ordered = [...vectors.filter((v) => v.startsWith(NOT_FULLY_SCANNED)), ...vectors.filter((v) => !v.startsWith(NOT_FULLY_SCANNED))]
  const lines = ordered.slice(0, max).map(oneLine)
  if (ordered.length > max) {
    lines.push(`…and ${ordered.length - max} more`)
  }
  return lines.join('\n')
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
    found.push(`${NOT_FULLY_SCANNED} (${limit})`)
  }
  return [...new Set(found)]
}
