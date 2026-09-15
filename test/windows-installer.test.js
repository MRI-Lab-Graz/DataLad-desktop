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

test('Windows packaging includes a portable (no-install) target alongside the NSIS installer', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const targets = pkg.build.win.target.map((t) => t.target)
  assert.ok(targets.includes('portable'), `expected 'portable' in ${JSON.stringify(targets)}`)
  assert.ok(targets.includes('nsis'), 'nsis installer should stay available too')
})
