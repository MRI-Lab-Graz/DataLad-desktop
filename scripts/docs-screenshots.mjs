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
await wipe().catch(() => {})
await mkdir(root, { recursive: true })
const gitconfig = join(await mkdtemp(join(tmpdir(), 'dlad-docs-cfg-')), 'gitconfig')
await writeFile(gitconfig, '[user]\n\tname = Alex Researcher\n\temail = alex@university.example\n')
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: gitconfig } })
const project = join(root, 'pilot-study-001')
sh('datalad', ['create', project])
await mkdir(join(project, 'data'))
await writeFile(join(project, 'README.md'), '# Pilot study 001\nPurpose: pilot of the memory task.\n')
sh('datalad', ['save', '-m', 'Add project README'], project)
await writeFile(join(project, 'data', 'participants.tsv'), 'id\tage\nsub-01\t24\nsub-02\t31\n')
sh('datalad', ['save', '-m', 'Add participant table'], project)
await writeFile(join(project, 'data', 'notes.txt'), 'Session notes, not yet saved.\n') // left unsaved on purpose

const app = await launchApp({ trustedPaths: [project], env: { GIT_CONFIG_GLOBAL: gitconfig } })
const { page } = app
const settle = () => page.waitForTimeout(900) // reveal animations
const shot = async (name) => {
  await settle()
  await page.screenshot({ path: out + name + '.png', fullPage: true })
}
const tab = async (target) => {
  // Tiles toggle, and Save is already open after a project loads, so only click a tile that is not selected.
  await page.evaluate((t) => {
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
} finally {
  await app.close()
  await wipe()
}
