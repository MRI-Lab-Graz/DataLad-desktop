import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsStore } from '../src/gui/settings.js'

async function makeStore() {
  const userDataPath = await mkdtemp(join(tmpdir(), 'datalad-desktop-settings-'))
  return createSettingsStore(userDataPath)
}

test('get returns defaults when no settings file exists yet', async () => {
  const store = await makeStore()
  const settings = await store.get()

  assert.deepEqual(settings, { studiesServer: { host: '', path: '' } })
})

test('update persists values and get returns them back', async () => {
  const store = await makeStore()

  const updated = await store.update({ studiesServer: { host: 'user@server.example.org', path: '/data/studies' } })
  assert.deepEqual(updated, { studiesServer: { host: 'user@server.example.org', path: '/data/studies' } })

  const fetched = await store.get()
  assert.deepEqual(fetched, { studiesServer: { host: 'user@server.example.org', path: '/data/studies' } })
})

test('update merges partial fields onto existing settings', async () => {
  const store = await makeStore()

  await store.update({ studiesServer: { host: 'user@server.example.org', path: '/data/studies' } })
  const merged = await store.update({ studiesServer: { path: '/data/other-studies' } })

  assert.deepEqual(merged, { studiesServer: { host: 'user@server.example.org', path: '/data/other-studies' } })
})
