// A PRISM project (project.json in HEAD) may only be saved when the validator says it is valid.
// Uses a fake prism-validator seeded into the app's managed env (POSIX only).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

const skip = process.platform === 'win32' ? 'fake validator is a shell script' : false
let app
let projectPath

const git = (...args) => execFileSync('git', ['-C', projectPath, ...args], { encoding: 'utf8' })
const commitCount = () => Number(git('rev-list', '--count', 'HEAD'))

const FAKE = `#!/bin/sh
if [ -e "$1/INVALID" ]; then
  echo '{"summary":{"total_errors":1},"results":{"valid":false,"errors":[{"path":"sub-01","message":"missing sidecar"}]}}'
  exit 1
fi
echo '{"summary":{"total_errors":0},"results":{"valid":true,"errors":[]}}'
`

test.before(async () => {
  if (skip) return
  const root = await mkdtemp(join(tmpdir(), 'dlad-e2e-prism-'))
  projectPath = join(root, 'dataset')
  const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.io', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.io' }
  execFileSync('datalad', ['create', projectPath], { stdio: 'ignore', env })
  await writeFile(join(projectPath, 'project.json'), '{}')
  execFileSync('datalad', ['-C', projectPath, 'save', '-m', 'add project.json'], { stdio: 'ignore', env })
  app = await launchApp()
  const bin = join(app.userDataDir, 'env', 'bin')
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'prism-validator'), FAKE)
  await chmod(join(bin, 'prism-validator'), 0o755)
  await app.openProject(projectPath)
})

test.after(async () => {
  await app?.close()
})

const save = async (message) => {
  await app.page.evaluate((m) => {
    const input = document.getElementById('message')
    input.value = m
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('save-project').click()
  }, message)
}

test('shows the PRISM badge for a project with project.json', { skip }, async () => {
  await app.page.waitForSelector('#current-project-prism-badge:not([hidden])', { timeout: 15_000 })
})

test('a valid project saves, and everything is committed even when the UI deselected a file', { skip }, async () => {
  await writeFile(join(projectPath, 'a.txt'), 'a')
  await writeFile(join(projectPath, 'b.txt'), 'b')
  const before = commitCount()
  // Deselect b.txt in the UI: the gated save must still commit it (the whole project was validated).
  await app.page.waitForSelector('[data-changed-path="b.txt"]', { timeout: 15_000 })
  await app.page.evaluate(() => document.querySelector('[data-changed-path="b.txt"]').click())
  await save('e2e: valid')
  await app.page.waitForFunction(() => document.getElementById('command-output').textContent.includes('Saved'), undefined, { timeout: 60_000 })
  assert.equal(commitCount(), before + 1)
  assert.equal(git('status', '--porcelain').trim(), '')
})

test('an invalid project is blocked: nothing is committed and the problem is shown', { skip }, async () => {
  await writeFile(join(projectPath, 'INVALID'), 'x')
  const before = commitCount()
  await save('e2e: invalid')
  await app.page.waitForFunction(
    () => document.getElementById('command-output').textContent.includes("doesn't pass the PRISM check"),
    undefined,
    { timeout: 60_000 }
  )
  const text = await app.page.evaluate(() => document.getElementById('command-output').textContent)
  assert.match(text, /sub-01: missing sidecar/)
  assert.equal(commitCount(), before)
})
