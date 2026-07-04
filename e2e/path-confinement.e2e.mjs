// Real-Electron regression test for the authorizedRoots confinement gap
// found in a pre-release audit: several adapter:* and watch:* IPC handlers
// took a renderer-supplied path but never checked it against the roots the
// user actually authorized (opened project / picked folder / clone target).
// A compromised or buggy renderer could otherwise read or write files
// (e.g. adapter:addIgnorePatterns writes <path>/.gitignore) anywhere on
// disk. Not picked up by `npm test` (node's default test-file pattern
// requires ".test." in the name) — run explicitly via `npm run test:e2e`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchApp } from './electron-driver.mjs'
import { createTempRoot, createPlainGitRepo } from './fixtures.mjs'

let app
let root
let authorizedProjectPath
let unauthorizedPath

test.before(async () => {
  root = await createTempRoot()
  authorizedProjectPath = await createPlainGitRepo(root)
  // A real git repo the renderer never opened through the app — it must
  // still be rejected even though it would otherwise be a perfectly valid
  // target for these adapter calls.
  unauthorizedPath = await createPlainGitRepo(root)
  app = await launchApp()
  await app.openProject(authorizedProjectPath)
})

test.after(async () => {
  await app?.close()
})

async function invokeRejects(channelCall, ...args) {
  return app.page.evaluate(
    async ({ channelCall: call, args: callArgs }) => {
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('api', 'args', `return api.${call}(...args)`)
        await fn(window.dataladDesktop, callArgs)
        return { rejected: false }
      } catch (error) {
        return { rejected: true, message: String(error?.message ?? error) }
      }
    },
    { channelCall, args }
  )
}

// Args are built lazily (functions, not plain arrays) because
// unauthorizedPath/authorizedProjectPath aren't assigned until test.before
// runs, which happens after this module's top-level code — capturing them
// eagerly here would silently test against `undefined` instead.
const confinedCalls = [
  ['listBranches', () => [unauthorizedPath]],
  ['getLastCommit', () => [unauthorizedPath]],
  ['getWorkingTreeStatus', () => [unauthorizedPath]],
  ['listRecentCommits', () => [unauthorizedPath, {}]],
  ['getCommitDetails', () => [unauthorizedPath, 'HEAD']],
  ['getProjectHealth', () => [unauthorizedPath]],
  ['readGitignore', () => [unauthorizedPath, '']],
  ['addIgnorePatterns', () => [unauthorizedPath, [''], ['*.tmp']]],
  ['setWatchedProject', () => [unauthorizedPath]],
  ['clearRepositoryLock', () => [unauthorizedPath]]
]

for (const [name, buildArgs] of confinedCalls) {
  test(`${name} rejects a path outside the authorized project roots`, async () => {
    const result = await invokeRejects(name, ...buildArgs())
    assert.equal(result.rejected, true, `${name} should reject an unauthorized path`)
    assert.match(result.message, /not part of an opened project/)
  })
}

test('listBranches still succeeds for the authorized project path', async () => {
  const result = await invokeRejects('listBranches', authorizedProjectPath)
  assert.equal(result.rejected, false, 'authorized path should not be rejected')
})
