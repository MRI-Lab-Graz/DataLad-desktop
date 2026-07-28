import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { DataLadAdapter, createDataLadAdapter } from '../src/datalad/adapter.js'

class FakeRunner {
  constructor() {
    this.responses = new Map()
    this.calls = []
  }

  set(command, args, response) {
    this.responses.set(this.#key(command, args), response)
  }

  async run(command, args = [], options = {}) {
    this.calls.push({ command, args, options })
    const mocked = this.responses.get(this.#key(command, args))
    if (mocked) {
      return {
        command,
        args,
        exitCode: 0,
        stdout: '',
        stderr: '',
        failed: false,
        ...mocked
      }
    }

    return {
      command,
      args,
      exitCode: 127,
      stdout: '',
      stderr: `unmocked command: ${command}`,
      failed: true
    }
  }

  #key(command, args) {
    return `${command}::${args.join(' ')}`
  }

  setSshPassword(password) {
    this.sshPassword = password || null
  }

  clearSshPassword() {
    this.sshPassword = null
  }

  hasSshPassword() {
    return this.sshPassword != null
  }
}

test('checkEnvironment reports missing tools', async () => {
  const runner = new FakeRunner()
  runner.set('python3', ['--version'], {
    exitCode: 0,
    stdout: 'Python 3.11.0\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['--version'], {
    exitCode: 127,
    stdout: '',
    stderr: 'command not found: datalad',
    failed: true
  })
  runner.set('git', ['annex', 'version'], {
    exitCode: 127,
    stdout: '',
    stderr: 'git: annex is not a git command',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const diagnostics = await adapter.checkEnvironment()

  assert.equal(diagnostics.supported, false)
  assert.equal(diagnostics.python.available, true)
  assert.equal(diagnostics.datalad.available, false)
  assert.equal(diagnostics.gitAnnex.available, false)
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.code).sort(),
    ['DATALAD_MISSING', 'GIT_ANNEX_MISSING']
  )
  assert.equal(diagnostics.report.severity, 'warning')
  assert.equal(diagnostics.report.recoverySteps.length, 2)
})

test('checkEnvironment builds info report when all required tools are available', async () => {
  const runner = new FakeRunner()
  runner.set('python3', ['--version'], {
    exitCode: 0,
    stdout: 'Python 3.12.2\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['--version'], {
    exitCode: 0,
    stdout: 'datalad 1.1.4\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['annex', 'version'], {
    exitCode: 0,
    stdout: 'git-annex version: 10.20240129\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const diagnostics = await adapter.checkEnvironment()

  assert.equal(diagnostics.supported, true)
  assert.equal(diagnostics.report.severity, 'info')
  assert.equal(diagnostics.report.recoverySteps.length, 0)
})

test('checkEnvironment falls back to python when python3 is unavailable', async () => {
  const runner = new FakeRunner()
  runner.set('python3', ['--version'], {
    exitCode: 127,
    stdout: '',
    stderr: 'command not found: python3',
    failed: true
  })
  runner.set('python', ['--version'], {
    exitCode: 0,
    stdout: 'Python 3.10.14\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['--version'], {
    exitCode: 0,
    stdout: 'datalad 1.1.4\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['annex', 'version'], {
    exitCode: 0,
    stdout: 'git-annex version: 10.20240129\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const diagnostics = await adapter.checkEnvironment()

  assert.equal(diagnostics.supported, true)
  assert.equal(diagnostics.python.available, true)
  assert.equal(diagnostics.python.version, 'Python 3.10.14')
  assert.equal(diagnostics.report.recoverySteps.length, 0)
})

test('detectProject returns git classification when no datalad metadata exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-git-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['-C', root, 'status', '--dataset', '.', '--json'], {
    exitCode: 1,
    stdout: '',
    stderr: 'NoDatasetFound: no dataset found at this location',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const project = await adapter.detectProject(root)

  assert.equal(project.classification, 'git')
})

test('detectProject returns superdataset when datalad metadata and subdatasets exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-super-'))
  await mkdir(join(root, '.datalad'), { recursive: true })
  await writeFile(join(root, '.datalad', 'config'), '[datalad]\n')
  await writeFile(
    join(root, '.gitmodules'),
    '[submodule "inputs"]\n\tpath = inputs\n\turl = ../inputs.git\n'
  )

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['-C', root, 'status', '--dataset', '.', '--json'], {
    exitCode: 0,
    stdout: '{"status": "ok"}\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['-C', root, 'subdatasets', '--result-renderer', 'disabled'], {
    exitCode: 0,
    stdout: 'inputs\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const project = await adapter.detectProject(root)

  assert.equal(project.classification, 'superdataset')
})

test('detectProject uses datalad probe even when .datalad metadata is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-probe-dataset-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['-C', root, 'status', '--dataset', '.', '--json'], {
    exitCode: 0,
    stdout: '{"status":"ok"}\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['-C', root, 'subdatasets', '--result-renderer', 'disabled'], {
    exitCode: 0,
    stdout: '',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const project = await adapter.detectProject(root)

  assert.equal(project.classification, 'dataset')
  assert.equal(project.classificationSource.dataset, 'datalad-status-probe')
})

test('detectProject falls back to metadata when datalad probe is inconclusive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-fallback-dataset-'))
  await mkdir(join(root, '.datalad'), { recursive: true })
  await writeFile(join(root, '.datalad', 'config'), '[datalad]\n')

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['-C', root, 'status', '--dataset', '.', '--json'], {
    exitCode: 1,
    stdout: '',
    stderr: 'datalad backend is busy, try again',
    failed: true
  })
  runner.set('datalad', ['-C', root, 'subdatasets', '--result-renderer', 'disabled'], {
    exitCode: 1,
    stdout: '',
    stderr: 'subdatasets unavailable right now',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const project = await adapter.detectProject(root)

  assert.equal(project.classification, 'dataset')
  assert.equal(project.classificationSource.dataset, 'metadata-fallback')
})

test('listDatasets returns root dataset and nested subdatasets from .gitmodules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-list-datasets-'))
  await writeFile(
    join(root, '.gitmodules'),
    '[submodule "inputs"]\n\tpath = inputs\n\turl = ../inputs.git\n' +
      '[submodule "derivatives"]\n\tpath = derivatives/fmriprep\n\turl = ../derivatives.git\n'
  )

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const datasets = await adapter.listDatasets(root)

  assert.equal(datasets.length, 3)
  assert.deepEqual(
    datasets.map((dataset) => dataset.relativePath),
    ['.', 'inputs', 'derivatives/fmriprep']
  )
})

