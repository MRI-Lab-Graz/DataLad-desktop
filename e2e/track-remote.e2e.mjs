// Needs a real DataLad + git-annex (no Electron). After Add a Remote, a plain Publish (no --to) must find its
// target. On Windows git-annex keeps datasets on an adjusted branch ("adjusted/master(unlocked)"), and DataLad
// looks up the push target on the base branch, so both need the upstream. `git annex adjust` makes the same
// situation on any platform.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

for (const adjusted of [false, true]) {
  test(`Publish finds its target after Add a Remote (${adjusted ? 'adjusted branch, as on Windows' : 'ordinary branch'})`, async () => {
    const base = mkdtempSync(join(tmpdir(), 'dlad-track-'))
    const project = join(base, 'study')
    const backup = join(base, 'usb')
    sh('datalad', ['create', project])
    writeFileSync(join(project, 'data.bin'), 'x'.repeat(2048))
    sh('datalad', ['save', '-m', 'add data'], project)
    if (adjusted) {
      sh('git', ['annex', 'adjust', '--unlock'], project)
      assert.match(sh('git', ['branch', '--show-current'], project), /^adjusted\//)
    }

    const adapter = new DataLadAdapter()
    await adapter.prepareFolderRemote(backup)
    assert.equal((await adapter.runCommand('addRemote', { projectPath: project, remoteName: 'backup', url: backup })).ok, true)
    assert.equal((await adapter.runCommand('push', { projectPath: project, remoteName: 'backup' })).ok, true)
    await adapter.trackRemote(project, 'backup')

    const publish = await adapter.runCommand('push', { projectPath: project })
    assert.equal(publish.ok, true, publish.stdout + publish.stderr)
  })
}
