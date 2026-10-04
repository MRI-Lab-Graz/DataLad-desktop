import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTrustGate, describeTrustPrompt, isEmptyOrMissing } from '../src/gui/trust-gate.js'
import { createTrustStore } from '../src/gui/trust-store.js'

const fakeStore = ({ covers = false, trusted = false } = {}) => {
  const calls = []
  return { calls, covers: () => covers, decide: (path, vectors) => (calls.push(['decide', path, vectors]), { trusted }), trust: (path, record) => calls.push(['trust', path, record]) }
}
const harness = (store, answer = 'folder', vectors = ['config a = 1']) => {
  const log = { scan: [], ask: [], authorize: [] }
  const gate = createTrustGate({
    store,
    scan: async (path, kind) => (log.scan.push([path, kind]), vectors),
    ask: async (info) => (log.ask.push(info), answer),
    authorize: (path) => log.authorize.push(path)
  })
  return { gate, log }
}

test('a path covered by a tree record or an admin root is authorized without scanning or asking', async () => {
  const { gate, log } = harness(fakeStore({ covers: true }))
  await gate.require('/p')
  assert.deepEqual(log, { scan: [], ask: [], authorize: ['/p'] })
})

test('a folder trusted for what the scan found is authorized without asking', async () => {
  const { gate, log } = harness(fakeStore({ trusted: true }))
  await gate.require('/p')
  assert.equal(log.scan.length, 1)
  assert.deepEqual(log.ask, [])
  assert.deepEqual(log.authorize, ['/p'])
})

test('an untrusted folder is scanned, asked about with the findings, recorded, then authorized', async () => {
  const store = fakeStore()
  const { gate, log } = harness(store, 'folder')
  await gate.require('/p', { event: 'E' })
  assert.deepEqual(log.ask, [{ path: '/p', kind: 'folder', vectors: ['config a = 1'], event: 'E' }])
  assert.deepEqual(store.calls.at(-1), ['trust', '/p', { scope: 'folder', vectors: ['config a = 1'] }])
  assert.deepEqual(log.authorize, ['/p'])
})

test('"trust everything inside" is recorded with tree scope', async () => {
  const store = fakeStore()
  const { gate } = harness(store, 'tree')
  await gate.require('/p')
  assert.deepEqual(store.calls.at(-1), ['trust', '/p', { scope: 'tree', vectors: ['config a = 1'] }])
})

test('declining records nothing, authorizes nothing and throws', async () => {
  for (const answer of ['cancel', null, 'yes']) { // (undefined would take the harness default)
    const store = fakeStore()
    const { gate, log } = harness(store, answer)
    await assert.rejects(gate.require('/p'), /Folder not opened: it was not trusted\./)
    assert.deepEqual(log.authorize, [])
    assert.ok(!store.calls.some(([kind]) => kind === 'trust'))
  }
})

test('a remote is asked about and recorded, but never authorized as a project root', async () => {
  const store = fakeStore()
  const { gate, log } = harness(store, 'folder', [])
  await gate.require('/share/ds', { kind: 'remote' })
  assert.deepEqual(log.scan, [['/share/ds', 'remote']])
  assert.equal(log.ask[0].kind, 'remote')
  assert.deepEqual(log.authorize, [])
  const declined = harness(fakeStore(), 'cancel', [])
  await assert.rejects(declined.gate.require('/share/ds', { kind: 'remote' }), /Not pushed: the remote folder was not trusted\./)
})

test('anything but a non-empty string is refused', async () => {
  const { gate } = harness(fakeStore())
  for (const bad of [undefined, null, '', '  ', ['/p'], { a: 1 }, 7]) {
    await assert.rejects(gate.require(bad), /Choose a folder first\./)
  }
})

test('a project the app created is recorded as trusted and authorized', () => {
  const store = fakeStore()
  const { gate, log } = harness(store)
  gate.createdByApp('/new')
  assert.deepEqual(store.calls, [['trust', '/new', { scope: 'folder', vectors: [] }]])
  assert.deepEqual(log.authorize, ['/new'])
})

test('with the real store, the second open of a trusted folder does not ask', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gate-'))
  const dir = join(base, 'ds')
  await mkdir(dir)
  const { gate, log } = harness(createTrustStore({ file: join(base, 'trusted.json') }), 'folder', [])
  await gate.require(dir)
  await gate.require(dir)
  assert.equal(log.ask.length, 1)
  assert.equal(log.authorize.length, 2)
})

test('isEmptyOrMissing: missing and empty are true, a folder with entries and a file are false', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gate-'))
  assert.equal(await isEmptyOrMissing(join(base, 'nope')), true)
  const empty = join(base, 'empty')
  await mkdir(empty)
  assert.equal(await isEmptyOrMissing(empty), true)
  assert.equal(await isEmptyOrMissing(base), false) // it now has an entry
  await writeFile(join(empty, 'f'), 'x')
  assert.equal(await isEmptyOrMissing(empty), false)
  assert.equal(await isEmptyOrMissing(join(empty, 'f')), false)
})

test('the prompt names the path, lists the findings or says nothing was found, and has the three buttons', () => {
  const found = describeTrustPrompt({ path: '/p', kind: 'folder', vectors: ['config core.sshcommand = evil'] })
  assert.deepEqual(found.buttons, ['Cancel', 'Trust this folder', 'Trust everything inside this folder'])
  assert.match(found.detail, /\/p/)
  assert.match(found.detail, /core\.sshcommand = evil/)
  const clean = describeTrustPrompt({ path: '/p', kind: 'folder', vectors: [] })
  assert.match(clean.detail, /cannot prove a folder is safe/)
  const remote = describeTrustPrompt({ path: '/share/ds', kind: 'remote', vectors: [] })
  assert.match(remote.message, /Pushing to this folder runs programs stored in it/)
})
