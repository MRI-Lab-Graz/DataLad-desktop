import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

const dir = new URL('../.github/workflows/', import.meta.url)
const names = (await readdir(dir)).filter((n) => n.endsWith('.yml'))
const text = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(new URL(n, dir), 'utf8')])))
const release = text['build-os-artifacts.yml']

// A moving tag lets whoever controls the action repo run code in our build (and with our secrets).
test('every action is pinned to a full commit SHA', () => {
  for (const [name, body] of Object.entries(text)) {
    for (const [, ref] of body.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      assert.match(ref, /@[0-9a-f]{40}$/, `${name}: ${ref} is not pinned to a commit SHA`)
    }
  }
})

test('every workflow defaults to read-only contents permission', () => {
  for (const [name, body] of Object.entries(text)) {
    assert.match(body, /^permissions:\n  contents: read\n/m, `${name} must start from contents: read`)
  }
})

test('only the publish job can write to the repository, and it can attest provenance', () => {
  const [, publish] = release.split(/^  publish-release:/m)
  assert.match(publish, /permissions:\s*\n\s+contents: write/)
  assert.match(publish, /id-token: write/)
  assert.match(publish, /attestations: write/)
  assert.equal((release.match(/contents: write/g) ?? []).length, 1, 'contents: write only on publish-release')
})

// Secrets written to $GITHUB_ENV are readable by every later step, including third-party actions.
test('signing secrets are passed to the signing step only, never exported to the job', () => {
  assert.doesNotMatch(release, /GITHUB_ENV/)
  const buildSteps = release.split('- name:').filter((s) => /npm ci|npm test/.test(s))
  for (const step of buildSteps) {
    assert.doesNotMatch(step, /secrets\./, 'dependency install/test steps must not see secrets')
  }
})

test('a release tag cannot produce an unsigned build', () => {
  for (const flag of ['MACOS_SIGNING_ENABLED', 'SIGNPATH_ENABLED']) {
    const guard = new RegExp(`startsWith\\(github\\.ref, 'refs/tags/v'\\) && vars\\.${flag} != 'true'`)
    assert.match(release, guard, `no tag guard for ${flag}`)
  }
  assert.match(release, /exit 1/)
})

test('every signed Windows executable replaces its unsigned twin, not just the installer', () => {
  assert.match(release, /for signed in dist-signed\/\*\.exe/)
})

// The app has no auto-updater, and signing changes the installer, so these would be stale or wrong.
test('update metadata and builder debug files are not published', () => {
  assert.doesNotMatch(release, /latest(-mac|-linux)?\.yml/)
  assert.doesNotMatch(release, /builder-debug\.yml/)
  assert.doesNotMatch(release, /\*\*\/\*\.yml/)
})

test('the release publishes SHA256SUMS and a build provenance attestation', () => {
  assert.match(release, /sha256sum/)
  assert.match(release, /SHA256SUMS\.txt/)
  assert.match(release, /actions\/attest-build-provenance@/)
})
