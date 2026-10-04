import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProcessRunner } from '../src/datalad/process-runner.js'

const hasDatalad = (() => {
  try {
    execFileSync('datalad', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

// CreateProcess searches the calling process's current directory before PATH, so a git.exe at the
// root of a dataset could be what datalad's own `git` launches run on Windows. The planted "git.exe"
// here is a copy of hostname.exe: if datalad ran it, `datalad status` would fail or print the
// machine's name instead of working. Runs on the Windows CI job (Smoke Cross Platform).
test(
  'a git.exe inside a dataset is never what datalad runs on Windows',
  { skip: (process.platform !== 'win32' || !hasDatalad) && 'needs Windows and datalad' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'planted-'))
    const dataset = join(dir, 'ds')
    execFileSync('datalad', ['create', dataset], { stdio: 'ignore' })
    copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'hostname.exe'), join(dataset, 'git.exe'))

    // The app starts datalad exactly like this (adapter.js): -C <project>, cwd = the project.
    const result = await new ProcessRunner().run('datalad', ['-C', dataset, 'status'], { cwd: dataset })

    assert.equal(result.failed, false, `datalad failed, the planted git.exe may have run: ${result.stderr}`)
    assert.ok(!`${result.stdout}${result.stderr}`.toLowerCase().includes(hostname().toLowerCase()), 'the planted git.exe ran')
  }
)
