import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderInstallScript } from '../scripts/render-install-script.mjs'

const template = await readFile(new URL('../scripts/windows/install.ps1', import.meta.url), 'utf8')
const HASH = 'a'.repeat(64)

test('renderInstallScript puts the version and the upper-case hash into their pins', () => {
  const out = renderInstallScript(template, { version: '1.2.3', zipSha256: HASH })
  assert.ok(out.includes("$AppVersion = '1.2.3'"))
  assert.ok(out.includes(`$AppZipSha256 = '${HASH.toUpperCase()}'`))
  assert.doesNotMatch(out, /__VERSION__|__ZIP_SHA256__/)
})

test('a rendered script no longer trips the unrendered-template guard', () => {
  const out = renderInstallScript(template, { version: '1.2.3', zipSha256: HASH })
  assert.ok(out.includes("$AppVersion -like '__*'"), 'the guard stays in the script')
  assert.ok(!out.includes("$AppVersion = '__"), 'but the pin no longer starts with __')
})

test('renderInstallScript throws when a placeholder is missing from the template', () => {
  assert.throws(() => renderInstallScript("$AppZipSha256 = '__ZIP_SHA256__'", { version: '1.2.3', zipSha256: HASH }), /__VERSION__/)
  assert.throws(() => renderInstallScript("$AppVersion = '__VERSION__'", { version: '1.2.3', zipSha256: HASH }), /__ZIP_SHA256__/)
})

test('renderInstallScript throws on a malformed hash', () => {
  for (const zipSha256 of ['', 'xyz', 'a'.repeat(63), 'g'.repeat(64)]) {
    assert.throws(() => renderInstallScript(template, { version: '1.2.3', zipSha256 }), /SHA-256/, zipSha256)
  }
})

test('renderInstallScript throws on a version that could break out of the PowerShell string', () => {
  for (const version of ['', "1.2.3'; calc; '", '1.2.3 ', '$(calc)']) {
    assert.throws(() => renderInstallScript(template, { version, zipSha256: HASH }), /version/i, version)
  }
})

test('the committed template has each placeholder exactly once', () => {
  assert.equal(template.split('__VERSION__').length - 1, 1)
  assert.equal(template.split('__ZIP_SHA256__').length - 1, 1)
})

test('the CLI hashes the zip and writes the rendered script', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-render-'))
  const zip = join(dir, 'app.zip')
  const out = join(dir, 'install.ps1')
  await writeFile(zip, 'not really a zip')
  execFileSync(process.execPath, ['scripts/render-install-script.mjs', '4.5.6', zip, out], { cwd: new URL('..', import.meta.url) })
  const expected = createHash('sha256').update('not really a zip').digest('hex').toUpperCase()
  const rendered = await readFile(out, 'utf8')
  assert.ok(rendered.includes(`$AppZipSha256 = '${expected}'`))
  assert.ok(rendered.includes("$AppVersion = '4.5.6'"))
})