test('listDatasets returns only root dataset when no .gitmodules exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-list-root-only-'))

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const datasets = await adapter.listDatasets(root)

  assert.equal(datasets.length, 1)
  assert.equal(datasets[0].relativePath, '.')
})

test('listDatasets ignores .gitmodules entries that escape the project directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-list-datasets-traversal-'))
  await writeFile(
    join(root, '.gitmodules'),
    '[submodule "evil-relative"]\n\tpath = ../../../../etc\n\turl = ../evil.git\n' +
      '[submodule "evil-absolute"]\n\tpath = /etc\n\turl = ../evil2.git\n' +
      '[submodule "legit"]\n\tpath = inputs\n\turl = ../inputs.git\n'
  )

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const datasets = await adapter.listDatasets(root)

  assert.deepEqual(
    datasets.map((dataset) => dataset.relativePath),
    ['.', 'inputs']
  )
})

test('listDatasets recurses into subdatasets to find nested-within-nested datasets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-list-datasets-deep-'))
  await writeFile(
    join(root, '.gitmodules'),
    '[submodule "sub"]\n\tpath = sub\n\turl = ../sub.git\n'
  )

  const subPath = join(root, 'sub')
  await mkdir(subPath, { recursive: true })
  await writeFile(
    join(subPath, '.gitmodules'),
    '[submodule "subsub"]\n\tpath = subsub\n\turl = ../subsub.git\n'
  )

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const datasets = await adapter.listDatasets(root)

  assert.deepEqual(
    datasets.map((dataset) => dataset.relativePath),
    ['.', 'sub', 'sub/subsub']
  )
  assert.equal(datasets[2].path, join(root, 'sub', 'subsub'))
})

test('ignoreOsNoiseFiles writes OS noise patterns to .git/info/exclude for the root dataset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-os-noise-'))

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'rev-parse', '--git-dir'], {
    exitCode: 0,
    stdout: '.git\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const results = await adapter.ignoreOsNoiseFiles(root)

  assert.deepEqual(results, [{ datasetPath: root, added: true }])
  const content = await readFile(join(root, '.git', 'info', 'exclude'), 'utf8')
  assert.match(content, /^\.DS_Store$/m)
  assert.match(content, /^\._\*$/m)
  assert.match(content, /^Thumbs\.db$/m)
  assert.match(content, /^desktop\.ini$/m)
})

test('ignoreOsNoiseFiles is idempotent and preserves pre-existing custom exclude entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-os-noise-idempotent-'))
  await mkdir(join(root, '.git', 'info'), { recursive: true })
  await writeFile(join(root, '.git', 'info', 'exclude'), 'my-custom-pattern\n', 'utf8')

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'rev-parse', '--git-dir'], {
    exitCode: 0,
    stdout: '.git\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const first = await adapter.ignoreOsNoiseFiles(root)
  assert.deepEqual(first, [{ datasetPath: root, added: true }])

  const second = await adapter.ignoreOsNoiseFiles(root)
  assert.deepEqual(second, [{ datasetPath: root, added: false }])

  const content = await readFile(join(root, '.git', 'info', 'exclude'), 'utf8')
  assert.match(content, /^my-custom-pattern$/m)
  const dsStoreOccurrences = content.split('\n').filter((line) => line.trim() === '.DS_Store').length
  assert.equal(dsStoreOccurrences, 1)
})

test('ignoreOsNoiseFiles resolves a submodule dataset whose --git-dir is an absolute path outside its own folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-os-noise-submodule-'))
  await writeFile(join(root, '.gitmodules'), '[submodule "child"]\n\tpath = child\n\turl = ../child.git\n')
  const childPath = join(root, 'child')
  await mkdir(childPath, { recursive: true })
  const realGitDir = join(root, '.git', 'modules', 'child')

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'rev-parse', '--git-dir'], {
    exitCode: 0,
    stdout: '.git\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', childPath, 'rev-parse', '--git-dir'], {
    exitCode: 0,
    stdout: `${realGitDir}\n`,
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const results = await adapter.ignoreOsNoiseFiles(root)

  assert.deepEqual(results, [
    { datasetPath: root, added: true },
    { datasetPath: childPath, added: true }
  ])
  const content = await readFile(join(realGitDir, 'info', 'exclude'), 'utf8')
  assert.match(content, /^\.DS_Store$/m)
})

test('ignoreOsNoiseFiles returns an empty array for a nonexistent project without throwing', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const results = await adapter.ignoreOsNoiseFiles('/tmp/this-folder-does-not-exist-dlad-test')

  assert.deepEqual(results, [])
})

test('listBranches returns current branch and local branch names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-list-branches-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'branch', '--format=%(refname:short)'], {
    exitCode: 0,
    stdout: 'feature-z\nmain\nfeature-a\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'branch', '--show-current'], {
    exitCode: 0,
    stdout: 'main\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const branches = await adapter.listBranches(root)

  assert.equal(branches.currentBranch, 'main')
  assert.equal(branches.detachedHead, false)
  assert.deepEqual(branches.branches, ['feature-a', 'feature-z', 'main'])
})

test('runCommand routes save through curated datalad invocation', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'save', '--message=checkpoint', '--', 'results.csv'], {
    exitCode: 0,
    stdout: 'save ok\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('save', {
    projectPath: '/tmp/project',
    message: 'checkpoint',
    paths: ['results.csv']
  })

  assert.equal(result.ok, true)
  assert.equal(runner.calls.length, 1)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'save', '--message=checkpoint', '--', 'results.csv'])
  assert.deepEqual(result.warnings, [])
})

test('runCommand builds a safe save invocation even when the message looks like a CLI flag', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'save', '--message=--amend'], {
    exitCode: 0,
    stdout: 'save ok\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('save', {
    projectPath: '/tmp/project',
    message: '--amend'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'save', '--message=--amend'])
})

test('runCommand routes createBranch through curated git invocation', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'checkout', '-b', 'feature/new-ui'], {
    exitCode: 0,
    stdout: 'Switched to a new branch feature/new-ui\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createBranch', {
    projectPath: '/tmp/project',
    branchName: 'feature/new-ui'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'checkout', '-b', 'feature/new-ui'])
})

test('runCommand routes switchBranch through curated git invocation', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'checkout', 'main'], {
    exitCode: 0,
    stdout: 'Switched to branch main\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('switchBranch', {
    projectPath: '/tmp/project',
    branchName: 'main'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'checkout', 'main'])
})

