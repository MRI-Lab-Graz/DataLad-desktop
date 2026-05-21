import test from 'node:test'
import assert from 'node:assert/strict'
import { DataLadAdapter } from '../src/datalad/adapter.js'
import { tryLoadRustAdapter } from '../src/datalad/rust-bridge.js'

const RUST_FLAG = 'DATALAD_DESKTOP_USE_RUST_ADAPTER'

function withRustFlag(value, fn) {
  const previous = process.env[RUST_FLAG]

  if (value === undefined) {
    delete process.env[RUST_FLAG]
  } else {
    process.env[RUST_FLAG] = value
  }

  const restore = () => {
    if (previous === undefined) {
      delete process.env[RUST_FLAG]
    } else {
      process.env[RUST_FLAG] = previous
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(restore)
}

function loadRustAdapterOrSkip(t) {
  const rustState = tryLoadRustAdapter()
  if (!rustState.enabled || !rustState.adapter) {
    t.skip(`Rust adapter unavailable: ${rustState.reason ?? 'unknown reason'}`)
    return null
  }

  return rustState.adapter
}

async function rejectedMessage(asyncCall) {
  try {
    await asyncCall()
    assert.fail('Expected async call to reject')
  } catch (error) {
    return String(error?.message ?? error)
  }
}

function thrownMessage(syncCall) {
  try {
    syncCall()
    assert.fail('Expected sync call to throw')
  } catch (error) {
    return String(error?.message ?? error)
  }
}

test('adapter parity: getInterfaceContract matches JS adapter', async (t) => {
  await withRustFlag('1', async () => {
    const jsAdapter = new DataLadAdapter()
    const rustAdapter = loadRustAdapterOrSkip(t)
    if (!rustAdapter) {
      return
    }

    const jsContract = jsAdapter.getInterfaceContract()
    const rustContract = rustAdapter.getInterfaceContract()

    assert.deepEqual(rustContract, jsContract)
  })
})

test('adapter parity: unsupported command errors are equivalent', async (t) => {
  await withRustFlag('1', async () => {
    const jsAdapter = new DataLadAdapter()
    const rustAdapter = loadRustAdapterOrSkip(t)
    if (!rustAdapter) {
      return
    }

    await assert.rejects(
      jsAdapter.runCommand('invalidCommand', {}),
      /Unsupported command: invalidCommand/
    )

    assert.throws(
      () => rustAdapter.runCommand('invalidCommand', {}),
      /Unsupported command: invalidCommand/
    )
  })
})

test('adapter parity: request validation failures are equivalent', async (t) => {
  await withRustFlag('1', async () => {
    const jsAdapter = new DataLadAdapter()
    const rustAdapter = loadRustAdapterOrSkip(t)
    if (!rustAdapter) {
      return
    }

    await assert.rejects(
      jsAdapter.runCommand('save', {
        projectPath: '/tmp/project',
        message: 'message',
        paths: 'not-an-array'
      }),
      /paths must be an array/
    )

    assert.throws(
      () => rustAdapter.runCommand('save', {
        projectPath: '/tmp/project',
        message: 'message',
        paths: 'not-an-array'
      }),
      /paths must be an array/
    )

    const jsMessage = await rejectedMessage(() =>
      jsAdapter.runCommand('save', {
        projectPath: '/tmp/project'
      })
    )

    const rustMessage = thrownMessage(() =>
      rustAdapter.runCommand('save', {
        projectPath: '/tmp/project'
      })
    )

    assert.equal(rustMessage, jsMessage)
  })
})

test('adapter parity: checkEnvironment status and issue codes match', async (t) => {
  await withRustFlag('1', async () => {
    const jsAdapter = new DataLadAdapter()
    const rustAdapter = loadRustAdapterOrSkip(t)
    if (!rustAdapter) {
      return
    }

    const jsDiagnostics = await jsAdapter.checkEnvironment()
    const rustDiagnostics = rustAdapter.checkEnvironment()

    assert.equal(rustDiagnostics.supported, jsDiagnostics.supported)
    assert.equal(rustDiagnostics.report?.severity, jsDiagnostics.report?.severity)
    assert.equal(rustDiagnostics.report?.headline, jsDiagnostics.report?.headline)
    assert.equal(rustDiagnostics.report?.summary, jsDiagnostics.report?.summary)

    const jsIssueCodes = (jsDiagnostics.issues ?? []).map((issue) => issue.code).sort()
    const rustIssueCodes = (rustDiagnostics.issues ?? []).map((issue) => issue.code).sort()

    const jsChecks = (jsDiagnostics.report?.checks ?? []).map((check) => ({
      tool: check.tool,
      label: check.label,
      status: check.status,
      version: check.version,
      details: check.details
    }))
    const rustChecks = (rustDiagnostics.report?.checks ?? []).map((check) => ({
      tool: check.tool,
      label: check.label,
      status: check.status,
      version: check.version,
      details: check.details
    }))

    const jsRecoverySteps = jsDiagnostics.report?.recoverySteps ?? []
    const rustRecoverySteps = rustDiagnostics.report?.recoverySteps ?? []

    assert.deepEqual(rustIssueCodes, jsIssueCodes)
    assert.deepEqual(rustChecks, jsChecks)
    assert.deepEqual(rustRecoverySteps, jsRecoverySteps)
  })
})
