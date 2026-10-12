// Real DataLad + git-annex: one Save records changes inside a nested dataset too and leaves the whole project
// clean (without `save -r` the root showed " M sub" until a second Save). Run via `npm run test:e2e`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let root
let sub

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' })
const status = (dir) => sh('git', ['status', '--porcelain'], dir).trim()
const saved = () =>
  app.page.waitForFunction(
    () => /Save (completed|failed)/.test(document.getElementById('last-action-state').textContent),
    null,
    { timeout: 60_000 }
  )

test.before(async () => {
  const base = await mkdtemp(join(tmpdir(), 'dlad-e2e-recsave-'))
  root = join(base, 'study')
  sub = join(root, 'sub')
  sh('datalad', ['create', root])
  sh('datalad', ['create', '-d', root, sub])
  await writeFile(join(root, 'seed.txt'), 'seed\n')
  sh('datalad', ['save', '-r', '-m', 'baseline'], root)
  assert.equal(status(root), '')
  app = await launchApp({ trustedPaths: [root] })
  await app.openProject(root)
})

test.after(async () => {
  await app?.close()
})

test('one Save records changes in the root and in the nested dataset, and leaves both clean', async () => {
  await writeFile(join(root, 'new-root.txt'), 'root change\n')
  await writeFile(join(sub, 'new-sub.txt'), 'nested change\n')
  await app.page.waitForFunction(() => document.getElementById('changed-files-output').textContent.includes('new-root.txt'), null, { timeout: 30_000 })
  await app.page.fill('#message', 'both levels')
  await app.page.click('#save-project')
  await saved()
  assert.equal(status(root), '', 'the root is clean (it recorded the nested dataset\'s new state)')
  assert.equal(status(sub), '', 'the nested dataset is clean')
  assert.match(sh('git', ['log', '--all', '--format=%s'], sub), /both levels/)
})

test('saving only a file inside the nested dataset also updates the root (needs save -d . -r)', async () => {
  await writeFile(join(sub, 'again.txt'), 'only nested\n')
  await app.page.waitForFunction(() => document.getElementById('changed-files-output').textContent.includes('again.txt'), null, { timeout: 30_000 })
  // Tick exactly the nested file (the list also offers the nested dataset itself, ticked by default).
  await app.page.evaluate(() => {
    for (const box of document.querySelectorAll('#changed-files-output input[data-changed-path]')) {
      const wanted = box.dataset.changedPath === 'sub/again.txt'
      if (box.checked !== wanted) box.click()
    }
  })
  await app.page.fill('#message', 'nested only')
  await app.page.click('#save-project')
  // Poll git rather than the page (the status text from the previous Save is still showing), and wait for the root
  // too: DataLad commits the nested dataset first and records it in the root a moment later.
  for (let i = 0; i < 120 && !(/nested only/.test(sh('git', ['log', '--all', '--format=%s'], sub)) && status(root) === ''); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.equal(status(sub), '')
  assert.equal(status(root), '', 'the root recorded the new nested state')
  assert.match(sh('git', ['log', '--all', '--format=%s'], sub), /nested only/)
})