test('runCommand returns non-fatal clone advisories from stderr output', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['install', '-r', '-s', 'https://example.org/ds.git', '--', '/tmp/ds'], {
    exitCode: 0,
    stdout: 'install(ok): /tmp/ds (dataset)\n',
    stderr:
      '[INFO] Remote origin not usable by git-annex; setting annex-ignore\n' +
      '[INFO] https://example.org/ds.git/config download failed: Not Found\n' +
      '[INFO] access to 1 dataset sibling s3-BACKUP not auto-enabled\n',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('cloneInstall', {
    source: 'https://example.org/ds.git',
    targetPath: '/tmp/ds'
  })

  assert.equal(result.ok, true)
  assert.equal(result.warnings.length, 3)
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ['ORIGIN_NOT_ANNEX_REMOTE', 'REMOTE_CONFIG_NOT_FOUND', 'SIBLING_NOT_AUTO_ENABLED']
  )
})

test('runCommand maps publish failure to researcher-facing remote message', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'push'], {
    exitCode: 1,
    stdout: '',
    stderr: 'No configured push target for this dataset',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('push', { projectPath: '/tmp/project' })

  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'REMOTE_MISSING')
})

test('runCommand rejects invalid request shape before shell execution', async () => {
  const runner = new FakeRunner()
  const adapter = new DataLadAdapter({ runner })

  await assert.rejects(
    adapter.runCommand('save', {
      projectPath: '/tmp/project',
      message: 'msg',
      paths: 'results.csv'
    }),
    /paths must be an array/
  )

  assert.equal(runner.calls.length, 0)
})

test('runCommand rejects branch names that would be parsed as flags', async () => {
  const runner = new FakeRunner()
  const adapter = new DataLadAdapter({ runner })

  await assert.rejects(
    adapter.runCommand('createBranch', {
      projectPath: '/tmp/project',
      branchName: '--orphan'
    }),
    /branchName cannot start with -/
  )

  assert.equal(runner.calls.length, 0)
})

test('getLastCommit returns latest commit metadata for git projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-last-commit-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'log', '-1', '--format=%ct%x00%h%x00%s%x00%B'], {
    exitCode: 0,
    stdout: '1716200000\u0000a1b2c3d\u0000checkpoint\u0000checkpoint\n\nwith details\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const commit = await adapter.getLastCommit(root)

  assert.equal(commit.hasCommit, true)
  assert.equal(commit.timestamp, 1716200000)
  assert.equal(commit.commitHash, 'a1b2c3d')
  assert.equal(commit.subject, 'checkpoint')
  assert.equal(commit.message, 'checkpoint\n\nwith details')
})

test('getLastCommit returns no-commits when repository has no history yet', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-last-empty-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'log', '-1', '--format=%ct%x00%h%x00%s%x00%B'], {
    exitCode: 128,
    stdout: '',
    stderr: 'fatal: your current branch main does not have any commits yet',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const commit = await adapter.getLastCommit(root)

  assert.equal(commit.hasCommit, false)
  assert.equal(commit.reason, 'no-commits')
})

test('getWorkingTreeStatus returns clean state when no changes exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-status-clean-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, '-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all'], {
    exitCode: 0,
    stdout: '',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const status = await adapter.getWorkingTreeStatus(root)

  assert.equal(status.clean, true)
  assert.equal(status.totalChanged, 0)
  assert.equal(status.stagedCount, 0)
  assert.equal(status.unstagedCount, 0)
  assert.equal(status.untrackedCount, 0)
  assert.equal(status.conflictCount, 0)
  assert.deepEqual(status.files, [])
})

test('getWorkingTreeStatus parses staged, unstaged, untracked, and conflict changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-status-mixed-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, '-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all'], {
    exitCode: 0,
    stdout: 'M  notes.md\n M analysis.py\n?? raw/new.csv\nUU conflict.txt\nR  old.txt -> renamed.txt\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const status = await adapter.getWorkingTreeStatus(root)

  assert.equal(status.clean, false)
  assert.equal(status.totalChanged, 5)
  assert.equal(status.stagedCount, 3)
  assert.equal(status.unstagedCount, 2)
  assert.equal(status.untrackedCount, 1)
  assert.equal(status.conflictCount, 1)

  const renamed = status.files.find((entry) => entry.path === 'renamed.txt')
  assert.equal(renamed?.status, 'renamed')
  assert.equal(renamed?.staged, true)

  const conflict = status.files.find((entry) => entry.path === 'conflict.txt')
  assert.equal(conflict?.conflicted, true)
  assert.equal(conflict?.status, 'conflict')
})

test('getWorkingTreeStatus normalizes Windows separators from porcelain output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-status-windows-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, '-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all'], {
    exitCode: 0,
    stdout: 'R  inputs\\old.csv -> inputs\\renamed.csv\n?? raw\\new.csv\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const status = await adapter.getWorkingTreeStatus(root)

  assert.deepEqual(
    status.files.map((entry) => entry.path),
    ['inputs/renamed.csv', 'raw/new.csv']
  )
})

test('getWorkingTreeStatus exposes nested file changes for modified submodules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-status-submodule-'))
  const subPath = join(root, 'sub-053')
  await mkdir(subPath, { recursive: true })
  await writeFile(
    join(root, '.gitmodules'),
    '[submodule "sub-053"]\n\tpath = sub-053\n\turl = ../sub-053.git\n'
  )

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, '-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all'], {
    exitCode: 0,
    stdout: ' M sub-053\n',
    stderr: '',
    failed: false
  })
  runner.set(
    'git',
    ['-C', subPath, '-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all'],
    {
      exitCode: 0,
      stdout: ' M data/results.csv\n?? data/new-file.txt\n',
      stderr: '',
      failed: false
    }
  )

  const adapter = new DataLadAdapter({ runner })
  const status = await adapter.getWorkingTreeStatus(root)

  const submodule = status.files.find((entry) => entry.path === 'sub-053')
  assert.equal(submodule?.isSubmodule, true)
  assert.deepEqual(
    submodule?.nestedFiles.map((entry) => entry.path),
    ['sub-053/data/new-file.txt', 'sub-053/data/results.csv']
  )
  assert.equal(submodule?.nestedFiles.find((entry) => entry.path === 'sub-053/data/results.csv')?.status, 'modified')
})

test('readGitignore reports missing file without error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-gitignore-missing-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.readGitignore(root, '.')

  assert.equal(result.exists, false)
  assert.equal(result.content, '')
})

test('addIgnorePatterns creates a new .gitignore and skips already-present patterns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-gitignore-add-'))
  const subPath = join(root, 'sub-053')
  await mkdir(subPath, { recursive: true })
  await writeFile(join(subPath, '.gitignore'), '.DS_Store\n')

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const results = await adapter.addIgnorePatterns(root, ['.', 'sub-053'], ['.DS_Store', 'Thumbs.db'])

  const rootResult = results.find((entry) => entry.relativeDatasetPath === '.')
  assert.deepEqual(rootResult.addedPatterns, ['.DS_Store', 'Thumbs.db'])
  assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), '.DS_Store\nThumbs.db\n')

  const subResult = results.find((entry) => entry.relativeDatasetPath === 'sub-053')
  assert.deepEqual(subResult.addedPatterns, ['Thumbs.db'])
  assert.equal(await readFile(join(subPath, '.gitignore'), 'utf8'), '.DS_Store\nThumbs.db\n')
})

