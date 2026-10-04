import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { ProcessRunner } from '../datalad/process-runner.js'

// A repo copied from a zip, USB stick or shared folder brings its own .git/config, and git runs
// programs named there (filters, ssh commands, ...). Hooks are not part of this: every command the app
// starts uses only the stock git-annex hooks (process-runner.js), so a repository's own hooks never run.
// Anything else that can run a program, other than what git-annex itself installs, needs the user's
// explicit OK before we open the folder. Every repository under the folder is judged, wherever it hides.

// The hooks git-annex installs itself, exactly: a remote that carries only these needs no prompt.
const STOCK_ANNEX_HOOKS = {
  'pre-commit': 'git annex pre-commit .',
  'post-checkout': 'git annex smudge --update',
  'post-merge': 'git annex smudge --update',
  'post-receive': 'if git annex post-receive --help >/dev/null 2>&1; then git annex post-receive; fi'
}
const isStockAnnexHook = (name, body) =>
  Object.hasOwn(STOCK_ANNEX_HOOKS, name) &&
  body.toString('utf8').replace(/\r\n/g, '\n').trimEnd() === `#!/bin/sh\n# automatically configured by git-annex\n${STOCK_ANNEX_HOOKS[name]}`
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
  /^receive\.(denycurrentbranch|denynonfastforwards|denydeletes|denydeletecurrent)$/,
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

// Every setting of a `config --list -z` output that is not on the allowlist, with its value.
function judgeConfig(listing, prefix) {
  const found = []
  for (const entry of listing.split('\0').filter(Boolean)) {
    const [key, ...rest] = entry.split('\n')
    if (!isHarmless(key, rest.join('\n'))) {
      found.push(`${prefix}config ${key.toLowerCase()} = ${rest.join('\n')}`)
    }
  }
  return found
}

// `config --list` and `ls-files` run no hooks and no configured programs.
async function scanRepo(runner, repo, prefix) {
  const git = (args) => runner.run('git', ['-C', repo, ...args], { timeoutMs: GIT_TIMEOUT_MS })
  const found = []

  for (const scope of ['--local', '--worktree']) {
    // --includes: an include.path names a file the repository ships, and what it says counts too.
    const listed = await git(['config', scope, '--list', '--includes', '-z'])
    if (listed.failed && scope === '--local') {
      found.push(`${NOT_FULLY_SCANNED} (cannot read the config of ${prefix || 'the folder'})`)
    }
    if (!listed.failed) {
      found.push(...judgeConfig(listed.stdout, prefix))
    }
  }
  found.push(...(await scanDataladProcedures(runner, repo, prefix)))
  const sites = await hookSites(runner, repo)
  if (!sites) {
    found.push(`${NOT_FULLY_SCANNED} (cannot find the git directory of ${prefix || 'the folder'})`)
  }
  for (const gitDir of sites ?? []) {
    found.push(...(await hooksIn(gitDir, prefix)))
  }
  found.push(...(await scanLocalRemotes(runner, repo, prefix)))
  return found
}

// A push to a remote that is a local path (a USB stick, a lab share) runs THAT repository's hooks and
// config, which the app's environment overrides do not reach (git clears them for the process it starts
// there). The remotes are judged like any repository, with git's own answers for their URLs.
// file:// is read the way git reads it: the host is dropped, %-escapes are decoded, and '?' and '#' are
// part of the path (so no WHATWG URL parsing).
export function localPath(url, repo) {
  const fileUrl = /^file:\/\/([^/]*)(.*)$/i.exec(url)
  if (fileUrl) {
    const [, host, rest] = fileUrl
    let path
    try {
      path = decodeURIComponent(rest)
    } catch {
      return null
    }
    if (!path) {
      return null
    }
    if (/^\/[a-zA-Z]:[\\/]/.test(path)) {
      return path.slice(1) // file:///C:/x
    }
    return host && host.toLowerCase() !== 'localhost' && process.platform === 'win32' ? `//${host}${path}` : path
  }
  if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('\\\\') || url.startsWith('//') || isAbsolute(url)) {
    return url
  }
  if (/^[^/\\]*:/.test(url)) {
    return null // ssh://, https://, host:path, datalad-annex::...
  }
  return resolve(repo, url)
}

