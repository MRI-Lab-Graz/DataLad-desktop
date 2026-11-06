import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// electron-builder writes these on every build; committed copies go stale (0.3.0)
// and builder-debug.yml leaks CI runner paths.
test('build outputs are not committed and are git-ignored', () => {
  const ignore = read('.gitignore')
  for (const file of ['latest.yml', 'builder-debug.yml']) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, `${file} is committed`)
    assert.doesNotThrow(() => execFileSync('git', ['check-ignore', '-q', file]), `${file} is not ignored`)
  }
  for (const pattern of ['node_modules/', 'dist/', 'build/uv/', '.env']) {
    assert.ok(ignore.split(/\r?\n/).includes(pattern), `.gitignore lacks ${pattern}`)
  }
})

test('.gitignore only carries what a Node/Electron project needs', () => {
  const rules = read('.gitignore').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'))
  assert.ok(rules.length < 25, `${rules.length} rules`)
  assert.doesNotMatch(read('.gitignore'), /Django|Flask|Celery|Scrapy|PyInstaller|Jupyter/)
})

test('no tracked file is a stray build output', () => {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n')
  assert.deepEqual(tracked.filter((f) => /^(latest.*|builder-debug)\.yml$/.test(f)), [])
})

// One release pipeline (GitHub Actions) until the GitLab one is as hardened. An early GitLab copy built unsigned, ran
// no tests and posted releases with a job token. A GitLab pipeline that only tests is fine; one that publishes is not (yet).
const PUBLISHES = /release_gitlab|stage:\s*release|\/releases|CI_JOB_TOKEN|JOB-TOKEN|--publish\s*=?\s*always/
test('a GitLab pipeline may test, but must not publish releases yet', () => {
  const file = new URL('../.gitlab-ci.yml', import.meta.url)
  if (existsSync(file)) assert.doesNotMatch(readFileSync(file, 'utf8'), PUBLISHES)
})
test('the publishing check does catch the early GitLab release pipeline', () => {
  const early = `release_gitlab:\n  stage: release\n  script:\n    - curl --header "JOB-TOKEN: $CI_JOB_TOKEN" "$CI_API_V4_URL/projects/1/releases"`
  assert.match(early, PUBLISHES)
})
