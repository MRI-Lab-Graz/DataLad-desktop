// Regenerates docs/_static/screenshots/*.png from the real app against a throwaway demo project.
// Run: node scripts/docs-screenshots.mjs   (needs datalad + git-annex on PATH)
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../e2e/electron-driver.mjs'

const out = new URL('../docs/_static/screenshots/', import.meta.url).pathname
// A short, neutral path keeps the machine's temp folder out of the pictures.
const root = '/tmp/projects'
const wipe = async () => {
  execFileSync('chmod', ['-R', 'u+w', root], { stdio: 'ignore' }) // annex objects are read-only
  await rm(root, { recursive: true, force: true })
}
await mkdir(root) // throws if it exists: never delete a folder this script did not create
const gitconfig = join(await mkdtemp(join(tmpdir(), 'dlad-docs-cfg-')), 'gitconfig')
await writeFile(gitconfig, '[user]\n\tname = Alex Researcher\n\temail = alex@university.example\n')
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: gitconfig } })
const project = join(root, 'pilot-study-001')
sh('datalad', ['create', project])
// README is a plain git file, so the demo can edit and merge it (annexed files are read-only links).
await writeFile(join(project, '.gitattributes'), 'README.md annex.largefiles=nothing\n', { flag: 'a' })
sh('datalad', ['save', '-m', 'Keep README in git'], project)
await mkdir(join(project, 'data'))
await writeFile(join(project, 'README.md'), '# Pilot study 001\nPurpose: pilot of the memory task.\n')
sh('datalad', ['save', '-m', 'Add project README'], project)
await writeFile(join(project, 'data', 'participants.tsv'), 'id\tage\nsub-01\t24\nsub-02\t31\n')
sh('datalad', ['save', '-m', 'Add participant table'], project)
await writeFile(join(project, 'data', 'notes.txt'), 'Session notes, not yet saved.\n') // left unsaved on purpose

// A shared folder (like a USB drive or lab share) as the remote, so Update and Publish show.
const share = join(root, 'lab-share.git')
sh('git', ['init', '--bare', share], root)
sh('datalad', ['siblings', 'add', '-s', 'lab-share', '--url', share], project)
sh('git', ['push', '-u', 'lab-share', sh('git', ['branch', '--show-current'], project).trim()], project) // upstream set: Update and Publish become available

const app = await launchApp({ trustedPaths: [project], env: { GIT_CONFIG_GLOBAL: gitconfig } })
const { page } = app
const settle = () => page.waitForTimeout(900) // reveal animations
const shot = async (name, fullPage = true) => {
  await settle()
  await page.screenshot({ path: out + name + '.png', fullPage })
}
// Save lives on Home; every other panel is a Tool. Switch views first, then (for tools) pick the tile.
const tab = async (target) => {
  await page.evaluate((t) => {
    const toolsOpen = !document.getElementById('project-tools').hidden
    if (t === 'save-checkpoint-panel') {
      if (toolsOpen) document.getElementById('close-tools').click()
      return
    }
    if (!toolsOpen) document.getElementById('open-tools').click()
    const tile = document.querySelector(`[data-nav-target="${t}"]`)
    if (tile.getAttribute('aria-selected') !== 'true') tile.click()
  }, target)
  await page.waitForFunction((t) => !document.getElementById(t).hidden, target)
  await settle()
}
try {
  await page.setViewportSize({ width: 1180, height: 820 })
  await shot('01-setup')
  await page.evaluate(() => document.getElementById('close-settings').click())
  await shot('02-welcome')
  await app.openProject(project)
  await shot('03-project-open')
  await tab('save-checkpoint-panel')
  await page.fill('#message', 'pilot: add session notes')
  await shot('04-save-checkpoint')
  await tab('files-panel')
  await shot('05-files')
  await tab('time-machine-zone')
  await shot('06-time-machine')

  // Tutorial 02: several changed files, only some ticked for one save.
  await mkdir(join(project, 'data', 'clean'), { recursive: true })
  await mkdir(join(project, 'metadata'))
  await mkdir(join(project, 'analysis'))
  await writeFile(join(project, 'data', 'clean', 'participants_clean.tsv'), 'id\tage\nsub-01\t24\nsub-02\t31\n')
  await writeFile(join(project, 'metadata', 'data-dictionary.md'), '# Data dictionary\n- age: years\n')
  await writeFile(join(project, 'analysis', 'notebook.ipynb'), '{}\n')
  await tab('save-checkpoint-panel')
  await page.waitForFunction(() => document.querySelectorAll('.changed-file-toggle').length >= 4)
  await page.evaluate(() => {
    for (const box of document.querySelectorAll('.changed-file-toggle')) {
      const keep = /notebook|notes\.txt/.test(box.dataset.changedPath)
      if (keep && box.checked) box.click()
    }
  })
  await page.fill('#message', 'cleaning: normalize participant table and update dictionary')
  await shot('07-save-pick-files')
  await page.click('#save-project')
  await page.waitForFunction(() => document.querySelectorAll('.changed-file-toggle').length === 2, null, { timeout: 30000 })

  // Tutorials 03 and 04: branches with a clean merge on offer, then a real conflict.
  sh('git', ['switch', '-c', 'feature/preprocessing'], project)
  await mkdir(join(project, 'scripts'))
  await writeFile(join(project, 'scripts', 'preprocess.py'), 'print("preprocess")\n')
  sh('git', ['add', 'scripts'], project)
  sh('git', ['commit', '-m', 'preprocessing: add script'], project)
  sh('git', ['switch', '-c', 'feature/figures', 'main'], project)
  await writeFile(join(project, 'README.md'), '# Pilot study 001\nPurpose: figures for the memory task.\n')
  sh('git', ['commit', '-am', 'figures: describe the aim'], project)
  sh('git', ['switch', 'main'], project)
  await writeFile(join(project, 'README.md'), '# Pilot study 001\nPurpose: pilot of the memory task, 24 people.\n')
  sh('git', ['commit', '-am', 'readme: add sample size'], project)
  await tab('project-setup-zone')
  await page.click('#refresh-branches')
  await page.waitForFunction(() => document.querySelectorAll('#merge-branch-select option').length >= 2)
  await page.selectOption('#merge-branch-select', 'feature/preprocessing')
  await shot('08-branches-merge')

  // Tutorial 06: Run & record, and the Sync tool.
  await tab('time-machine-zone')
  await page.click('#open-run')
  await page.fill('#run-command', 'python summarize.py')
  await page.fill('#run-inputs', 'data/participants.tsv')
  await page.fill('#run-outputs', 'summary.txt')
  await page.fill('#run-message', 'Summary table for the paper')
  await shot('10-run-and-record', false) // a dialog covers only the window
  await page.click('#run-cancel')
  await tab('sync-data-section')
  await shot('11-sync')

  // The conflict: the same README line changed on both branches.
  await tab('project-setup-zone')
  await page.selectOption('#merge-branch-select', 'feature/figures')
  await page.click('#merge-branch')
  await page.waitForFunction(() => !document.getElementById('merge-banner').hidden, null, { timeout: 30000 })
  await tab('save-checkpoint-panel')
  await page.evaluate(() => document.getElementById('last-action-details').removeAttribute('open')) // a raw command is noise here
  await shot('09-merge-conflict')
} finally {
  await app.close()
  await wipe()
}