// The remotes of `repo` that are local paths, as git resolves their URLs (insteadOf, pushurl).
async function listLocalRemotes(runner, repo) {
  const git = (args) => runner.run('git', ['-C', repo, ...args], { timeoutMs: GIT_TIMEOUT_MS })
  const names = await git(['remote'])
  if (names.failed) {
    return { failed: true, remotes: [] }
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
  return { failed: false, remotes: [...paths].map(([path, name]) => ({ name, path })) }
}

const exists = (path) => lstat(path).then(() => true, () => false)

// The local-path remotes of a project that exist right now (an unplugged drive has nothing that can run).
export async function localRemotePaths(runner, repo) {
  const { remotes } = await listLocalRemotes(runner, repo)
  const present = []
  for (const remote of remotes) {
    if (await exists(remote.path)) {
      present.push(remote)
    }
  }
  return present
}

// Judges one remote path like a repository: its config goes through the allowlist and every hook counts.
export async function findRemoteVectors(runner, path, label = '') {
  const found = []
  // Git may refuse the folder (it belongs to someone else), so the usual layouts are also read directly.
  const asked = await runner.run('git', ['-C', path, 'rev-parse', '--path-format=absolute', '--absolute-git-dir', '--git-common-dir'], { timeoutMs: GIT_TIMEOUT_MS })
  const askedDirs = new Set(asked.failed ? [] : asked.stdout.split(/\r?\n/).filter(Boolean))
  for (const dir of new Set([join(path, '.git'), path, ...askedDirs])) {
    // A folder with a HEAD (or one git itself named) is a git dir: its config and every hook are judged.
    // Otherwise only git-annex's own hook names are looked up (a plain "hooks" folder is just a folder).
    const isGitDir = askedDirs.has(dir) || (await exists(join(dir, 'HEAD')))
    found.push(...(await hooksIn(dir, label, { all: isGitDir })))
    if (!isGitDir) {
      continue
    }
    const configFile = join(dir, 'config')
    if (!(await lstat(configFile).then((info) => info.isFile(), () => false))) {
      continue
    }
    const listed = await runner.run('git', ['config', '--file', configFile, '--list', '--includes', '-z'], { timeoutMs: GIT_TIMEOUT_MS })
    if (listed.failed) {
      found.push(`${NOT_FULLY_SCANNED} (cannot read the config of ${label}${dir})`)
    } else {
      found.push(...judgeConfig(listed.stdout, label))
    }
  }
  return found
}

async function scanLocalRemotes(runner, repo, prefix) {
  const { failed, remotes } = await listLocalRemotes(runner, repo)
  if (failed) {
    return [`${NOT_FULLY_SCANNED} (cannot list the remotes of ${prefix || 'the folder'})`]
  }
  const found = []
  for (const { name, path } of remotes) {
    if (await exists(path)) { // not there (an unplugged drive): nothing can run
      found.push(...(await findRemoteVectors(runner, path, `${prefix}remote ${name} (${path}): `)))
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
// Pushing into a repository runs its receive-side git hooks too (see localPath above).
const RECEIVE_HOOK_NAMES = ['pre-receive', 'update', 'proc-receive', 'post-receive', 'post-update', 'reference-transaction', 'push-to-checkout', 'pre-auto-gc']
const ABSENT = new Set(['ENOENT', 'ENOTDIR'])

// A fingerprint of the whole hook makes a changed hook a new finding. Anything that cannot be read is
// reported as "not fully scanned" (accepted for this launch only), never silently skipped.
async function hooksIn(gitDir, prefix, { all = false } = {}) {
  const hooksDir = join(gitDir, 'hooks')
  const found = []
  const known = [...ANNEX_HOOK_NAMES, ...(all ? RECEIVE_HOOK_NAMES : [])]
  const inspect = async (name) => {
    const file = join(hooksDir, name)
    try {
      if ((await lstat(file)).isDirectory()) {
        return
      }
    } catch (error) {
      if (!ABSENT.has(error.code)) {
        found.push(`${NOT_FULLY_SCANNED} (cannot read hook ${name} in ${prefix}${hooksDir})`)
      }
      return
    }
    try {
      const body = await readFile(file)
      if (!(all && isStockAnnexHook(name, body))) {
        found.push(`${prefix}hook ${name} ${createHash('sha256').update(body).digest('hex')}`)
      }
    } catch {
      found.push(`${NOT_FULLY_SCANNED} (cannot read hook ${name} in ${prefix}${hooksDir})`)
    }
  }

  let others = []
  try {
    others = (await readdir(hooksDir)).filter((name) => (all || /annex/i.test(name)) && !name.endsWith('.sample') && !known.includes(name))
  } catch (error) {
    if (!ABSENT.has(error.code)) {
      found.push(`${NOT_FULLY_SCANNED} (cannot list ${prefix}${hooksDir})`)
    }
  }
  for (const name of [...known, ...others]) {
    await inspect(name)
  }
  return found
}

// Gitlinks (mode 160000) in the index name nested repositories whether or not .gitmodules lists them.
async function gitlinks(runner, repo) {
  const staged = await runner.run('git', ['-C', repo, 'ls-files', '--stage', '-z'], { timeoutMs: GIT_TIMEOUT_MS })
  if (staged.failed) {
    return { links: [], failed: true }
  }
  return {
    links: staged.stdout
      .split('\0')
      .filter((entry) => entry.startsWith('160000 '))
      .map((entry) => join(repo, entry.slice(entry.indexOf('\t') + 1))),
    failed: false
  }
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

// What the trust dialog shows: "not fully scanned" first (it must never hide behind the cap), each
// finding flattened to one short line, and a count of whatever did not fit.
export function describeVectors(vectors, { max = 5, width = 120 } = {}) {
  // Control and bidi characters in a dataset's text could reorder or hide what the dialog says.
  const oneLine = (vector) => {
    // A 64-character fingerprint would push the hook's name out of view: show its start.
    const flat = vector.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\b([0-9a-f]{8})[0-9a-f]{56}\b/g, '$1').replace(/\s+/g, ' ').trim()
    // A long finding keeps its start and its end: the command is usually at the end.
    return flat.length > width ? `${flat.slice(0, Math.floor(width * 0.4))}…${flat.slice(-(width - Math.floor(width * 0.4) - 1))}` : flat
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
    const { links, failed } = await gitlinks(runner, repo)
    if (failed) {
      found.push(`${NOT_FULLY_SCANNED} (cannot list the nested repositories of ${prefix || 'the folder'})`)
    }
    for (const link of links) {
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
