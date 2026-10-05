// Needs a real DataLad + git-annex (like real-annex-roundtrip.e2e.mjs). Proves the science-workflow
// additions against real tools: add folder remote → publish with data → verify → free up space →
// version tag reaches the remote → recorded run shown in Time Machine.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let root
let projectPath
let backupPath

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' })
const idle = (id, label) =>
  app.page.waitForFunction(
    ([elementId, text]) => {
      const el = document.getElementById(elementId)
      return el && !el.disabled && el.textContent.trim() === text
    },
    [id, label],
    { timeout: 60_000 }
  )
// The flow is several awaited steps, so the button is idle before it starts: wait for the status line instead.
const statusLine = (pattern) =>
  app.page.waitForFunction(
    (source) => new RegExp(source).test(document.getElementById('last-action-state')?.textContent ?? ''),
    pattern.source,
    { timeout: 60_000 }
  )
const commandOutput = () => app.page.evaluate(() => document.getElementById('command-output')?.textContent)

test.before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dlad-e2e-science-'))
  projectPath = join(root, 'study')
  backupPath = join(root, 'usb')
  await mkdir(backupPath)
  sh('datalad', ['create', projectPath])
  await writeFile(join(projectPath, 'data.bin'), 'x'.repeat(4096))
  sh('datalad', ['save', '-m', 'add data'], projectPath)
  // node, not wc: `datalad run` uses cmd.exe on Windows, which has no wc.
  sh('datalad', ['run', '-m', 'size', `node -e "const fs = require('fs'); fs.writeFileSync('size.txt', String(fs.statSync('data.bin').size))"`], projectPath)
  app = await launchApp({ trustedPaths: [projectPath] })
  await app.openProject(projectPath)
})

test.after(async () => {
  await app?.close()
})

test('Add a Remote creates an annex-ready folder copy and publishes the data to it', async () => {
  await app.page.evaluate((path) => {
    document.getElementById('add-remote').open = true
    document.getElementById('add-remote-location').value = path
    document.getElementById('add-remote-connect').click()
  }, backupPath)
  await statusLine(/Connected to backup and published|failed/)

  const whereis = sh('git', ['annex', 'whereis', 'data.bin'], projectPath)
  assert.match(whereis, /2 copies/, await commandOutput())
})

test('Check Data Integrity reports all files intact', async () => {
  await app.page.evaluate(() => document.getElementById('verify-data').click())
  await idle('verify-data', 'Check Data Integrity')
  const text = await app.page.evaluate(() => document.getElementById('verify-output').textContent)
  assert.match(text, /intact/, await commandOutput())
})

test('Free Up Space removes the local copy now that the backup has one', async () => {
  await app.page.evaluate(() => {
    window.confirm = () => true
    document.getElementById('paths').value = 'data.bin'
    document.getElementById('drop-data').click()
  })
  await idle('drop-data', 'Free Up Space')
  assert.equal(sh('git', ['annex', 'find', '--in', 'here', 'data.bin'], projectPath).trim(), '', await commandOutput())
})

test('a version marked in git reaches the remote on Publish', async () => {
  // Made under the identity the app sees in this project, like Mark As Version does; the UI path is covered by unit tests.
  // No -c override: the project's own config beats the app's global one, and CI's datalad create writes one there.
  execFileSync('git', ['tag', '-a', 'v1.0', '-m', 'Version v1.0'], {
    cwd: projectPath, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: app.gitConfigGlobal }
  })
  sh('git', ['-c', 'user.email=bob@example.org', '-c', 'user.name=Bob', 'tag', '-a', 'theirs', '-m', 'from a collaborator'], projectPath)
  await app.page.evaluate(() => document.getElementById('publish-project').click())
  // The tag push runs right after Publish finishes (the button is idle by then): poll the remote.
  let tags = ''
  for (let i = 0; i < 60 && !/v1\.0/.test(tags); i++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    tags = sh('git', ['--git-dir', backupPath, 'tag'])
  }
  // Publish's own output is the last thing on screen, so a missing tag says nothing about why: show what the app saw.
  const why = async () =>
    JSON.stringify({
      commandOutput: await commandOutput(),
      lastActionState: await app.page.evaluate(() => document.getElementById('last-action-state')?.textContent),
      appEmail: sh('git', ['config', '--file', app.gitConfigGlobal, 'user.email']).trim(),
      projectTags: sh('git', ['for-each-ref', '--format=%(refname:short) %(taggeremail)', 'refs/tags'], projectPath),
      // The app's own question, asked from here with the app's global config, and the raw bytes it parses.
      gitConfigAsApp: (() => {
        try {
          return execFileSync('git', ['-C', projectPath, 'config', '--show-origin', '--get-all', 'user.email'], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: app.gitConfigGlobal } })
        } catch (e) {
          return `error: ${e.message}`
        }
      })(),
      rawTagRefs: sh('git', ['for-each-ref', '--format=%(refname:short)%00%(taggeremail)', 'refs/tags'], projectPath),
      gitVersion: sh('git', ['--version']).trim(),
      listOwnTags: await app.page.evaluate((p) => window.dataladDesktop.listOwnTags(p).catch((e) => `error: ${e.message}`), projectPath),
      remoteTags: tags
    }, null, 2)
  if (!/v1\.0/.test(tags)) {
    assert.fail(await why())
  }
  assert.doesNotMatch(tags, /theirs/, 'a collaborator\'s tag is not republished')
})

test('Time Machine marks the datalad run commit and shows its command', async () => {
  await app.page.evaluate(() => document.querySelector('[data-nav-target="time-machine-zone"]').click())
  await app.page.waitForSelector('.run-chip', { timeout: 30_000 })
  await app.page.evaluate(() => document.querySelector('.tm-commit-item .run-chip').closest('.tm-commit-item').click())
  await app.page.waitForSelector('.tm-run-record pre', { timeout: 30_000 })
  assert.match(await app.page.evaluate(() => document.querySelector('.tm-run-record pre').textContent), /statSync\('data\.bin'\)/)
})
