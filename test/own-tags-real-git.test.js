import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { ProcessRunner } from '../src/datalad/process-runner.js'

// Real git and the real runner (no fake): the Windows e2e saw Publish send no versions.
test('listOwnTags reads the tagger identity from a real repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dlad-owntags-'))
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git(['init', '-q'])
  git(['config', 'user.email', 'ana@example.org'])
  git(['config', 'user.name', 'Ana'])
  git(['commit', '--allow-empty', '-q', '-m', 'init'])
  git(['tag', '-a', 'v1.0', '-m', 'mine'])
  git(['-c', 'user.email=bob@example.org', '-c', 'user.name=Bob', 'tag', '-a', 'theirs', '-m', 'bob'])
  git(['tag', 'light'])

  assert.deepEqual(await new DataLadAdapter({ runner: new ProcessRunner() }).listOwnTags(dir), ['v1.0'])
})
