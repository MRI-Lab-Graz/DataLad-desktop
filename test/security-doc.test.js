import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8')
const overview = readFileSync(new URL('../REVIEW-OVERVIEW.md', import.meta.url), 'utf8')

// Every control SECURITY.md names must be real, and nothing it names may be removed.
test('SECURITY.md names the admin switches and they exist in code', () => {
  assert.match(doc, /DATALAD_DESKTOP_DISABLE_CONSOLE/)
  assert.match(doc, /policy\.json/)
  const policy = readFileSync(new URL('../src/gui/policy.js', import.meta.url), 'utf8')
  assert.match(policy, /DATALAD_DESKTOP_DISABLE_CONSOLE/)
})

test('every source file SECURITY.md points at exists', () => {
  for (const [, path] of doc.matchAll(/`((?:src|build|e2e|test|tests|scripts)\/[\w./-]+\.\w+)`/g)) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `SECURITY.md references missing ${path}`)
  }
})

test('the security docs no longer describe the removed Rust adapter or an unverified installer', () => {
  for (const text of [doc, overview]) {
    assert.doesNotMatch(text, /Rust adapter|rust-core|DATALAD_DESKTOP_USE_RUST_ADAPTER/)
    assert.doesNotMatch(text, /no hash check|unpinned/i)
  }
})

test('SECURITY.md states the limits honestly', () => {
  for (const topic of [/folder trust/i, /not a security control/i, /Windows/, /signed/i]) {
    assert.match(doc, topic)
  }
})

// The admin policy must live where an update cannot erase it, and the doc must say where.
test('SECURITY.md documents the system locations that policyFiles really uses', async () => {
  const { policyFiles } = await import('../src/gui/policy.js')
  const env = { ProgramData: 'C:\\ProgramData' }
  assert.ok(doc.includes('%ProgramData%\\DataLad Desktop'))
  assert.ok(doc.includes(policyFiles({ platform: 'darwin', env, resourcesDir: '/r' })[0].replace('/policy.json', '/')))
  assert.ok(doc.includes(policyFiles({ platform: 'linux', env, resourcesDir: '/r' })[0].replace('/policy.json', '/')))
})
