import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Text-level rules for the per-user Windows install script (scripts/windows/). Files are read inside each test
// because install.ps1 appears in a later task; the behaviour itself is proven by the CI install job.
const read = (name) => readFile(new URL(`../scripts/windows/${name}`, import.meta.url), 'utf8')
const lines = (text) => text.split(/\r?\n/)

test('install.cmd runs install.ps1 with the execution policy bypassed and passes arguments on', async () => {
  const cmd = await read('install.cmd')
  assert.match(cmd, /powershell -NoProfile -ExecutionPolicy Bypass -File "\.\\install\.ps1" %\*/)
})

test('install.cmd unblocks the downloaded files before running them', async () => {
  const cmd = await read('install.cmd')
  assert.ok(cmd.indexOf('Unblock-File') !== -1, 'no Unblock-File')
  assert.ok(cmd.indexOf('Unblock-File') < cmd.indexOf('-File ".\\install.ps1"'), 'unblock must come first')
})

test('install.cmd has no parenthesised blocks and no goto, so it survives Unix line endings', async () => {
  const cmd = await read('install.cmd')
  for (const line of lines(cmd)) {
    assert.doesNotMatch(line, /\(\s*$/, `opens a block: ${line}`)
    assert.doesNotMatch(line, /^\s*\)/, `closes a block: ${line}`)
    assert.doesNotMatch(line, /^\s*goto\b/i, `goto: ${line}`)
  }
})

test('install.cmd keeps a double-click window open and fails with a non-zero exit when setup fails', async () => {
  const cmd = await read('install.cmd')
  assert.match(cmd, /if errorlevel 1 pause/)
  assert.match(cmd, /if errorlevel 1 exit \/b 1/)
})

// ---- install.ps1: skeleton, app download, safe swap ----
const body = (ps, name) => {
  const m = ps.match(new RegExp(`function ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`))
  assert.ok(m, `no function ${name}`)
  return m[1]
}

test('the script never elevates and never writes the machine PATH', async () => {
  const ps = await read('install.ps1')
  assert.doesNotMatch(ps, /RunAs/i)
  assert.doesNotMatch(ps, /SetEnvironmentVariable\([^)]*'Machine'/i)
  assert.doesNotMatch(ps, /EnvironmentVariableTarget\]::Machine/i)
})

test('every download goes through Get-VerifiedFile', async () => {
  const ps = await read('install.ps1')
  const fn = body(ps, 'Get-VerifiedFile')
  assert.match(fn, /Invoke-WebRequest/)
  assert.doesNotMatch(ps.replace(fn, ''), /Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|DownloadFile/)
})

test('a download cannot hang forever: Invoke-WebRequest has a timeout', async () => {
  assert.match(body(await read('install.ps1'), 'Get-VerifiedFile'), /Invoke-WebRequest [^\n]*-TimeoutSec \d+/)
})

test('Get-VerifiedFile checks the SHA-256 and throws on a mismatch, also for a file taken from -FromDir', async () => {
  const fn = body(await read('install.ps1'), 'Get-VerifiedFile')
  assert.ok(fn.indexOf('FromDir') !== -1 && fn.indexOf('FromDir') < fn.indexOf('SHA256'), 'hash must be checked after the file is obtained, either way')
  assert.match(fn, /throw/)
})

test('the app zip is verified before it is extracted', async () => {
  const fn = body(await read('install.ps1'), 'Install-App')
  assert.ok(fn.indexOf('Get-VerifiedFile') !== -1 && fn.indexOf('Get-VerifiedFile') < fn.indexOf('Expand-Archive'))
})

test('the install folder defaults to LOCALAPPDATA', async () => {
  assert.match(await read('install.ps1'), /\$InstallDir = \(Join-Path \$env:LOCALAPPDATA 'DataLad Desktop'\)/)
})

test('the version and hash pins sit above the first function', async () => {
  const ps = await read('install.ps1')
  const firstFunction = ps.indexOf('\nfunction ')
  for (const pin of ['$AppVersion =', '$AppZipSha256 =']) {
    assert.ok(ps.indexOf(pin) !== -1 && ps.indexOf(pin) < firstFunction, `${pin} must be a pin above the functions`)
  }
})

test('the unrendered template refuses to install anything', async () => {
  assert.match(await read('install.ps1'), /\$AppVersion -like '__\*'/)
})

// A path with spaces or non-ASCII characters (C:\Users\Müller\...) only works if every use is quoted or joined.
test('$InstallDir is never followed by a backslash outside a quoted string', async () => {
  for (const line of lines(await read('install.ps1'))) {
    assert.doesNotMatch(line.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, ''), /\$InstallDir\\/, line)
  }
})

test('an upgrade stops with a message while the app runs, and a leftover .old is never overwritten', async () => {
  const fn = body(await read('install.ps1'), 'Install-App')
  assert.match(fn, /Get-Process/)
  assert.match(fn, /Close it/i)
  assert.match(fn, /Test-Path -LiteralPath \$old[\s\S]*throw/)
})

test('the old install is renamed to .old and the new one moved into place', async () => {
  const fn = body(await read('install.ps1'), 'Install-App')
  assert.match(fn, /Move-Item -LiteralPath \$InstallDir -Destination \$old/)
  assert.match(fn, /Move-Item -LiteralPath \$work -Destination \$InstallDir/)
})

test('a step that cannot finish is collected and makes the script exit non-zero at the end', async () => {
  const ps = await read('install.ps1')
  assert.match(ps, /\$script:Failures = @\(\)/)
  assert.match(ps, /\$script:Failures\.Count -gt 0[\s\S]*exit 1/)
})