test('clearRepositoryLock removes a leftover .git/index.lock file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-lock-'))
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, '.git', 'index.lock'), '')

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.clearRepositoryLock(root)

  assert.equal(result.removed, true)
  await assert.rejects(readFile(join(root, '.git', 'index.lock')))
})

test('clearRepositoryLock is a no-op when there is no lock file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-lock-none-'))
  await mkdir(join(root, '.git'), { recursive: true })

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.clearRepositoryLock(root)

  assert.equal(result.removed, false)
})

test('listRecentCommits returns commit metadata in log order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-history-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'log', '-n', '2', '--format=%ct%x00%h%x00%an%x00%s'], {
    exitCode: 0,
    stdout: '1716200000\u0000a1b2c3d\u0000Ada Lovelace\u0000Save figures\n1716100000\u0000d4e5f6g\u0000Grace Hopper\u0000Initial import\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const history = await adapter.listRecentCommits(root, { limit: 2 })

  assert.equal(history.commits.length, 2)
  assert.deepEqual(history.commits[0], {
    timestamp: 1716200000,
    commitHash: 'a1b2c3d',
    author: 'Ada Lovelace',
    subject: 'Save figures'
  })
})

test('listRecentCommits returns empty list when repository has no commits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-history-empty-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'log', '-n', '20', '--format=%ct%x00%h%x00%an%x00%s'], {
    exitCode: 128,
    stdout: '',
    stderr: 'fatal: your current branch main has no commits yet',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const history = await adapter.listRecentCommits(root)

  assert.deepEqual(history.commits, [])
})

test('getProjectHealth reports ahead/behind and missing annex content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-health-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    exitCode: 0,
    stdout: 'origin/main\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'rev-list', '--left-right', '--count', 'origin/main...HEAD'], {
    exitCode: 0,
    stdout: '2\t1\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'remote', 'get-url', 'origin'], {
    exitCode: 0,
    stdout: 'git@example.org:lab/study.git\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'annex', 'find', '--not', '--in', 'here'], {
    exitCode: 0,
    stdout: 'rawdata/scan1.nii.gz\nrawdata/scan2.nii.gz\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const health = await adapter.getProjectHealth(root)

  assert.equal(health.hasUpstream, true)
  assert.equal(health.upstream, 'origin/main')
  assert.equal(health.behind, 2)
  assert.equal(health.ahead, 1)
  assert.equal(health.remoteUrl, 'git@example.org:lab/study.git')
  assert.equal(health.annexSupported, true)
  assert.equal(health.missingContentCount, 2)
})

test('getProjectHealth tolerates a remote URL lookup failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-health-noremoteurl-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    exitCode: 0,
    stdout: 'origin/main\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'remote', 'get-url', 'origin'], {
    exitCode: 1,
    stdout: '',
    stderr: "fatal: No such remote 'origin'",
    failed: true
  })
  runner.set('git', ['-C', root, 'rev-list', '--left-right', '--count', 'origin/main...HEAD'], {
    exitCode: 0,
    stdout: '0\t0\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'annex', 'find', '--not', '--in', 'here'], {
    exitCode: 1,
    stdout: '',
    stderr: 'git-annex is not initialized in this repository',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const health = await adapter.getProjectHealth(root)

  assert.equal(health.hasUpstream, true)
  assert.equal(health.upstream, 'origin/main')
  assert.equal(health.remoteUrl, null)
})

test('getProjectHealth degrades gracefully without an upstream or git-annex', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-health-bare-'))
  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    exitCode: 128,
    stdout: '',
    stderr: 'fatal: no upstream configured for branch main',
    failed: true
  })
  runner.set('git', ['-C', root, 'annex', 'find', '--not', '--in', 'here'], {
    exitCode: 1,
    stdout: '',
    stderr: 'git-annex is not initialized in this repository',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const health = await adapter.getProjectHealth(root)

  assert.equal(health.hasUpstream, false)
  assert.equal(health.ahead, null)
  assert.equal(health.behind, null)
  assert.equal(health.annexSupported, false)
  assert.equal(health.missingContentCount, null)
})

test('getInterfaceContract returns stable schema metadata', () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const contract = adapter.getInterfaceContract()

  assert.equal(contract.version, '0.5.0')
  assert.deepEqual(contract.classificationValues, ['git', 'dataset', 'superdataset'])
  assert.deepEqual(contract.commands.save.required, ['projectPath', 'message'])
  assert.deepEqual(contract.commands.createBranch.required, ['projectPath', 'branchName'])
})

test('runCommand routes get without explicit paths to a bare datalad get', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'get'], {
    exitCode: 0,
    stdout: 'get ok\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('get', { projectPath: '/tmp/project' })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'get'])
})

test('runCommand routes update through datalad update --merge', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'update', '--merge'], {
    exitCode: 0,
    stdout: 'update ok\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('update', { projectPath: '/tmp/project' })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'update', '--merge'])
})

test('runCommand routes disconnectRemote through datalad siblings remove', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['siblings', 'remove', '-d', '/tmp/project', '-s', 'origin'], {
    exitCode: 0,
    stdout: '.: origin(?) [git]\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('disconnectRemote', { projectPath: '/tmp/project', remoteName: 'origin' })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['siblings', 'remove', '-d', '/tmp/project', '-s', 'origin'])
  assert.deepEqual(runner.calls[0].options, { cwd: '/tmp/project' })
})

test('runCommand rejects a disconnectRemote remoteName that looks like a CLI flag', async () => {
  const runner = new FakeRunner()
  const adapter = new DataLadAdapter({ runner })

  await assert.rejects(
    adapter.runCommand('disconnectRemote', { projectPath: '/tmp/project', remoteName: '--all' }),
    /remoteName cannot start with -/
  )

  assert.equal(runner.calls.length, 0)
})

test('runCommand does not add a generic advisory when clone stderr only has [INFO] lines', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['install', '-r', '-s', 'https://example.org/ds.git', '--', '/tmp/ds'], {
    exitCode: 0,
    stdout: 'install(ok): /tmp/ds (dataset)\n',
    stderr: 'some other unrecognized clone output\n',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('cloneInstall', {
    source: 'https://example.org/ds.git',
    targetPath: '/tmp/ds'
  })

  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].code, 'CLONE_STDERR_OUTPUT')
})

