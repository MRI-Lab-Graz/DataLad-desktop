import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { resolveTool } from '../src/datalad/resolve-tool.js'

async function fakeTool(dir, file) {
  await mkdir(dir, { recursive: true })
  const p = join(dir, file)
  await writeFile(p, '')
  await chmod(p, 0o755)
  return p
}

test('resolveTool returns the absolute path of a tool found on PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt-'))
  const real = await fakeTool(join(root, 'bin'), 'mytool')
  assert.equal(resolveTool('mytool', { pathEnv: join(root, 'bin'), platform: 'linux' }), real)
})

test('resolveTool ignores empty, "." and relative PATH entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt-'))
  await fakeTool(join(root, 'planted'), 'mytool')
  const pathEnv = ['', '.', 'planted'].join(delimiter)
  const prev = process.cwd()
  process.chdir(root)
  try {
    assert.equal(resolveTool('mytool', { pathEnv, platform: 'linux' }), null)
  } finally {
    process.chdir(prev)
  }
})

test('resolveTool tries PATHEXT on win32 and finds the executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt-'))
  const exe = await fakeTool(join(root, 'bin'), 'git.exe')
  assert.equal(
    resolveTool('git', { pathEnv: join(root, 'bin'), platform: 'win32', pathExt: '.exe;.cmd' }),
    exe
  )
})

test('resolveTool returns null for names containing a path separator', () => {
  assert.equal(resolveTool('../evil', { pathEnv: '/usr/bin', platform: 'linux' }), null)
})
