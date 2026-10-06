import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// Text-level rules for the per-user Windows install script (scripts/windows/). Files are read inside each test
// because install.ps1 appears in a later task; the behaviour itself is proven by the CI install job.
const read = (name) => readFile(new URL(`../scripts/windows/${name}`, import.meta.url), 'utf8')
const lines = (text) => text.split(/\r?\n/)

test('install.cmd runs install.ps1 with the execution policy bypassed and passes arguments on', async () => {
  const cmd = await read('install.cmd')
  assert.match(cmd, /powershell -NoProfile -ExecutionPolicy Bypass -File "%~dpn0\.ps1" %\*/)
})

// A browser saves a second download as "install (1).cmd" next to "install (1).ps1": the .cmd has to run the .ps1 with
// its own name, or it silently reinstalls the old version from the first download.
test('install.cmd runs the .ps1 that has the same name as the .cmd itself', async () => {
  const cmd = await read('install.cmd')
  assert.doesNotMatch(cmd, /\\install\.ps1/)
  assert.match(cmd, /%~dpn0\.ps1/)
})

// "cd /d" fails on a UNC path (Downloads redirected to a server share) and leaves the folder at C:\Windows.
test('install.cmd does not change directory, so it also works from a network share', async () => {
  assert.doesNotMatch(await read('install.cmd'), /^\s*(cd|chdir)\b/im)
})