test('runCommand suppresses the generic clone advisory when stderr is only routine [INFO] logging', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['install', '-r', '-s', 'https://example.org/ds.git', '--', '/tmp/ds'], {
    exitCode: 0,
    stdout: 'install(ok): /tmp/ds (dataset)\n',
    stderr: '[INFO] some other informational clone output\n',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('cloneInstall', {
    source: 'https://example.org/ds.git',
    targetPath: '/tmp/ds'
  })

  assert.equal(result.warnings.length, 0)
})

test('runCommand adds a generic advisory when clone stderr has non-INFO output that matches no known pattern', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['install', '-r', '-s', 'https://example.org/ds.git', '--', '/tmp/ds'], {
    exitCode: 0,
    stdout: 'install(ok): /tmp/ds (dataset)\n',
    stderr: 'some unexpected warning output\n',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('cloneInstall', {
    source: 'https://example.org/ds.git',
    targetPath: '/tmp/ds'
  })

  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].code, 'CLONE_STDERR_OUTPUT')
})

test('runCommand builds a datalad create call for createProject', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['create', '--', '/tmp/new-proj'], {
    exitCode: 0,
    stdout: 'create(ok): /tmp/new-proj (dataset)\n',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createProject', { targetPath: '/tmp/new-proj' })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['create', '--', '/tmp/new-proj'])
})

test('runCommand maps createProject failure to researcher-facing non-empty-folder message', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['create', '--', '/tmp/existing'], {
    exitCode: 1,
    // datalad reports this as a create(error) result line on stdout, not stderr.
    stdout: 'create(error): /tmp/existing (dataset) [will not create a dataset in a non-empty directory, ' +
      'use `--force` option to ignore]\n',
    stderr: '',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createProject', { targetPath: '/tmp/existing' })

  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'TARGET_NOT_EMPTY')
})

test('runCommand builds createProject with a config procedure', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['create', '-c', 'text2git', '--', '/tmp/bids-proj'], {
    exitCode: 0,
    stdout: 'create(ok)\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createProject', { targetPath: '/tmp/bids-proj', procedure: 'text2git' })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['create', '-c', 'text2git', '--', '/tmp/bids-proj'])
})

test('runCommand builds createProject with procedure and force for adopting existing content', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['create', '-c', 'text2git', '--force', '--', '/tmp/existing-bids'], {
    exitCode: 0,
    stdout: 'create(ok)\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createProject', {
    targetPath: '/tmp/existing-bids',
    procedure: 'text2git',
    force: true
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['create', '-c', 'text2git', '--force', '--', '/tmp/existing-bids'])
})

test('runCommand createProject is unchanged when procedure/force are omitted', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['create', '--', '/tmp/plain-proj'], {
    exitCode: 0,
    stdout: 'create(ok)\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createProject', { targetPath: '/tmp/plain-proj' })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['create', '--', '/tmp/plain-proj'])
})

test('runCommand rejects a createProject procedure value that looks like a CLI flag', async () => {
  const runner = new FakeRunner()
  const adapter = new DataLadAdapter({ runner })

  await assert.rejects(
    adapter.runCommand('createProject', { targetPath: '/tmp/proj', procedure: '--evil' }),
    /procedure cannot start with -/
  )

  assert.equal(runner.calls.length, 0)
})

test('runCommand routes createSubdataset through curated datalad invocation', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['create', '-d', '/tmp/proj', '-c', 'text2git', '--force', '--', 'sub-01'], {
    exitCode: 0,
    stdout: 'create(ok)\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createSubdataset', {
    projectPath: '/tmp/proj',
    relativePath: 'sub-01',
    procedure: 'text2git',
    force: true
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['create', '-d', '/tmp/proj', '-c', 'text2git', '--force', '--', 'sub-01'])
  assert.deepEqual(runner.calls[0].options, { cwd: '/tmp/proj' })
})

test('runCommand createSubdataset omits force/procedure when not provided', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['create', '-d', '/tmp/proj', '--', 'rawdata'], {
    exitCode: 0,
    stdout: 'create(ok)\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createSubdataset', {
    projectPath: '/tmp/proj',
    relativePath: 'rawdata'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['create', '-d', '/tmp/proj', '--', 'rawdata'])
})

test('runCommand createSubdataset rejects a path-traversal relativePath', async () => {
  const runner = new FakeRunner()
  const adapter = new DataLadAdapter({ runner })

  await assert.rejects(
    adapter.runCommand('createSubdataset', { projectPath: '/tmp/proj', relativePath: '../outside' }),
    /Invalid subdataset path/
  )

  assert.equal(runner.calls.length, 0)
})

test('createProject non-empty-directory error maps to FORCE_CREATE_FAILED when --force was used', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['create', '-c', 'text2git', '--force', '--', '/tmp/x'], {
    exitCode: 1,
    stdout: 'create(error): /tmp/x (dataset) [will not create a dataset in a non-empty directory, ' +
      'use `--force` option to ignore]\n',
    stderr: '',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createProject', {
    targetPath: '/tmp/x',
    procedure: 'text2git',
    force: true
  })

  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'FORCE_CREATE_FAILED')
})

test('detectProject flags isBids when dataset_description.json is present at the root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-bids-detect-'))
  await writeFile(join(root, 'dataset_description.json'), '{}')

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['-C', root, 'status', '--dataset', '.', '--json'], {
    exitCode: 1,
    stdout: '',
    stderr: 'NoDatasetFound: no dataset found at this location',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const project = await adapter.detectProject(root)

  assert.equal(project.isBids, true)
  assert.match(project.bidsReason, /dataset_description\.json/)
})

test('detectProject reports isBids false for a plain git project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-bids-absent-'))

  const runner = new FakeRunner()
  runner.set('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0,
    stdout: 'true\n',
    stderr: '',
    failed: false
  })
  runner.set('datalad', ['-C', root, 'status', '--dataset', '.', '--json'], {
    exitCode: 1,
    stdout: '',
    stderr: 'NoDatasetFound: no dataset found at this location',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const project = await adapter.detectProject(root)

  assert.equal(project.isBids, false)
  assert.equal(project.bidsReason, null)
})

test('inspectBidsCandidate reports high confidence when dataset_description.json exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-bids-candidate-'))
  await writeFile(join(root, 'dataset_description.json'), '{}')
  await mkdir(join(root, 'sub-01'))

  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const result = await adapter.inspectBidsCandidate(root)

  assert.equal(result.confidence, 'high')
  assert.equal(result.bidsLikely, true)
  assert.deepEqual(result.candidateSubpaths, ['sub-01'])
})

