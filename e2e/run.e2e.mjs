// Real DataLad + git-annex: Run & record from the dialog records the command as a save; an unsaved project is
// refused with a hint; a missing input and a path leaving the project give friendly errors; the admin switch
// removes the button and the main process refuses. Run via `npm run test:e2e`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './electron-driver.mjs'

let app
let project

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' })
const call = (request, runId) =>
  app.page.evaluate((args) => window.dataladDesktop.runCommand('run', args.request, args.runId), { request, runId })
const openHistory = () =>
  app.page.evaluate(() => {
    if (document.getElementById('project-tools').hidden) document.getElementById('open-tools').click()
    document.querySelector('[data-nav-target="time-machine-zone"]').click()
  })

test.before(async () => {
  const base = await mkdtemp(join(tmpdir(), 'dlad-e2e-run-'))
  project = join(base, 'study')
  sh('datalad', ['create', project])
  await writeFile(join(project, 'data.csv'), 'a,b\n1,2\n')
  // A script file, never inline quotes: the same command works through sh and cmd.exe.
  await writeFile(join(project, 'summarize.js'), "const fs = require('fs'); fs.writeFileSync('summary.txt', fs.readFileSync('data.csv', 'utf8').toUpperCase())\n")
  sh('datalad', ['save', '-m', 'seed'], project)
  app = await launchApp({ trustedPaths: [project] })
  await app.openProject(project)
})

test.after(async () => {
  await app?.close()
})

test('Run & record from the dialog saves the result together with its command', async () => {
  await openHistory()
  await app.page.waitForSelector('#open-run:not([hidden])')
  await app.page.click('#open-run')
  await app.page.fill('#run-command', 'node summarize.js')
  await app.page.fill('#run-inputs', 'data.csv')
  await app.page.fill('#run-outputs', 'summary.txt')
  assert.equal(await app.page.inputValue('#run-message'), 'Run: node summarize.js')
  await app.page.click('#run-submit')
  for (let i = 0; i < 120 && !/DATALAD RUNCMD\] Run: node summarize\.js/.test(sh('git', ['log', '--all', '--format=%s'], project)); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert.match(sh('git', ['log', '--all', '--format=%s'], project), /\[DATALAD RUNCMD\] Run: node summarize\.js/)
  assert.equal((await app.page.evaluate(() => document.getElementById('run-overlay').hidden)), true)
  await access(join(project, 'summary.txt'))
  await app.page.waitForSelector('.run-chip', { timeout: 30_000 })
})

test('braces in a command run exactly as typed (awk, JSON, ${VAR} would otherwise be refused as placeholders)', async () => {
  const result = await call(
    {
      projectPath: project,
      message: 'braces',
      command: `node -e "require('fs').writeFileSync('braces.txt', JSON.stringify({a: 1}))"`,
      outputs: ['braces.txt']
    },
    'e2e-run-braces'
  )
  assert.equal(result.ok, true, result.stdout + result.stderr)
  assert.equal(await readFile(join(project, 'braces.txt'), 'utf8'), '{"a":1}')
  assert.equal(sh('git', ['status', '--porcelain'], project).trim(), '')
})

test('a project with unsaved changes cannot be run until saved, and Escape closes the form', async () => {
  await writeFile(join(project, 'scratch.txt'), 'x\n')
  await app.page.waitForFunction(() => /scratch\.txt/.test(document.getElementById('changed-files-output').textContent), null, { timeout: 30_000 })
  await app.page.click('#open-run')
  await app.page.fill('#run-command', 'node summarize.js')
  assert.equal(await app.page.evaluate(() => document.getElementById('run-submit').disabled), true)
  assert.match(await app.page.textContent('#run-hint'), /Save your changes first/)
  await app.page.keyboard.press('Escape')
  assert.equal(await app.page.evaluate(() => document.getElementById('run-overlay').hidden), true)
  await rm(join(project, 'scratch.txt'))
  await app.page.waitForFunction(() => !/scratch\.txt/.test(document.getElementById('changed-files-output').textContent), null, { timeout: 30_000 })
})

test('a missing input gives a friendly error and a path leaving the project is refused before DataLad', async () => {
  const missing = await call({ projectPath: project, message: 'x', command: 'node summarize.js', inputs: ['nope.txt'] }, 'e2e-run-missing')
  assert.equal(missing.ok, false)
  assert.equal(missing.userError.code, 'RUN_INPUT_MISSING')
  assert.match(missing.userError.message, /nope\.txt/)
  await assert.rejects(
    () => call({ projectPath: project, message: 'x', command: 'node summarize.js', outputs: ['../escape.txt'] }, 'e2e-run-escape'),
    /inside the project/
  )
})

test('the admin switch removes the button and the main process refuses', async () => {
  const locked = await launchApp({ env: { DATALAD_DESKTOP_DISABLE_RUN: '1' }, trustedPaths: [project] })
  try {
    await locked.openProject(project)
    assert.equal(await locked.page.evaluate(() => document.getElementById('open-run').hidden), true)
    await assert.rejects(
      () => locked.page.evaluate((p) => window.dataladDesktop.runCommand('run', { projectPath: p, message: 'x', command: 'node summarize.js' }, 'e2e-run-locked'), project),
      /disabled by your administrator/
    )
  } finally {
    await locked.close()
  }
})
