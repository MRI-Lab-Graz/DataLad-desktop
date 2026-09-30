import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workflow = await readFile(
  new URL('../.github/workflows/smoke-cross-platform.yml', import.meta.url),
  'utf8'
)

// datalad-installer's macOS git-annex is an Intel-only dmg, so on Apple
// silicon runners it installs Rosetta first, and that step preceded silent
// job deaths in CI. Homebrew ships a native arm64 bottle instead.
test('macOS smoke job installs git-annex natively via Homebrew, bottle only', () => {
  assert.match(workflow, /brew install --force-bottle git-annex/)
})

test('datalad-installer (Intel-only git-annex on macOS) is Windows-only', () => {
  const step = workflow.split('- name:').find((s) => s.includes('datalad-installer --sudo'))
  assert.ok(step, 'expected a step running datalad-installer for git-annex')
  assert.match(step, /if: runner\.os == 'Windows'/)
})

test('no leftover PATH step sourcing the datalad-installer env file', () => {
  assert.doesNotMatch(workflow, /dl-env\.sh"\s*$\s*echo/m)
  assert.ok(!workflow.includes('source "${{ runner.temp }}/dl-env.sh"'))
})
