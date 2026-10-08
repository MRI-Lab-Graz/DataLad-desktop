import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parsePins } from '../scripts/check-install-pins.mjs'

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

test('installer verifies the SHA-256 of every download before running it, git-annex included', () => {
  const downloads = [...nsh.matchAll(/-Uri '([^']+)' -OutFile '([^']+)'/g)]
  assert.ok(downloads.length >= 3, 'expected Git, Python and git-annex downloads')
  for (const [, uri, outFile] of downloads) {
    const verify = new RegExp(`ReadAllBytes\\('${outFile.replace(/[\\$]/g, '\\$&')}'\\)\\)\\) -replace '-'\\) -ne '[0-9A-Fa-f]{64}'`)
    assert.match(nsh, verify, `no hash check for ${uri}`)
  }
})

// Windows PowerShell started from another host (CI's pwsh 7, a user's shell) inherits that host's
// PSModulePath; Get-FileHash then went missing. An elevated script must not trust a user-controlled
// module path anyway, so every call resets it, and the hash check uses .NET, not a module cmdlet.
test('every PowerShell call resets PSModulePath, and hashing does not depend on a module', () => {
  assert.match(nsh, /!define MACHINE_PATH "[^"]*PSModulePath[^"]*'Machine'/)
  const calls = [...nsh.matchAll(/\$\{PS\} -NoProfile[^`]*/g)].map((m) => m[0])
  assert.ok(calls.length >= 8, `expected many PowerShell calls, found ${calls.length}`)
  for (const call of calls) {
    assert.match(call, /\$\{MACHINE_PATH\}|MACHINE_PATH/, `no env reset in: ${call.slice(0, 90)}`)
  }
  assert.doesNotMatch(nsh, /Get-FileHash/)
})

// Elevated installer hygiene: a planted powershell.exe next to the installer, a
// predictable $TEMP file name, or a user-controlled PATH must not matter.
test('installer calls PowerShell by absolute path, downloads into $PLUGINSDIR and looks tools up on the machine PATH only', () => {
  const install = nsh.split('!macro customInstall')[1]?.split('!macroend')[0]
  assert.doesNotMatch(install, /`powershell /, 'bare powershell is searched for in the installer folder first')
  assert.match(nsh, /\$SYSDIR\\WindowsPowerShell\\v1\.0\\powershell\.exe/)
  assert.doesNotMatch(install, /\$TEMP\\/, 'downloads must not use predictable $TEMP names')
  assert.match(install, /\$PLUGINSDIR\\/)
  assert.doesNotMatch(install, /'User'\)/, 'the user PATH is attacker-controlled input to an elevated script')
})

test('DataLad is installed into a private venv from the hash-locked requirements file', () => {
  const install = nsh.split('Installing DataLad into its own environment...')[1]?.split('Checking for git-annex...')[0]
  assert.ok(install, 'expected a DataLad environment step')
  assert.match(install, /uv\.exe/)
  assert.match(install, /venv --clear --no-config --managed-python/)
  assert.match(install, /\$INSTDIR\\datalad-env/)
  assert.match(install, /--require-hashes/)
  assert.match(install, /--only-binary :all:/, 'no sdist builds: their build tools are not hash-checked')
  assert.match(install, /\$INSTDIR\\resources\\datalad-requirements\.txt/)
  assert.doesNotMatch(install, /--upgrade|pip datalad/, 'no unpinned installs')
})

test('only the private env Scripts folder is added to the machine PATH', () => {
  const install = nsh.split('Installing DataLad into its own environment...')[1]?.split('Checking for git-annex...')[0]
  assert.match(install, /SetEnvironmentVariable\('Path'.*'Machine'\)/)
  assert.match(install, /\$INSTDIR\\datalad-env\\Scripts/)
  assert.doesNotMatch(install, /sysconfig/, 'a Python-supplied Scripts folder may be user-writable')
})

test('the hash-locked requirements file is complete and shipped with the app', async () => {
  const reqs = await readFile(new URL('../build/datalad-requirements.txt', import.meta.url), 'utf8')
  const lines = reqs.split(/\n(?=\S)/).filter((l) => /^[A-Za-z]/.test(l))
  assert.ok(lines.some((l) => l.startsWith('datalad==')), 'datalad must be pinned')
  for (const entry of lines) {
    assert.match(entry, /--hash=sha256:[0-9a-f]{64}/, `unhashed requirement: ${entry.split(/\s/)[0]}`)
  }
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.build.extraResources.some((r) => r.to === 'datalad-requirements.txt'))
})

test('Windows packaging includes a portable (no-install) target alongside the NSIS installer', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const targets = pkg.build.win.target.map((t) => t.target)
  assert.ok(targets.includes('portable'), `expected 'portable' in ${JSON.stringify(targets)}`)
  assert.ok(targets.includes('nsis'), 'nsis installer should stay available too')
})

