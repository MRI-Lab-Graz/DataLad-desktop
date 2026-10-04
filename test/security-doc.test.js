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

test('SECURITY.md says releases are currently unsigned and how to verify them', () => {
  assert.match(doc, /currently unsigned/i)
  assert.match(doc, /SHA256SUMS/)
  assert.match(doc, /gh attestation verify/)
})

test('SECURITY.md documents that dataset-shipped datalad procedures are neutralised', () => {
  assert.match(doc, /DATALAD_LOCATIONS_DATASET__PROCEDURES/)
  assert.match(doc, /\.datalad\/procedures/)
  const runner = readFileSync(new URL('../src/datalad/process-runner.js', import.meta.url), 'utf8')
  assert.match(runner, /DATALAD_LOCATIONS_DATASET__PROCEDURES/)
})

test('SECURITY.md documents the execution layer: app-owned hooks, no reckless clones, exact allowlists, native confirmations', () => {
  assert.match(doc, /core\.hooksPath/)
  assert.match(doc, /DATALAD_CLONE_RECKLESS/)
  assert.match(doc, /not fully scanned/i)
  assert.match(doc, /native (dialog|confirmation)/i)
  const runner = readFileSync(new URL('../src/datalad/process-runner.js', import.meta.url), 'utf8')
  assert.match(runner, /core\.hooksPath/)
  assert.match(runner, /DATALAD_CLONE_RECKLESS/)
  assert.ok(existsSync(new URL('../build/git-hooks/pre-commit', import.meta.url)))
})

test('SECURITY.md documents the git-annex own hooks and the per-launch "not fully scanned" acceptance', () => {
  assert.match(doc, /pre-commit-annex/)
  assert.match(doc, /this launch|current launch|this session/i)
})

test('SECURITY.md lists the git-annex hooks and every place they are looked for, including remotes and the push-time check', () => {
  for (const hook of ['pre-commit-annex', 'post-update-annex', 'freezecontent-annex', 'thawcontent-annex', 'secure-erase-annex', 'commitmessage-annex', 'http-headers-annex', 'pre-init-annex']) {
    assert.ok(doc.includes(hook), hook)
  }
  assert.match(doc, /local-path remote/i)
  assert.match(doc, /right before a push/i)
  assert.match(doc, /safe\.bareRepository/)
  assert.doesNotMatch(doc, /two hooks of its own/)
})

test("SECURITY.md says a local remote is judged like an opened repository, and why", () => {
  assert.match(doc, /clears[^.]*GIT_CONFIG/i)
  assert.match(doc, /receive-side|pre-receive/)
  assert.match(doc, /stock git-annex hooks/i)
})

test('SECURITY.md states the trust-before-run rule, its sources, and its limits', () => {
  assert.match(doc, /trust before run/i)
  assert.match(doc, /trustedRoots/)
  assert.match(doc, /Trust everything inside this folder/)
  assert.match(doc, /created[^.]*empty/i)
  assert.match(doc, /share'?s? own permissions/i)
  assert.match(doc, /ownership/i)
  const main = readFileSync(new URL('../src/gui/main.js', import.meta.url), 'utf8')
  assert.match(main, /policy\.trustedRoots/)
})
