import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, chmod, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderInstallScript } from '../scripts/render-install-script.mjs'

const path = fileURLToPath(new URL('../scripts/macos/install.sh', import.meta.url))
const sh = await readFile(path, 'utf8').catch(() => '')
const HASH = '0'.repeat(64)
// The script targets macOS; the tests that execute it need a POSIX bash and fake executables on PATH.
const posix = { skip: process.platform === 'win32' && 'runs the script with bash' }

// A PATH folder whose uname answers like an Apple-silicon Mac (or whatever the test says).
async function fakeUname(system, machine) {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-uname-'))
  const f = join(dir, 'uname')
  await writeFile(f, `#!/bin/sh\ncase "$1" in -s) echo ${system};; -m) echo ${machine};; esac\n`)
  await chmod(f, 0o755)
  return dir
}

async function run(script, args, { system = 'Darwin', machine = 'arm64' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-run-'))
  const file = join(dir, 'install.sh')
  await writeFile(file, script)
  const home = join(dir, 'home')
  await mkdir(home)
  const r = spawnSync('/bin/bash', [file, ...args], {
    env: { HOME: home, PATH: `${await fakeUname(system, machine)}:${process.env.PATH}` },
    encoding: 'utf8'
  })
  return { ...r, home, out: `${r.stdout}${r.stderr}` }
}

test('install.sh is valid bash', posix, () => {
  execFileSync('bash', ['-n', path])
})

test('the template has each placeholder exactly once', () => {
  assert.equal(sh.split('__VERSION__').length - 1, 1)
  assert.equal(sh.split('__ZIP_SHA256__').length - 1, 1)
})

// A repo checkout is a template: it must not try to download v__VERSION__.
test('an unrendered template refuses to run', posix, async () => {
  const r = await run(sh, [])
  assert.notEqual(r.status, 0)
  assert.match(r.out, /template/i)
})

test('exits before doing anything on an Intel Mac or on Linux', posix, async () => {
  const script = renderInstallScript(sh, { version: '9.9.9', zipSha256: HASH })
  for (const [system, machine] of [['Darwin', 'x86_64'], ['Linux', 'arm64']]) {
    const r = await run(script, [], { system, machine })
    assert.notEqual(r.status, 0, `${system} ${machine}`)
    assert.match(r.out, /Apple silicon/i)
    assert.deepEqual(await readdir(r.home), [], 'preflight must not create anything')
  }
})

test('a zip whose SHA-256 does not match is refused and nothing is installed', posix, async () => {
  const from = await mkdtemp(join(tmpdir(), 'dlad-from-'))
  await writeFile(join(from, 'DataLad-Desktop-9.9.9-mac-arm64.zip'), 'not the real app')
  const r = await run(renderInstallScript(sh, { version: '9.9.9', zipSha256: HASH }), ['--from-dir', from])
  assert.notEqual(r.status, 0)
  assert.match(r.out, /SHA-256/)
  assert.deepEqual(await readdir(join(r.home, 'Applications')).catch(() => []), [], 'no app, no temp folder left behind')
})

test('an unknown option is an error', posix, async () => {
  const r = await run(renderInstallScript(sh, { version: '9.9.9', zipSha256: HASH }), ['--bogus'])
  assert.notEqual(r.status, 0)
  assert.match(r.out, /--bogus/)
})

// Text-level rules from the spec.
test('never uses sudo and installs only under $HOME', () => {
  assert.doesNotMatch(sh, /\bsudo\b/)
  assert.match(sh, /APP_DIR="\$HOME\/Applications"/)
  assert.doesNotMatch(sh, /["\s]\/Applications\b/)
})

test('downloads a versioned tag URL, never latest', () => {
  assert.match(sh, /releases\/download\/v\$\{APP_VERSION\}\//)
  assert.doesNotMatch(sh, /releases\/latest/)
})

test('checks the zip hash before extracting it', () => {
  const check = sh.indexOf('check_hash "$zip"')
  const extract = sh.indexOf('ditto -x -k')
  assert.ok(check !== -1 && extract > check)
})

test('only installs tools that are missing', () => {
  assert.match(sh, /command -v git-annex/)
  assert.match(sh, /command -v datalad/)
})

test('offers Homebrew through /dev/tty and prints the official command when there is no terminal', () => {
  assert.match(sh, /<\/dev\/tty/)
  assert.ok(sh.includes('https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh'))
  assert.match(sh, /no terminal/i)
})

// Under `curl | bash` the shell reads the script from stdin: a child that reads stdin would swallow the rest.
test('runs inside main on the last line and gives brew no stdin', () => {
  const last = sh.trimEnd().split('\n').pop()
  assert.equal(last, 'main "$@"')
  assert.match(sh, /brew install [^\n]*<\/dev\/null/)
})

test('keeps the previous app until the new one passes codesign, and restores it on failure', () => {
  assert.match(sh, /\.old/)
  assert.match(sh, /codesign --verify/)
})

test('asks the user to quit a running app', () => {
  assert.match(sh, /pgrep/)
})

test('removes the quarantine flag from the installed app', () => {
  assert.match(sh, /xattr -dr com\.apple\.quarantine/)
})
