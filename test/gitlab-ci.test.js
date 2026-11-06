import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// The runner on the uni GitLab is a Mac in the lab: it is "protected" (only main and tags) and runs jobs as a real user.
// So the pipeline must (1) only start for main and tags, otherwise a job would wait forever for a runner that refuses it,
// (2) always ask for a tag, never run "untagged", and (3) hold no secrets and publish nothing yet.
const ci = await readFile(new URL('../.gitlab-ci.yml', import.meta.url), 'utf8')

test('the pipeline only starts for the default branch and for tags (the runner is protected)', () => {
  const workflow = ci.slice(ci.indexOf('workflow:'), ci.indexOf('stages:'))
  assert.match(workflow, /\$CI_COMMIT_TAG/)
  assert.match(workflow, /\$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH/)
  assert.doesNotMatch(workflow, /merge_request/)
})

test('the unit tests run on the macOS runner with a clean install, then npm test', () => {
  const job = ci.slice(ci.indexOf('unit_tests_macos:'))
  assert.match(job, /tags:\s*\n\s*- macos/)
  assert.ok(job.indexOf('npm ci') > 0 && job.indexOf('npm ci') < job.indexOf('npm test'))
})

// The job runs as a real user on a lab Mac: dependencies' install scripts (a supply-chain route) must not run.
// The unit tests need none of them (checked: all pass without). The Electron e2e job will need them, and gets its own review.
test('dependencies install without running their install scripts', () => {
  assert.match(ci, /npm ci --ignore-scripts/)
  assert.doesNotMatch(ci, /npm (ci|install)(?![^\n]*--ignore-scripts)/)
})

test('every job names a runner tag, so no job can land on a machine by accident', () => {
  const jobs = ci.split(/^(?=[a-z_]+:\s*$)/m).filter((b) => /^[a-z_]+:\s*\n\s+stage:/.test(b))
  assert.ok(jobs.length >= 1)
  for (const job of jobs) assert.match(job, /tags:/, job.split('\n')[0])
})

test('no secrets, no release upload and no download-and-run in the pipeline yet', () => {
  assert.doesNotMatch(ci, /CI_JOB_TOKEN|glrt-|glpat-|PRIVATE-TOKEN|--header/)
  assert.doesNotMatch(ci, /curl[^\n]*\|\s*(ba)?sh/)
})