test('inspectBidsCandidate reports medium confidence from folder-name heuristics alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-bids-heuristic-'))
  await mkdir(join(root, 'rawdata'))
  await mkdir(join(root, 'derivatives'))
  await mkdir(join(root, 'sourcedata'))
  await mkdir(join(root, 'sub-02'))

  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const result = await adapter.inspectBidsCandidate(root)

  assert.equal(result.confidence, 'medium')
  assert.equal(result.bidsLikely, true)
  assert.deepEqual(new Set(result.candidateSubpaths), new Set(['sub-02', 'rawdata', 'derivatives', 'sourcedata']))
})

test('inspectBidsCandidate returns bidsLikely=false for a nonexistent folder without throwing', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const result = await adapter.inspectBidsCandidate('/tmp/this-folder-does-not-exist-dlad-test')

  assert.equal(result.bidsLikely, false)
  assert.equal(result.confidence, 'none')
  assert.deepEqual(result.candidateSubpaths, [])
})

test('ensureBidsMarker writes a placeholder dataset_description.json when none exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-bids-marker-'))
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })

  const result = await adapter.ensureBidsMarker(root)

  assert.equal(result.created, true)
  const written = JSON.parse(await readFile(join(root, 'dataset_description.json'), 'utf8'))
  assert.equal(written.Name, basename(root))
  assert.equal(written.BIDSVersion, '1.8.0')
})

test('ensureBidsMarker does not overwrite an existing dataset_description.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-bids-marker-existing-'))
  await writeFile(join(root, 'dataset_description.json'), '{"Name":"Original"}')
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })

  const result = await adapter.ensureBidsMarker(root)

  assert.equal(result.created, false)
  const content = await readFile(join(root, 'dataset_description.json'), 'utf8')
  assert.equal(content, '{"Name":"Original"}')
})

test('findUnnestedBidsCandidates returns un-registered sub-*/rawdata/derivatives/sourcedata folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-unnested-'))
  await mkdir(join(root, 'sub-01'))
  await mkdir(join(root, 'sub-02'))
  await mkdir(join(root, 'rawdata'))
  await mkdir(join(root, 'derivatives'))
  await mkdir(join(root, 'sourcedata'))
  await mkdir(join(root, 'code')) // not a BIDS-like name, should be ignored
  await writeFile(
    join(root, '.gitmodules'),
    '[submodule "sub-01"]\n\tpath = sub-01\n\turl = ./sub-01\n'
  )

  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const candidates = await adapter.findUnnestedBidsCandidates(root)

  assert.deepEqual(new Set(candidates), new Set(['sub-02', 'rawdata', 'derivatives', 'sourcedata']))
})

test('findUnnestedBidsCandidates returns an empty array once everything is nested', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dlad-fully-nested-'))
  await mkdir(join(root, 'sub-01'))
  await writeFile(
    join(root, '.gitmodules'),
    '[submodule "sub-01"]\n\tpath = sub-01\n\turl = ./sub-01\n'
  )

  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const candidates = await adapter.findUnnestedBidsCandidates(root)

  assert.deepEqual(candidates, [])
})

test('findUnnestedBidsCandidates returns an empty array for a nonexistent folder without throwing', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const candidates = await adapter.findUnnestedBidsCandidates('/tmp/this-folder-does-not-exist-dlad-test')

  assert.deepEqual(candidates, [])
})

test('untrackPath removes an already-tracked path from the parent index', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/proj', 'ls-files', '--', 'sub-01'], {
    exitCode: 0,
    stdout: 'sub-01/anat/sub-01_T1w.nii.gz\nsub-01/dwi/sub-01_dwi.json\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', '/tmp/proj', 'rm', '-r', '--cached', '--', 'sub-01'], {
    exitCode: 0,
    stdout: "rm 'sub-01/anat/sub-01_T1w.nii.gz'\n",
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', '/tmp/proj', 'commit', '-m', 'Untrack sub-01 for subdataset conversion'], {
    exitCode: 0,
    stdout: '',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.untrackPath('/tmp/proj', 'sub-01')

  assert.deepEqual(result, { removed: true })
  assert.equal(runner.calls.length, 3)
  // The commit call must NOT carry a pathspec: `git commit -- <pathspec>`
  // re-stages that path's current working-tree content before committing,
  // which undoes the --cached removal above (verified against real git —
  // it reports "nothing to commit" and leaves the removal uncommitted).
  assert.deepEqual(runner.calls[2].args, ['-C', '/tmp/proj', 'commit', '-m', 'Untrack sub-01 for subdataset conversion'])
})

test('untrackPath throws when the commit reports nothing to commit', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/proj', 'ls-files', '--', 'sub-01'], {
    exitCode: 0,
    stdout: 'sub-01/notes.txt\n',
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', '/tmp/proj', 'rm', '-r', '--cached', '--', 'sub-01'], {
    exitCode: 0,
    stdout: "rm 'sub-01/notes.txt'\n",
    stderr: '',
    failed: false
  })
  runner.set('git', ['-C', '/tmp/proj', 'commit', '-m', 'Untrack sub-01 for subdataset conversion'], {
    exitCode: 1,
    stdout: 'nothing to commit, working tree clean\n',
    stderr: '',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })

  await assert.rejects(adapter.untrackPath('/tmp/proj', 'sub-01'), /Could not commit untracking/)
})

test('untrackPath is a no-op when nothing is tracked at that path', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/proj', 'ls-files', '--', 'rawdata'], {
    exitCode: 0,
    stdout: '',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.untrackPath('/tmp/proj', 'rawdata')

  assert.deepEqual(result, { removed: false })
  assert.equal(runner.calls.length, 1)
})

test('untrackPath rejects a path-traversal relativePath', async () => {
  const runner = new FakeRunner()
  const adapter = new DataLadAdapter({ runner })

  await assert.rejects(adapter.untrackPath('/tmp/proj', '../outside'), /Invalid path/)
  assert.equal(runner.calls.length, 0)
})

test('createDataLadAdapter builds a usable adapter instance', () => {
  const adapter = createDataLadAdapter({ runner: new FakeRunner() })

  assert.ok(adapter instanceof DataLadAdapter)
  assert.equal(adapter.getInterfaceContract().version, '0.5.0')
})

test('runCommand routes createBranchAt to git checkout -b with a start point', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0, stdout: 'true\n', stderr: '', failed: false
  })
  runner.set('git', ['-C', '/tmp/project', 'checkout', '-b', 'restore/2024-01-15', 'abc1234'], {
    exitCode: 0,
    stdout: "Switched to a new branch 'restore/2024-01-15'\n",
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createBranchAt', {
    projectPath: '/tmp/project',
    branchName: 'restore/2024-01-15',
    startPoint: 'abc1234'
  })

  assert.equal(result.ok, true)
  const branchCall = runner.calls.find((c) => c.args.includes('checkout'))
  assert.deepEqual(branchCall.args, ['-C', '/tmp/project', 'checkout', '-b', 'restore/2024-01-15', 'abc1234'])
})