// DataLad lives in a folder the installer owns, so removing it is deleting that
// folder and its PATH entry - never `pip uninstall` in a Python the user also uses.
test('uninstaller removes the private DataLad env and its PATH entry and leaves Python, Git and git-annex alone', () => {
  const un = nsh.split('!macro customUnInstall')[1]?.split('!macroend')[0]
  assert.ok(un, 'expected a customUnInstall macro')
  assert.match(un, /RMDir \/r "\$INSTDIR\\datalad-env"/)
  assert.match(un, /SetEnvironmentVariable\('Path'.*'Machine'\)/)
  assert.doesNotMatch(un, /pip uninstall|MessageBox/)
  assert.doesNotMatch(un, /git-installer|python-installer|git-annex-installer|uninstall -y (git|python)/i)
})

// electron-builder runs the old uninstaller during an update; the env is then rebuilt anyway.
test('uninstaller leaves the DataLad env alone during an update', () => {
  const un = nsh.split('!macro customUnInstall')[1]?.split('!macroend')[0]
  assert.match(un, /\$\{ifNot\} \$\{isUpdated\}/i)
})

// The lock file is compiled for Python 3.12; any other interpreter may lack a pinned wheel.
test('a machine without Python gets the pinned python.org installer, found by lookup alone', () => {
  const python = nsh.split('Checking for Python...')[1]?.split('Installing DataLad into its own environment...')[0]
  assert.ok(python, 'expected a "Checking for Python" step before the DataLad step')
  assert.match(python, /Get-Command python, py -ErrorAction SilentlyContinue\) \{ exit 0 \}/)
  assert.match(python, /python-3\.12\.\d+-amd64\.exe/)
  const install = nsh.split('Installing DataLad into its own environment...')[1]?.split('Checking for git-annex...')[0]
  assert.match(install, /--python 3\.12 /)
})

// A machine-wide PATH entry is only safe if the folder is admin-writable: Program Files, not a data drive.
test('the machine PATH entry is only added when the install folder is under Program Files', () => {
  const install = nsh.split('Making the datalad command available on PATH...')[1]?.split('Checking for git-annex...')[0]
  assert.match(install, /StartsWith\(\$\$env:ProgramW6432/)
})

// A silent install prints nothing, so a failed prerequisite (git-annex hash, download, exit code) was invisible.
test('the installer records what it did and why a step failed in install.log', () => {
  assert.match(nsh, /!macro Log text/)
  assert.match(nsh, /\$INSTDIR\\install\.log/)
  const install = nsh.split('!macro customInstall')[1]?.split('!macroend')[0]
  for (const needle of ['git-annex download', 'git-annex hash', 'git-annex installer exit', 'DataLad install exit']) {
    assert.ok(install.includes(needle), `no log line for: ${needle}`)
  }
})

test('the installer never runs a pre-existing system Python with admin rights', () => {
  assert.doesNotMatch(nsh, /\bpy -3|python -m venv|python -c|-m pip/)
})

test('the DataLad env is built by the bundled uv with its own managed Python inside the install folder', () => {
  assert.match(nsh, /\$INSTDIR\\resources\\uv\\uv\.exe/)
  assert.match(nsh, /UV_PYTHON_INSTALL_DIR = '\$INSTDIR\\python'/)
  assert.match(nsh, /venv --clear --no-config --managed-python --python 3\.12/, "an update reuses the folder; uv refuses an existing venv without --clear")
  assert.match(nsh, /pip install --no-config .*--require-hashes --only-binary :all: --no-deps/)
  assert.match(nsh, /RMDir \/r "\$INSTDIR\\python"/)
})

test('the machine PATH entry needs the install folder inside Program Files, not just a matching prefix', () => {
  assert.match(nsh, /StartsWith\(\$\$env:ProgramW6432 \+ '\\'/)
})

test('installer pins the same versioned git-annex file as install.ps1, never the moving current/ URL', async () => {
  const ps1 = await readFile(new URL('../scripts/windows/install.ps1', import.meta.url), 'utf8')
  const { gitAnnex } = parsePins(ps1)
  assert.doesNotMatch(nsh, /git-annex\/windows\/current/)
  assert.ok(nsh.includes(`-Uri '${gitAnnex.url}'`), 'installer.nsh must download the install.ps1 git-annex URL')
  assert.ok(nsh.toUpperCase().includes(gitAnnex.sha256), 'installer.nsh must pin the install.ps1 git-annex hash')
})
