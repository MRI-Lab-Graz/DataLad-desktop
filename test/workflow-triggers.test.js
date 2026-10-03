import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (name) =>
  readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')

const perCommit = ['smoke-cross-platform', 'test-coverage', 'security-checks']

for (const name of perCommit) {
  test(`${name}: pushes only on main, still runs on PRs, and cancels superseded runs`, async () => {
    const workflow = await read(name)
    assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main\b/)
    assert.doesNotMatch(workflow, /- '\*\*'\n\s*(pull_request|paths)/)
    assert.match(workflow, /pull_request:/)
    assert.match(workflow, /concurrency:\s*\n\s*group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\s*\n\s*cancel-in-progress: true/)
  })
}

test('smoke skips docs-only commits', async () => {
  const workflow = await read('smoke-cross-platform')
  assert.match(workflow, /paths-ignore:[^]*- 'docs\/\*\*'[^]*- '\*\*\.md'/)
})

// A leaked secret can land in a docs-only commit, so the scan must never be path-filtered.
test('security checks are never path-filtered', async () => {
  assert.doesNotMatch(await read('security-checks'), /paths(-ignore)?:/)
})