test('runCommand rejects createBranchAt with an invalid startPoint format', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0, stdout: 'true\n', stderr: '', failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  await assert.rejects(
    () => adapter.runCommand('createBranchAt', {
      projectPath: '/tmp/project',
      branchName: 'restore/test',
      startPoint: 'not-a-hash!'
    }),
    /invalid start point format/i
  )
})

test('getCommitDetails returns parsed metadata and stat for a valid commit', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0, stdout: 'true\n', stderr: '', failed: false
  })
  runner.set('git', [
    '-C', '/tmp/project',
    'log', '-1',
    '--format=%ct%x00%H%x00%an%x00%s%x00%B',
    'abc1234'
  ], {
    exitCode: 0,
    stdout: '1700000000\0abcdef1234567890\0Alice\0Add results\0Full body here\n',
    stderr: '',
    failed: false
  })
  runner.set('git', [
    '-C', '/tmp/project',
    'diff-tree', '--no-commit-id', '-r', '--stat', '--root',
    'abc1234'
  ], {
    exitCode: 0,
    stdout: ' results.csv | 5 +++++\n 1 file changed, 5 insertions(+)\n',
    stderr: '',
    failed: false
  })
  runner.set('git', [
    '-C', '/tmp/project',
    'diff-tree', '--no-commit-id', '-r', '--name-only', '--root',
    'abc1234'
  ], {
    exitCode: 0,
    stdout: 'results.csv\ndata/raw.tsv\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const details = await adapter.getCommitDetails('/tmp/project', 'abc1234')

  assert.equal(details.subject, 'Add results')
  assert.equal(details.author, 'Alice')
  assert.equal(details.timestamp, 1_700_000_000)
  assert.ok(details.stat.includes('results.csv'))
  assert.deepEqual(details.changedFiles, ['results.csv', 'data/raw.tsv'])
})

test('getCommitDetails rejects an invalid commit hash format', async () => {
  const runner = new FakeRunner()
  runner.set('git', ['-C', '/tmp/project', 'rev-parse', '--is-inside-work-tree'], {
    exitCode: 0, stdout: 'true\n', stderr: '', failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  await assert.rejects(
    () => adapter.getCommitDetails('/tmp/project', 'not!a!hash'),
    /invalid commit hash format/i
  )
})
test('runCommand routes restoreFileFromCommit to git restore with a source commit', async () => {
  const runner = new FakeRunner()
  runner.set('git', [
    '-C', '/tmp/project',
    'restore', '--source=abc1234', '--worktree',
    '--', 'results.csv', 'data/raw.tsv'
  ], {
    exitCode: 0, stdout: '', stderr: '', failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('restoreFileFromCommit', {
    projectPath: '/tmp/project',
    commitHash: 'abc1234',
    paths: ['results.csv', 'data/raw.tsv']
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, [
    '-C', '/tmp/project',
    'restore', '--source=abc1234', '--worktree',
    '--', 'results.csv', 'data/raw.tsv'
  ])
})

test('runCommand rejects restoreFileFromCommit with an invalid commit hash', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })

  await assert.rejects(
    () => adapter.runCommand('restoreFileFromCommit', {
      projectPath: '/tmp/project',
      commitHash: 'not-a-hash!',
      paths: ['results.csv']
    }),
    /invalid commit hash format/i
  )
})

test('runCommand rejects restoreFileFromCommit without paths', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })

  await assert.rejects(
    () => adapter.runCommand('restoreFileFromCommit', {
      projectPath: '/tmp/project',
      commitHash: 'abc1234',
      paths: []
    }),
    /paths must be a non-empty array/i
  )
})

test('runCommand maps restoreFileFromCommit pathspec failure to a friendly message', async () => {
  const runner = new FakeRunner()
  runner.set('git', [
    '-C', '/tmp/project',
    'restore', '--source=abc1234', '--worktree',
    '--', 'missing.csv'
  ], {
    exitCode: 1,
    stdout: '',
    stderr: "error: pathspec 'missing.csv' did not match any file(s) known to git\n",
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('restoreFileFromCommit', {
    projectPath: '/tmp/project',
    commitHash: 'abc1234',
    paths: ['missing.csv']
  })

  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'FILE_NOT_IN_SAVE_POINT')
})

test('runCommand maps restoreFileFromCommit unknown-revision failure to save-point-not-found', async () => {
  const runner = new FakeRunner()
  runner.set('git', [
    '-C', '/tmp/project',
    'restore', '--source=dead1234', '--worktree',
    '--', 'results.csv'
  ], {
    exitCode: 1,
    stdout: '',
    stderr: "fatal: could not resolve dead1234\n",
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('restoreFileFromCommit', {
    projectPath: '/tmp/project',
    commitHash: 'dead1234',
    paths: ['results.csv']
  })

  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'INVALID_START_POINT')
})

test('runCommand routes discardChanges to git restore from HEAD across index and worktree', async () => {
  const runner = new FakeRunner()
  runner.set('git', [
    '-C', '/tmp/project',
    'restore', '--source=HEAD', '--staged', '--worktree',
    '--', 'notes.txt'
  ], {
    exitCode: 0, stdout: '', stderr: '', failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('discardChanges', {
    projectPath: '/tmp/project',
    paths: ['notes.txt']
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, [
    '-C', '/tmp/project',
    'restore', '--source=HEAD', '--staged', '--worktree',
    '--', 'notes.txt'
  ])
})

test('runCommand rejects discardChanges without paths', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })

  await assert.rejects(
    () => adapter.runCommand('discardChanges', { projectPath: '/tmp/project' }),
    /missing required field paths/i
  )
})

test('runCommand maps discardChanges pathspec failure to never-saved message', async () => {
  const runner = new FakeRunner()
  runner.set('git', [
    '-C', '/tmp/project',
    'restore', '--source=HEAD', '--staged', '--worktree',
    '--', 'brand-new.txt'
  ], {
    exitCode: 1,
    stdout: '',
    stderr: "error: pathspec 'brand-new.txt' did not match any file(s) known to git\n",
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('discardChanges', {
    projectPath: '/tmp/project',
    paths: ['brand-new.txt']
  })

  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'FILE_NOT_TRACKED')
})

test('runCommand routes unlock to datalad unlock with explicit paths', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'unlock', '--', 'big-file.dat'], {
    exitCode: 0, stdout: 'unlock(ok): big-file.dat\n', stderr: '', failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('unlock', {
    projectPath: '/tmp/project',
    paths: ['big-file.dat']
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'unlock', '--', 'big-file.dat'])
})

test('runCommand rejects unlock without paths', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })

  await assert.rejects(
    () => adapter.runCommand('unlock', { projectPath: '/tmp/project' }),
    /missing required field paths/i
  )
})

