import test from 'node:test'
import assert from 'node:assert/strict'
import { getGitIdentity, setGitIdentity } from '../src/datalad/git-identity.js'

// Fake runner: answers `git config --global --get <key>` from a map, records every call.
function fakeRunner(config = {}, { gitMissing = false, setFails = false } = {}) {
  const calls = []
  const run = async (command, args) => {
    calls.push([command, ...args])
    if (gitMissing) {
      return { failed: true, exitCode: null, stdout: '', stderr: 'spawn git ENOENT', error: { code: 'ENOENT' } }
    }
    if (args.includes('--get')) {
      const key = args.at(-1)
      return key in config
        ? { failed: false, exitCode: 0, stdout: `${config[key]}\n`, stderr: '' }
        : { failed: true, exitCode: 1, stdout: '', stderr: '' }
    }
    return setFails
      ? { failed: true, exitCode: 255, stdout: '', stderr: 'error: could not lock config file' }
      : { failed: false, exitCode: 0, stdout: '', stderr: '' }
  }
  return { run, calls }
}

test('getGitIdentity reads name and email from the global config', async () => {
  const { run, calls } = fakeRunner({ 'user.name': 'Jane Doe', 'user.email': 'jane@lab.org' })
  assert.deepEqual(await getGitIdentity(run), {
    available: true,
    name: 'Jane Doe',
    email: 'jane@lab.org',
    complete: true
  })
  assert.deepEqual(calls[0], ['git', 'config', '--global', '--get', 'user.name'])
})

test('getGitIdentity treats an unset key as empty, not an error', async () => {
  const { run } = fakeRunner({ 'user.name': 'Jane Doe' })
  assert.deepEqual(await getGitIdentity(run), { available: true, name: 'Jane Doe', email: '', complete: false })
})

test('getGitIdentity reports git as unavailable when it cannot be spawned', async () => {
  const { run } = fakeRunner({}, { gitMissing: true })
  assert.deepEqual(await getGitIdentity(run), { available: false, name: '', email: '', complete: false })
})

test('setGitIdentity writes trimmed name and email with two argument-array calls', async () => {
  const { run, calls } = fakeRunner()
  const result = await setGitIdentity(run, { name: '  Jane Doe ', email: ' jane@lab.org ' })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.slice(0, 2), [
    ['git', 'config', '--global', 'user.name', 'Jane Doe'],
    ['git', 'config', '--global', 'user.email', 'jane@lab.org']
  ])
})

for (const [label, identity, message] of [
  ['an empty name', { name: '  ', email: 'a@b.co' }, /name/i],
  ['a name starting with a dash', { name: '-x', email: 'a@b.co' }, /name/i],
  ['a name with control characters', { name: 'Ja\nne', email: 'a@b.co' }, /name/i],
  ['an over-long name', { name: 'x'.repeat(201), email: 'a@b.co' }, /name/i],
  ['an email without @', { name: 'Jane', email: 'jane.lab.org' }, /email/i],
  ['an email without a dot domain', { name: 'Jane', email: 'jane@lab' }, /email/i],
  ['an email starting with a dash', { name: 'Jane', email: '-a@b.co' }, /email/i],
  ['an email with whitespace inside', { name: 'Jane', email: 'ja ne@b.co' }, /email/i]
]) {
  test(`setGitIdentity rejects ${label} without running git`, async () => {
    const { run, calls } = fakeRunner()
    const result = await setGitIdentity(run, identity)
    assert.equal(result.ok, false)
    assert.match(result.error, message)
    assert.equal(calls.length, 0)
  })
}

test('setGitIdentity accepts unicode and apostrophes in names', async () => {
  const { run } = fakeRunner()
  assert.equal((await setGitIdentity(run, { name: "Zoë O'Neil", email: 'z@lab.org' })).ok, true)
})

test('setGitIdentity surfaces a git failure as ok:false with a message', async () => {
  const { run } = fakeRunner({}, { setFails: true })
  const result = await setGitIdentity(run, { name: 'Jane', email: 'j@lab.org' })
  assert.equal(result.ok, false)
  assert.match(result.error, /could not lock/)
})

test('setGitIdentity returns the identity as read back from git', async () => {
  const { run } = fakeRunner({ 'user.name': 'Jane', 'user.email': 'j@lab.org' })
  const result = await setGitIdentity(run, { name: 'Jane', email: 'j@lab.org' })
  assert.equal(result.identity.complete, true)
})
