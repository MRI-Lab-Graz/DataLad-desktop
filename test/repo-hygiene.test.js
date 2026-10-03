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
    assert.ok(ignore.split('\n').includes(pattern), `.gitignore lacks ${pattern}`)
  }
})

test('.gitignore only carries what a Node/Electron project needs', () => {
  const rules = read('.gitignore').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  assert.ok(rules.length < 25, `${rules.length} rules`)
  assert.doesNotMatch(read('.gitignore'), /Django|Flask|Celery|Scrapy|PyInstaller|Jupyter/)
})

test('no tracked file is a stray build output', () => {
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n')
  assert.deepEqual(tracked.filter((f) => /^(latest.*|builder-debug)\.yml$/.test(f)), [])
})