test('runCommand maps unlock failure to content-not-local message when content is missing', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'unlock', '--', 'big-file.dat'], {
    exitCode: 1,
    stdout: 'unlock(error): big-file.dat (content not present)\n',
    stderr: '',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('unlock', {
    projectPath: '/tmp/project',
    paths: ['big-file.dat']
  })

  assert.equal(result.ok, false)
  assert.equal(result.userError.code, 'CONTENT_NOT_LOCAL')
})

test('setStudiesServerPassword/clearStudiesServerPassword delegate to the runner', () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })

  assert.equal(adapter.hasStudiesServerPassword(), false)
  adapter.setStudiesServerPassword('s3cret')
  assert.equal(adapter.hasStudiesServerPassword(), true)
  adapter.clearStudiesServerPassword()
  assert.equal(adapter.hasStudiesServerPassword(), false)
})

test('listRemoteStudies reports SERVER_NOT_CONFIGURED when host or path is missing', async () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })

  const result = await adapter.listRemoteStudies({ host: '', path: '' })

  assert.equal(result.ok, false)
  assert.deepEqual(result.studies, [])
  assert.equal(result.error.code, 'SERVER_NOT_CONFIGURED')
})

test('listRemoteStudies lists non-empty lines from the remote directory listing', async () => {
  const runner = new FakeRunner()
  runner.set('ssh', ['user@server.example.org', 'ls', '-1', '--', '/data/studies'], {
    exitCode: 0,
    stdout: 'study-a\nstudy-b\n\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.listRemoteStudies({ host: 'user@server.example.org', path: '/data/studies' })

  assert.equal(result.ok, true)
  assert.deepEqual(result.studies, ['study-a', 'study-b'])
})

test('listRemoteStudies reports REMOTE_LIST_FAILED when ssh fails', async () => {
  const runner = new FakeRunner()
  runner.set('ssh', ['user@server.example.org', 'ls', '-1', '--', '/data/studies'], {
    exitCode: 255,
    stdout: '',
    stderr: 'ssh: Could not resolve hostname server.example.org\n',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.listRemoteStudies({ host: 'user@server.example.org', path: '/data/studies' })

  assert.equal(result.ok, false)
  assert.equal(result.studies.length, 0)
  assert.equal(result.error.code, 'REMOTE_LIST_FAILED')
  assert.match(result.error.message, /Could not resolve hostname/)
})

test('listRemoteStudies (gitolite) runs `ssh <host> info` instead of `ls`, filters by prefix, and strips it', async () => {
  const runner = new FakeRunner()
  runner.set('ssh', ['git@server.example.org', 'info'], {
    exitCode: 0,
    stdout:
      'hello alice, this is git@server.example.org running gitolite3 v3.6.12 on git 2.34.1\n\n' +
      ' R W\tgitolite-admin\n' +
      ' R W\tmri-lab/MRI-Lab_Repository\n' +
      ' R  \tmri-lab/alice/study-a\n' +
      ' R W\tmri-lab/bob/study-b\n' +
      ' R  \tsome-other-team/unrelated-repo\n' +
      // A CREATOR wildcard rule shows up as one of "your" repos even before
      // anyone has created anything under it — confirmed against a real
      // gitolite deployment. Must be excluded, not listed as an installable
      // study.
      ' R   C\tmri-lab/CREATOR/[a-zA-Z0-9._-]+\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.listRemoteStudies({ host: 'git@server.example.org', path: 'mri-lab', type: 'gitolite' })

  assert.equal(result.ok, true)
  assert.deepEqual(new Set(result.studies), new Set(['MRI-Lab_Repository', 'alice/study-a', 'bob/study-b']))
})

test('listRemoteStudies (gitolite) reports REMOTE_LIST_FAILED when the gitolite info command fails', async () => {
  const runner = new FakeRunner()
  runner.set('ssh', ['git@server.example.org', 'info'], {
    exitCode: 255,
    stdout: '',
    stderr: 'ssh: Could not resolve hostname server.example.org\n',
    failed: true
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.listRemoteStudies({ host: 'git@server.example.org', path: 'mri-lab', type: 'gitolite' })

  assert.equal(result.ok, false)
  assert.equal(result.studies.length, 0)
  assert.equal(result.error.code, 'REMOTE_LIST_FAILED')
})

test('listRemoteStudies defaults to ssh-directory mode when type is omitted (backward compatible)', async () => {
  const runner = new FakeRunner()
  runner.set('ssh', ['user@server.example.org', 'ls', '-1', '--', '/data/studies'], {
    exitCode: 0,
    stdout: 'study-a\n',
    stderr: '',
    failed: false
  })

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.listRemoteStudies({ host: 'user@server.example.org', path: '/data/studies' })

  assert.equal(result.ok, true)
  assert.deepEqual(result.studies, ['study-a'])
})

test('runCommand routes createSibling through datalad create-sibling', async () => {
  const runner = new FakeRunner()
  runner.set(
    'datalad',
    ['-C', '/tmp/project', 'create-sibling', '-s', 'studies-server', '--', 'ssh://server.example.org/data/studies/my-study'],
    {
      exitCode: 0,
      stdout: '.: studies-server(ok) [ssh]\n',
      stderr: '',
      failed: false
    }
  )

  const adapter = new DataLadAdapter({ runner })
  const result = await adapter.runCommand('createSibling', {
    projectPath: '/tmp/project',
    siblingName: 'studies-server',
    sshUrl: 'ssh://server.example.org/data/studies/my-study'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(runner.calls[0].args, [
    '-C',
    '/tmp/project',
    'create-sibling',
    '-s',
    'studies-server',
    '--',
    'ssh://server.example.org/data/studies/my-study'
  ])
  assert.deepEqual(runner.calls[0].options, { cwd: '/tmp/project' })
})

test('runCommand rejects a createSibling siblingName that looks like a CLI flag', async () => {
  const runner = new FakeRunner()
  const adapter = new DataLadAdapter({ runner })

  await assert.rejects(
    adapter.runCommand('createSibling', {
      projectPath: '/tmp/project',
      siblingName: '--force',
      sshUrl: 'ssh://server.example.org/data/studies/my-study'
    }),
    /siblingName cannot start with -/
  )

  assert.equal(runner.calls.length, 0)
})