// ---- install.ps1: DataLad environment, user PATH, report ----
test('DataLad installs from the zip\'s own uv and its hash-locked, wheels-only requirements', async () => {
  const fn = body(await read('install.ps1'), 'Install-DataladEnv')
  assert.match(fn, /resources\\uv\\uv\.exe/)
  assert.match(fn, /resources\\datalad-requirements\.txt/)
  for (const flag of ['--require-hashes', '--only-binary :all:', '--no-deps', '--index-url https://pypi.org/simple']) {
    assert.ok(fn.includes(flag), `missing ${flag}`)
  }
})

test('uv runs on its own managed Python 3.12 and ignores any uv config', async () => {
  const fn = body(await read('install.ps1'), 'Install-DataladEnv')
  assert.match(fn, /venv --clear --no-config --managed-python --python 3\.12/)
  assert.match(fn, /pip install --no-config/)
  assert.equal(fn.match(/\$LASTEXITCODE -ne 0/g)?.length, 2, 'both uv calls must be checked')
})

test('no system Python is ever run', async () => {
  const ps = await read('install.ps1')
  assert.doesNotMatch(ps, /^\s*&?\s*(python|py)(\.exe)?\s/m)
  assert.doesNotMatch(ps, /Get-Command\s+(python|py)\b/)
})

test('only the user PATH is read and written to add the environment, and it is not added twice', async () => {
  const fn = body(await read('install.ps1'), 'Add-UserPath')
  assert.match(fn, /GetEnvironmentVariable\('Path', 'User'\)/)
  assert.match(fn, /SetEnvironmentVariable\('Path', .*'User'\)/)
  assert.doesNotMatch(fn, /Machine/)
  assert.match(fn, /-contains \$Dir/)
})

test('DataLad is installed after the app and its Scripts folder goes on the user PATH', async () => {
  const ps = await read('install.ps1')
  const main = ps.slice(ps.indexOf('\ntry {'))
  assert.ok(main.indexOf('Install-App') < main.indexOf('Install-DataladEnv'))
  assert.match(body(ps, 'Install-DataladEnv'), /Add-UserPath \(Join-Path \$venv 'Scripts'\)/)
})

test('the report names where datalad resolves and warns when it is not the private environment\'s copy', async () => {
  const fn = body(await read('install.ps1'), 'Write-Report')
  assert.match(fn, /Get-Command datalad/)
  assert.match(fn, /datalad-env\\Scripts\\datalad\.exe/)
  assert.match(fn, /WARNING/)
})

test('a failing uv call is written to the log with its output', async () => {
  assert.match(body(await read('install.ps1'), 'Install-DataladEnv'), /Write-Log \$output/)
})

// ---- install.ps1: Git and git-annex ----
test('git-annex comes from the versioned DataLad mirror file, never from a moving current/ URL', async () => {
  const ps = await read('install.ps1')
  assert.match(ps, /\$GitAnnexVersion = '10\.20260901'/)
  assert.ok(ps.includes('https://datasets.datalad.org/datalad/packages/windows/git-annex-installer_${GitAnnexVersion}_x64.exe'))
  assert.doesNotMatch(ps, /downloads\.kitenet\.net|\/current\//)
})

test('the Git and git-annex pins are the reviewed values and sit above the first function', async () => {
  const ps = await read('install.ps1')
  const pins = [
    "$GitAnnexSha256 = '582F0EF30AC9BE560285D9510F27EBDD95EBDF01719DEC42543B591F6BEF0095'",
    "$GitSha256 = 'D065A4E23C3D9A6B5073D609B5BE0830227EC3CA053C083BA385061DDFAF94C6'",
    "$GitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/Git-2.55.0.5-64-bit.exe'"
  ]
  for (const pin of pins) {
    assert.ok(ps.includes(pin), `missing pin ${pin}`)
    assert.ok(ps.indexOf(pin) < ps.indexOf('\nfunction '), `${pin} must sit above the functions`)
  }
})

test('Git is installed for the current user and only when it is missing', async () => {
  const fn = body(await read('install.ps1'), 'Install-Git')
  assert.match(fn, /Get-Command git -ErrorAction/)
  assert.ok(fn.includes('/CURRENTUSER') && fn.includes('/VERYSILENT'))
  assert.match(fn, /Get-VerifiedFile -Url \$GitUrl -Sha256 \$GitSha256/)
})

test('git-annex is installed only when it is missing, and only after Git', async () => {
  const ps = await read('install.ps1')
  const fn = body(ps, 'Install-GitAnnex')
  assert.match(fn, /Get-Command git-annex -ErrorAction/)
  assert.match(fn, /Get-VerifiedFile -Url \$GitAnnexUrl -Sha256 \$GitAnnexSha256/)
  const main = ps.slice(ps.indexOf('\ntry {'))
  assert.ok(main.indexOf('Install-Git\n') < main.indexOf('Install-GitAnnex'))
})

// Git installed for all users lives in Program Files: git-annex then needs an administrator once, and that has to be
// said, not swallowed.
test('a prerequisite that cannot be installed is collected with manual instructions, not thrown or swallowed', async () => {
  const ps = await read('install.ps1')
  for (const [name, hint] of [['Install-Git', /git-scm\.com/], ['Install-GitAnnex', /administrator/i]]) {
    const fn = body(ps, name)
    assert.match(fn, /\$script:Failures \+=/)
    assert.match(fn, hint)
    assert.match(fn, /catch \{[\s\S]*\$script:Failures \+=[\s\S]*return/, `${name}: a failed download must not abort the whole install`)
  }
})
