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
