import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DataLadAdapter } from '../src/datalad/adapter.js'

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

test('runCommand routes save through curated datalad invocation', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['-C', '/tmp/project', 'save', '-m', 'checkpoint', 'results.csv'], {
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
  assert.deepEqual(runner.calls[0].args, ['-C', '/tmp/project', 'save', '-m', 'checkpoint', 'results.csv'])
  assert.deepEqual(result.warnings, [])
})

test('runCommand returns non-fatal clone advisories from stderr output', async () => {
  const runner = new FakeRunner()
  runner.set('datalad', ['clone', 'https://example.org/ds.git', '/tmp/ds'], {
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

test('getInterfaceContract returns stable schema metadata', () => {
  const adapter = new DataLadAdapter({ runner: new FakeRunner() })
  const contract = adapter.getInterfaceContract()

  assert.equal(contract.version, '0.3.0')
  assert.deepEqual(contract.classificationValues, ['git', 'dataset', 'superdataset'])
  assert.deepEqual(contract.commands.save.required, ['projectPath', 'message'])
})