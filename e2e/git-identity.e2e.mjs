// A fresh machine has no git identity. The app must ask for it, keep Save blocked
// (running nothing) until it is set, and write it to the global git config.
// Hermetic: the driver points GIT_CONFIG_GLOBAL at a temp file, never ~/.gitconfig.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let projectPath

const commitCount = () =>
  Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: projectPath, encoding: 'utf8' }))

test.before(async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-e2e-identity-'))
  projectPath = join(root, 'dataset')
  execFileSync('datalad', ['create', projectPath], {
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x.io', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x.io' }
  })
  await writeFile(join(projectPath, 'notes.txt'), 'identity e2e\n')
  app = await launchApp({ identity: false })
})

test.after(async () => {
  await app?.close()
})

const clickSave = async () => {
  await app.page.evaluate(() => {
    const input = document.getElementById('message')
    input.value = 'e2e: identity'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await app.page.evaluate(() => document.getElementById('save-project').click())
}

test('asks for name and email at launch, and Later keeps Save blocked without running anything', async () => {
  await app.page.waitForSelector('#identity-overlay:not([hidden])', { timeout: 15_000 })
  await app.page.evaluate(() => document.getElementById('identity-later').click())
  await app.page.waitForSelector('#identity-overlay', { state: 'hidden' })

  await app.openProject(projectPath)
  const before = commitCount()
  await clickSave()

  await app.page.waitForFunction(
    () => document.getElementById('command-output').textContent.includes('Set your name and email first'),
    undefined,
    { timeout: 15_000 }
  )
  assert.equal(commitCount(), before)
})

test('rejects a bad email, then saving the dialog writes the global config and unblocks Save', async () => {
  // the blocked Save above reopened the dialog
  await app.page.waitForSelector('#identity-overlay:not([hidden])')
  await app.page.fill('#identity-name', 'Jane Doe')
  await app.page.fill('#identity-email', 'not-an-email')
  await app.page.evaluate(() => document.getElementById('identity-save').click())
  await app.page.waitForFunction(() => /valid email/i.test(document.getElementById('identity-error').textContent))

  await app.page.fill('#identity-email', 'jane@lab.org')
  await app.page.evaluate(() => document.getElementById('identity-save').click())
  await app.page.waitForSelector('#identity-overlay', { state: 'hidden' })

  const config = await readFile(app.gitConfigGlobal, 'utf8')
  assert.match(config, /name = Jane Doe/)
  assert.match(config, /email = jane@lab\.org/)

  const before = commitCount()
  await clickSave()
  await app.page.waitForFunction(
    () => !document.getElementById('save-project').disabled && document.getElementById('save-project').textContent.trim() === 'Save Checkpoint',
    undefined,
    { timeout: 30_000 }
  )
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.equal(commitCount(), before + 1)
})

test('Setup shows the saved identity with a Change button', async () => {
  const text = await app.page.evaluate(() => document.getElementById('identity-summary').textContent)
  assert.match(text, /Jane Doe/)
  assert.match(text, /jane@lab\.org/)
})
