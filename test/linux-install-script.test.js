import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderInstallScript } from '../scripts/render-install-script.mjs'

// The Linux script installs the AppImage for the current user. Tests that run it need a POSIX bash; the script's own
// system and CPU checks are answered by a fake uname, and tools by fake executables on PATH.
const path = fileURLToPath(new URL('../scripts/linux/linux-install.sh', import.meta.url))
const sh = await readFile(path, 'utf8').catch(() => '')
const posix = { skip: process.platform === 'win32' && 'runs the script with bash' }
const IMAGE = 'fake appimage bytes'
const HASH = createHash('sha256').update(IMAGE).digest('hex')
const VERSION = '9.8.7'

async function bin(files) {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-linux-bin-'))
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), `#!/bin/sh\n${body}\n`)
    await chmod(join(dir, name), 0o755)
  }
  return dir
}
const uname = (system = 'Linux', machine = 'x86_64') => ({ uname: `case "$1" in -s) echo ${system};; -m) echo ${machine};; esac` })

// Runs a rendered script with --from-dir holding the fake AppImage.
async function run({ script = renderInstallScript(sh, { version: VERSION, zipSha256: HASH }), args, tools = {}, system, machine, image = IMAGE } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-linux-'))
  const home = join(dir, 'home')
  const release = join(dir, 'release')
  await mkdir(home)
  await mkdir(release)
  await writeFile(join(release, `DataLad.Desktop-${VERSION}.AppImage`), image)
  const file = join(dir, 'linux-install.sh')
  await writeFile(file, script)
  const fakes = await bin({ ...uname(system, machine), ...tools })
  const r = spawnSync('/bin/bash', [file, ...(args ?? ['--from-dir', release])], {
    env: { HOME: home, PATH: `${fakes}:/usr/bin:/bin` },
    encoding: 'utf8'
  })
  return { ...r, home, out: `${r.stdout}${r.stderr}` }
}
const allTools = { git: 'echo git', 'git-annex': 'echo git-annex', datalad: 'echo datalad 1.0', fusermount: 'true' }

test('linux-install.sh is valid bash', posix, () => {
  execFileSync('bash', ['-n', path])
})

test('the template has each placeholder exactly once', () => {
  assert.equal(sh.split('__VERSION__').length - 1, 1)
  assert.equal(sh.split('__ZIP_SHA256__').length - 1, 1)
})

test('an unrendered template runs the latest release linux-install.sh, passing its arguments on', posix, async () => {
  const curl = 'echo "$@" >&2; cat <<\'EOF\'\necho "release copy got: $*"\nEOF'
  const r = await run({ script: sh, args: ['--from-dir', '/x'], tools: { curl, ...allTools } })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /releases\/latest\/download\/linux-install\.sh/)
  assert.match(r.out, /release copy got: --from-dir \/x/)
})

test('installs the AppImage as an executable file and adds an app-menu entry', posix, async () => {
  const r = await run({ tools: allTools })
  assert.equal(r.status, 0, r.out)
  const image = join(r.home, 'Applications', 'DataLad-Desktop.AppImage')
  assert.equal(await readFile(image, 'utf8'), IMAGE)
  assert.ok(((await stat(image)).mode & 0o111) !== 0, 'AppImage is not executable')
  const entry = await readFile(join(r.home, '.local', 'share', 'applications', 'datalad-desktop.desktop'), 'utf8')
  assert.match(entry, /^\[Desktop Entry\]/)
  assert.ok(entry.includes(`Exec="${image}"`), entry)
})

test('a file that does not match the SHA-256 is refused and nothing is installed', posix, async () => {
  const r = await run({ tools: allTools, image: 'tampered' })
  assert.notEqual(r.status, 0)
  assert.match(r.out, /SHA-256/)
  await assert.rejects(stat(join(r.home, 'Applications', 'DataLad-Desktop.AppImage')))
})

test('refuses systems other than Linux x86_64 with a plain sentence', posix, async () => {
  for (const [system, machine] of [['Darwin', 'arm64'], ['Linux', 'aarch64']]) {
    const r = await run({ tools: allTools, system, machine })
    assert.notEqual(r.status, 0, `${system} ${machine}`)
    assert.match(r.out, /Linux on a 64-bit Intel\/AMD/i)
  }
})

test('missing git-annex and DataLad are named with the commands to install them, and the script itself never runs sudo', posix, async () => {
  const r = await run({ tools: { git: 'echo git', fusermount: 'true' } })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /git-annex/)
  assert.match(r.out, /datalad/i)
  assert.match(r.out, /apt install/)
  assert.doesNotMatch(sh, /^\s*sudo\b/m)
})

test('downloads from a versioned tag URL; latest is only used to fetch linux-install.sh itself', () => {
  assert.match(sh, /releases\/download\/v\$\{APP_VERSION\}\//)
  assert.deepEqual(sh.replace(/^\s*#.*$/gm, '').match(/releases\/latest\/[^"\s]*/g), ['releases/latest/download/linux-install.sh'])
})

// The file is copied into a private work folder first and the copy is what gets checked, so it cannot change between the check and the install.
test('checks the hash of the private copy, after copying it and before it is made executable or moved into place', () => {
  const copy = sh.indexOf('cp "$image" "$work/new.AppImage"')
  const check = sh.indexOf('check_hash "$work/new.AppImage"')
  assert.ok(copy !== -1 && check > copy, 'hash must be checked on the copy')
  assert.ok(check < sh.indexOf('chmod +x'))
  assert.ok(check < sh.indexOf('mv -f'))
})

// Under `curl | bash` the shell reads the script from stdin, so it has to be parsed completely first.
test('runs inside main on the last line', () => {
  assert.equal(sh.trimEnd().split('\n').pop(), 'main "$@"')
})
