// Needs a real DataLad + git-annex (no Electron). "Get Data" with nothing selected must fetch everything:
// DataLad 1.6 rejects a bare `datalad get` ("Neither dataset nor target path(s) provided"), which the
// fake-runner unit tests could not see.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const missing = (dir) => sh('git', ['annex', 'find', '--not', '--in', 'here'], dir).trim().split('\n').filter(Boolean)

test('Get Data with no paths downloads all missing content of a cloned dataset', async () => {
  const base = mkdtempSync(join(tmpdir(), 'dlad-getall-'))
  const source = join(base, 'src')
  const clone = join(base, 'study')
  sh('datalad', ['create', source])
  for (const name of ['a.bin', 'b.bin']) writeFileSync(join(source, name), `content of ${name}\n`)
  sh('datalad', ['save', '-m', 'add'], source)
  sh('datalad', ['clone', source, clone])
  assert.equal(missing(clone).length, 2, 'the clone starts without the content')

  const result = await new DataLadAdapter().runCommand('get', { projectPath: clone })

  assert.equal(result.ok, true, result.stderr || result.stdout)
  assert.deepEqual(missing(clone), [])
})
