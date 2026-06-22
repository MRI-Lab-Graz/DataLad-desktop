import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  runner.set('datalad', ['-C', '/tmp/project', 'save', '-m', 'checkpoint', '--', 'results.csv'], {
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
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'save', '-m', 'checkpoint', '--', 'results.csv'])
  assert.deepEqual(result.warnings, [])
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
  runner.set('datalad', ['clone', '--', 'https://example.org/ds.git', '/tmp/ds'], {
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
  assert.equal(health.annexSupported, true)
  assert.equal(health.missingContentCount, 2)
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

  assert.equal(contract.version, '0.4.0')
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

test('runCommand adds a generic advisory when clone stderr has output that matches no known pattern', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['clone', '--', 'https://example.org/ds.git', '/tmp/ds'], {
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

  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].code, 'CLONE_STDERR_OUTPUT')
})

test('createDataLadAdapter builds a usable adapter instance', () => {
  const adapter = createDataLadAdapter({ runner: new FakeRunner() })

  assert.ok(adapter instanceof DataLadAdapter)
  assert.equal(adapter.getInterfaceContract().version, '0.4.0')
})