import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const nsh = await readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8')

// git-annex's Windows installer plugs into an existing Git for Windows install,
// and DataLad shells out to git — so Git must be installed first.
test('installer installs Git for Windows before git-annex', () => {
  const gitStep = nsh.indexOf('Checking for Git...')
  const annexStep = nsh.indexOf('Checking for git-annex...')
  assert.ok(gitStep !== -1, 'no Git for Windows step')
  assert.ok(annexStep !== -1, 'no git-annex step')
  assert.ok(gitStep < annexStep, 'Git must be installed before git-annex')
})

test('installer verifies the SHA-256 of every pinned download before running it', () => {
  const pinned = [...nsh.matchAll(/-Uri '([^']+)' -OutFile '([^']+)'/g)]
    .filter(([, uri]) => !uri.includes('/current/'))
  assert.ok(pinned.length >= 2, 'expected pinned Python and Git downloads')
  for (const [, uri, outFile] of pinned) {
    const verify = new RegExp(`Get-FileHash '${outFile.replace(/[\\$]/g, '\\$&')}' -Algorithm SHA256\\)\\.Hash -ne '[0-9A-Fa-f]{64}'`)
    assert.match(nsh, verify, `no hash check for ${uri}`)
  }
})

test('DataLad installation works when Python is available without the py launcher', () => {
  const install = nsh.split('Installing/updating DataLad via pip...')[1]?.split('Checking for git-annex...')[0]
  assert.ok(install, 'expected a DataLad pip install step')
  assert.match(install, /Get-Command py/)
  assert.match(install, /Get-Command python/)
  assert.match(install, /python -m pip install --upgrade pip datalad/)
})

test('Windows packaging includes a portable (no-install) target alongside the NSIS installer', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const targets = pkg.build.win.target.map((t) => t.target)
  assert.ok(targets.includes('portable'), `expected 'portable' in ${JSON.stringify(targets)}`)
  assert.ok(targets.includes('nsis'), 'nsis installer should stay available too')
})

// Regression: on a machine whose `py -3` is a different Python than the one on
// PATH, pip installed datalad.exe into a Scripts folder that PATH didn't list,
// so DataLad was installed but the `datalad` command (and the app) couldn't find it.
test('installer puts the Scripts folder of the Python that installed DataLad on the machine PATH', () => {
  const install = nsh.split('Installing/updating DataLad via pip...')[1]?.split('Checking for git-annex...')[0]
  assert.ok(install, 'expected a DataLad pip install step')
  assert.match(install, /sysconfig/)
  assert.match(install, /datalad\.exe/)
  assert.match(install, /SetEnvironmentVariable\('Path'.*'Machine'\)/)
})

// The NSIS uninstaller only removes the app; DataLad (pip) and the PATH entry
// the installer added would otherwise be left behind. Python/Git/git-annex are
// shared tools and must never be removed.
test('uninstaller offers to remove DataLad and its PATH entry, and leaves Python, Git and git-annex alone', () => {
  const un = nsh.split('!macro customUnInstall')[1]?.split('!macroend')[0]
  assert.ok(un, 'expected a customUnInstall macro')
  assert.match(un, /MessageBox MB_YESNO.*\/SD IDNO/, 'prompt must default to keeping DataLad when silent')
  assert.match(un, /pip uninstall -y datalad/)
  assert.match(un, /SetEnvironmentVariable\('Path'.*'Machine'\)/)
  assert.doesNotMatch(un, /git-installer|python-installer|git-annex-installer|uninstall -y (git|python)/i)
})

// powershell -Command exits with the last statement's status, so a failed pip
// uninstall would be reported as success unless pip's exit code is passed on.
test('uninstaller reports a failed pip uninstall through the PowerShell exit code', () => {
  const un = nsh.split('!macro customUnInstall')[1]?.split('!macroend')[0]
  assert.match(un, /\$\$pipExit = \$\$LASTEXITCODE/)
  assert.match(un, /exit \$\$pipExit/)
})

// electron-builder runs the old uninstaller during an update; that must never
// offer to remove DataLad.
test('uninstaller does not prompt during an update', () => {
  const un = nsh.split('!macro customUnInstall')[1]?.split('!macroend')[0]
  assert.match(un, /\$\{ifNot\} \$\{isUpdated\}/i)
})

// After a successful pip uninstall datalad.exe is always gone, so that check alone
// would drop a Scripts folder still holding pip.exe and other tools from PATH.
test('uninstaller only drops the Scripts folder from PATH when it is empty', () => {
  const un = nsh.split('!macro customUnInstall')[1]?.split('!macroend')[0]
  assert.match(un, /Get-ChildItem \$\$scripts/)
  assert.doesNotMatch(un, /-not \(Test-Path \(Join-Path \$\$scripts 'datalad\.exe'\)\)/)
})