test('install.cmd unblocks the downloaded files before running them', async () => {
  const cmd = await read('install.cmd')
  assert.ok(cmd.indexOf('Unblock-File') !== -1, 'no Unblock-File')
  assert.ok(cmd.indexOf('Unblock-File') < cmd.indexOf('-File "%~dpn0.ps1"'), 'unblock must come first')
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
  // Resolve-LatestRelease only reads release metadata; nothing it fetches is installed unverified.
  const rest = ps.replace(fn, '').replace(body(ps, 'Resolve-LatestRelease'), '')
  assert.doesNotMatch(rest, /Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|DownloadFile/)
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

// A checkout of the repo has no release to render it, so it installs the latest release instead of failing.
test('the unrendered template installs the latest release instead of refusing', async () => {
  const ps = await read('install.ps1')
  assert.doesNotMatch(ps, /unrendered template/)
  assert.match(ps, /if \(\$AppVersion -like '__\*'\) \{\s*Resolve-LatestRelease\s*\}/)
})

test('Resolve-LatestRelease takes the tag from GitHub and the zip hash from that release\'s SHA256SUMS.txt', async () => {
  const fn = body(await read('install.ps1'), 'Resolve-LatestRelease')
  assert.match(fn, /releases\/latest/)
  assert.match(fn, /SHA256SUMS\.txt/)
  assert.match(fn, /\[0-9A-Fa-f\]\{64\}/)
  assert.match(fn, /throw/)
  for (const v of ['AppVersion', 'AppZipSha256', 'AppZipName', 'AppZipUrl']) {
    assert.match(fn, new RegExp(`\\$script:${v} =`), `${v} must be set for the rest of the script`)
  }
})

// A path with spaces or non-ASCII characters (C:\Users\Müller\...) only works if every use is quoted or joined.
test('$InstallDir is never followed by a backslash outside a quoted string', async () => {
  for (const line of lines(await read('install.ps1'))) {
    assert.doesNotMatch(line.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, ''), /\$InstallDir\\/, line)
  }
})

test('an upgrade stops with a message while the app runs, and a leftover .old is never overwritten', async () => {
  const ps = await read('install.ps1')
  const guard = body(ps, 'Assert-AppNotRunning')
  assert.match(guard, /Get-Process/)
  assert.match(guard, /Close it/i)
  const fn = body(ps, 'Install-App')
  assert.match(fn, /Assert-AppNotRunning/)
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

// ---- install.ps1: shortcuts, upgrade rollback, uninstall ----
const mainBlock = (ps) => ps.slice(ps.indexOf('\ntry {'))

test('shortcuts are made in the Start menu and on the desktop, pointing at the installed app', async () => {
  const fn = body(await read('install.ps1'), 'New-Shortcuts')
  assert.match(fn, /WScript\.Shell/)
  assert.match(fn, /GetFolderPath\('Programs'\)/)
  assert.match(fn, /GetFolderPath\('Desktop'\)/)
  assert.match(fn, /Join-Path \$InstallDir 'DataLad Desktop\.exe'/)
})

test('the old install is restored when a step after the swap fails', async () => {
  const ps = await read('install.ps1')
  assert.match(body(ps, 'Restore-PreviousInstall'), /Move-Item -LiteralPath \$old -Destination \$InstallDir/)
  assert.match(mainBlock(ps), /catch \{[\s\S]*\$script:Swapped[\s\S]*Restore-PreviousInstall[\s\S]*exit 1/)
  assert.match(body(ps, 'Install-App'), /\$script:Swapped = \$true/)
})

test('a failed first install leaves no half-installed app and no PATH entry', async () => {
  const fn = body(await read('install.ps1'), 'Restore-PreviousInstall')
  assert.match(fn, /Remove-UserPath/)
})

test('.old is deleted only after datalad --version has succeeded in the new install', async () => {
  const ps = await read('install.ps1')
  const fn = body(ps, 'Complete-Upgrade')
  assert.ok(fn.indexOf('Test-Datalad') !== -1 && fn.indexOf('Test-Datalad') < fn.indexOf('Remove-Item'))
  assert.match(fn, /throw/)
  const main = mainBlock(ps)
  assert.ok(main.indexOf('Install-DataladEnv') < main.indexOf('Complete-Upgrade'))
})

test('a successful run leaves neither .new nor .old behind, so the same version can be installed twice', async () => {
  const ps = await read('install.ps1')
  assert.match(body(ps, 'Complete-Upgrade'), /Remove-Item -LiteralPath "\$InstallDir\.old" -Recurse -Force/)
  assert.match(body(ps, 'Install-App'), /Remove-Item -LiteralPath \$work -Recurse -Force/)
})

test('the user PATH entry is removed from the user PATH only', async () => {
  const fn = body(await read('install.ps1'), 'Remove-UserPath')
  assert.match(fn, /GetEnvironmentVariable\('Path', 'User'\)/)
  assert.match(fn, /SetEnvironmentVariable\('Path', .*'User'\)/)
  assert.doesNotMatch(fn, /Machine/)
})

test('uninstall removes the install folder, the shortcuts and the PATH entry, and nothing shared', async () => {
  const fn = body(await read('install.ps1'), 'Invoke-Uninstall')
  assert.match(fn, /Remove-UserPath \(Join-Path \$InstallDir 'datalad-env\\Scripts'\)/)
  assert.match(fn, /DataLad Desktop\.lnk/)
  assert.match(fn, /Remove-Item -LiteralPath \$InstallDir -Recurse -Force/)
  assert.doesNotMatch(fn, /git-annex|unins\d+|msiexec|winget|choco|Git\\/i, 'Python, Git and git-annex are shared tools and stay')
})

test('uninstall refuses while the app is running, like an upgrade', async () => {
  assert.match(body(await read('install.ps1'), 'Invoke-Uninstall'), /^\s*Assert-AppNotRunning/m)
})

test('uninstall.cmd runs a copy of install.ps1 from TEMP, because its own folder is deleted', async () => {
  const ps = await read('install.ps1')
  assert.match(ps, /copy \/y "%~dp0install\.ps1" "%TEMP%\\dlad-uninstall\.ps1"/)
  assert.match(ps, /-File "%TEMP%\\dlad-uninstall\.ps1" -Uninstall -InstallDir "%~dp0\."/)
  assert.match(body(ps, 'Install-Uninstaller'), /\$PSCommandPath/)
  assert.ok(mainBlock(ps).includes('Install-Uninstaller'))
})

// uninstall.cmd deletes the folder it lives in: cmd reads a batch file line by line, so a pause on its own line would
// fail with "path not found" and close the window before the result is read. Chained on the same line it is already parsed.
test('uninstall.cmd chains its pause onto the same line as the uninstall, not on a line of its own', async () => {
  const ps = await read('install.ps1')
  assert.match(ps, /^\(goto\) 2>nul & powershell [^\n]*-Uninstall -InstallDir "%~dp0\." & pause\r?$/m, '(goto) 2>nul ends the batch context first, so cmd never re-reads the deleted file')
  assert.doesNotMatch(ps, /exit \/b\r?\n'@/, 'exit /b would close the shell the file was run from')
  assert.doesNotMatch(ps, /^pause\s*$/m)
})

test('the install folder is normalised so a trailing backslash or dot (from uninstall.cmd) matches the PATH entry', async () => {
  assert.match(await read('install.ps1'), /\$InstallDir = \[IO\.Path\]::GetFullPath\(\$InstallDir\)/)
})

// ---- review fixes: what a researcher can reasonably do wrong, and what must not break silently ----
// -InstallDir D:\Software is what most installers expect to be a parent folder. Treating it as a previous install
// would rename it to .old and delete it, with the researcher's files inside.
test('an existing folder that is not a DataLad Desktop install is refused, before anything is renamed or deleted', async () => {
  const ps = await read('install.ps1')
  const fn = body(ps, 'Assert-SafeInstallDir')
  assert.match(fn, /DataLad Desktop\.exe/)
  assert.match(fn, /Get-ChildItem -LiteralPath \$InstallDir -Force/)
  assert.match(fn, /throw/)
  const main = mainBlock(ps)
  assert.ok(main.indexOf('Assert-SafeInstallDir') !== -1 && main.indexOf('Assert-SafeInstallDir') < main.indexOf('Invoke-Uninstall'), 'uninstall is checked too')
  assert.ok(main.indexOf('Assert-SafeInstallDir') < main.indexOf('Install-App'))
})

test('a drive root or a share root is refused as the install folder', async () => {
  assert.match(body(await read('install.ps1'), 'Assert-SafeInstallDir'), /GetPathRoot/)
})

// Split-Path throws on "C:" (what a drive root becomes), at the top of the script, before the friendly message can be shown.
test('the log path is worked out without Split-Path, so a drive root reaches the friendly refusal', async () => {
  const line = lines(await read('install.ps1')).find((l) => l.startsWith('$LogPath ='))
  assert.ok(line, 'no $LogPath line')
  assert.doesNotMatch(line, /Split-Path/)
  assert.match(await read('install.ps1'), /GetDirectoryName\(\$InstallDir\)[\s\S]*\$env:LOCALAPPDATA/)
})

test('uninstall does not fail on a folder that is already gone', async () => {
  assert.match(body(await read('install.ps1'), 'Invoke-Uninstall'), /if \(Test-Path -LiteralPath \$InstallDir\)/)
})

// A declined UAC prompt, AppLocker or Defender blocking an unknown exe in TEMP, or antivirus holding the file all throw
// from Start-Process. That must end up as a collected failure with the manual instruction, not roll the whole install back.
test('starting a prerequisite installer is guarded, and its file is cleaned up whatever happens', async () => {
  const ps = await read('install.ps1')
  for (const name of ['Install-Git', 'Install-GitAnnex']) {
    const fn = body(ps, name)
    assert.ok(fn.split('try {').length - 1 >= 2, `${name}: Start-Process needs its own try/catch`)
    assert.match(fn, /try \{\s*\$process = Start-Process[\s\S]*\} catch \{[\s\S]*\$script:Failures \+=[\s\S]*\} finally \{[\s\S]*Remove-Item -LiteralPath \$installer -Force -ErrorAction SilentlyContinue/, name)
  }
})

// Remove-Item can leave a half-deleted folder behind (a file locked by an antivirus scan); Move-Item then puts .old
// INSIDE it and the log claims success.
test('the previous install is only moved back when the failed folder is really gone', async () => {
  const fn = body(await read('install.ps1'), 'Restore-PreviousInstall')
  const remove = fn.indexOf('Remove-Item -LiteralPath $InstallDir')
  const check = fn.indexOf('Test-Path -LiteralPath $InstallDir', remove)
  const move = fn.indexOf('Move-Item -LiteralPath $old')
  assert.ok(remove !== -1 && check > remove && move > check, 'check that the folder is gone between the delete and the move')
  assert.match(fn.slice(check, move), /intact[\s\S]*return/i)
})

test('the log says which version was installed', async () => {
  assert.match(body(await read('install.ps1'), 'Install-App'), /Write-Log "Installed DataLad Desktop \$AppVersion in/)
})

// Windows PowerShell 5.1 reads a BOM-less file as the ANSI code page: one em dash in a comment garbles the script
// and fails for every user on such a machine, with no error that points at the cause.
test('install.ps1 and install.cmd are pure ASCII', async () => {
  for (const name of ['install.ps1', 'install.cmd']) {
    const bytes = await readFile(new URL(`../scripts/windows/${name}`, import.meta.url))
    const at = bytes.findIndex((b) => b > 127)
    assert.equal(at, -1, `${name} has a non-ASCII byte at offset ${at}`)
  }
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
