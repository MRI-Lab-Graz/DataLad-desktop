// Needs a real DataLad + git-annex (no Electron). Free Up Space must never remove the only copy, even when
// the dataset's own content tries to allow it: annex.numcopies=0 in a committed .gitattributes, or as the
// git-annex branch setting, is data an attacker (or a careless collaborator) controls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const hasLocalCopy = (dir) => sh('git', ['annex', 'find', '--in', 'here', 'p.txt'], dir).trim() === 'p.txt'

function dataset(name, makeRisky) {
  const dir = join(mkdtempSync(join(tmpdir(), `dlad-drop-${name}-`)), 'd')
  sh('datalad', ['create', dir])
  writeFileSync(join(dir, 'p.txt'), 'the only copy\n')
  sh('datalad', ['save', '-m', 'add'], dir)
  makeRisky(dir)
  return dir
}

// The branch-level setting cannot be lowered at all: git-annex refuses 0, so 1 (one other copy) is the floor.
test('git-annex refuses numcopies 0 as a dataset-wide setting', () => {
  const dir = dataset('floor', () => {})
  assert.throws(() => sh('git', ['annex', 'numcopies', '0'], dir))
})

for (const [name, makeRisky] of [
  ['plain dataset, no other copy', () => {}],
  ['numcopies=0 in a committed .gitattributes', (dir) => {
    appendFileSync(join(dir, '.gitattributes'), '* annex.numcopies=0\n')
    sh('datalad', ['save', '-m', 'attrs'], dir)
  }],
  ['annex.numcopies=0 and annex.mincopies=0 in the repository config', (dir) => {
    sh('git', ['config', 'annex.numcopies', '0'], dir)
    sh('git', ['config', 'annex.mincopies', '0'], dir)
  }],
  ['mincopies=0 in a committed .gitattributes', (dir) => {
    appendFileSync(join(dir, '.gitattributes'), '* annex.mincopies=0\n')
    sh('datalad', ['save', '-m', 'attrs'], dir)
  }]
]) {
  test(`Free Up Space keeps the only copy: ${name}`, async () => {
    const dir = dataset('x', makeRisky)
    const result = await new DataLadAdapter().runCommand('drop', { projectPath: dir, paths: ['p.txt'] })

    assert.equal(result.ok, false)
    assert.equal(result.userError.code, 'DROP_UNSAFE')
    assert.equal(hasLocalCopy(dir), true, 'the file content must still be here')
  })
}
