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

test('resolveTool finds git.exe on win32', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt-'))
  const exe = await fakeTool(join(root, 'bin'), 'git.exe')
  assert.equal(
    resolveTool('git', { pathEnv: join(root, 'bin'), platform: 'win32' }),
    exe
  )
})

test('resolveTool returns null for names containing a path separator', () => {
  assert.equal(resolveTool('../evil', { pathEnv: '/usr/bin', platform: 'linux' }), null)
})

// Windows never runs an extensionless file, and Node cannot spawn .cmd/.bat shims without a shell
// (spawn throws EINVAL), so only real executables count, whichever PATH directory comes first.
test('resolveTool on win32 accepts only .exe/.com, never extensionless files or .cmd/.bat shims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt-'))
  await fakeTool(join(root, 'shims'), 'git')
  await fakeTool(join(root, 'shims'), 'git.cmd')
  await fakeTool(join(root, 'shims'), 'git.bat')
  const exe = await fakeTool(join(root, 'real'), 'git.exe')
  assert.equal(resolveTool('git', { pathEnv: join(root, 'shims'), platform: 'win32' }), null)
  assert.equal(
    resolveTool('git', { pathEnv: [join(root, 'shims'), join(root, 'real')].join(delimiter), platform: 'win32' }),
    exe
  )
})

// A Finder/Dock launch has a minimal PATH without Homebrew's folders.
test('resolveTool falls back to extraDirs when PATH lacks the tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt-'))
  const brew = await fakeTool(join(root, 'brew'), 'mytool')
  assert.equal(
    resolveTool('mytool', { pathEnv: '/usr/bin', platform: 'darwin', extraDirs: [join(root, 'brew')] }),
    brew
  )
})

test('resolveTool prefers PATH over extraDirs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt-'))
  const onPath = await fakeTool(join(root, 'path'), 'mytool')
  await fakeTool(join(root, 'brew'), 'mytool')
  assert.equal(
    resolveTool('mytool', { pathEnv: join(root, 'path'), platform: 'darwin', extraDirs: [join(root, 'brew')] }),
    onPath
  )
})

test('resolveTool ignores extraDirs on win32', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rt-'))
  await fakeTool(join(root, 'brew'), 'mytool.exe')
  assert.equal(
    resolveTool('mytool', { pathEnv: '', platform: 'win32', extraDirs: [join(root, 'brew')] }),
    null
  )
})

test('resolveTool defaults extraDirs to the Homebrew/MacPorts folders (absolute only)', () => {
  // no tool of this name exists anywhere; just proves the default does not throw and stays null
  assert.equal(resolveTool('no-such-tool-xyz', { pathEnv: '/usr/bin', platform: 'darwin' }), null)
})
