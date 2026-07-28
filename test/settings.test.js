import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, createSettingsStore, loadLocalDefaultOverrides } from '../src/gui/settings.js'

// createSettingsStore() picks up config/studies-server.local.json for its
// defaults, which is deployment-specific (untracked) and may or may not exist
// on the machine running the tests — so these tests construct SettingsStore
// directly with an explicit defaultStudiesServer instead, keeping behavior
// deterministic regardless of local deployment config.
async function makeStore(defaultStudiesServer = { host: '', path: '' }) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'datalad-desktop-settings-'))
  return new SettingsStore({ filePath: join(userDataPath, 'settings.json'), defaultStudiesServer })
}

test('get returns defaults when no settings file exists yet', async () => {
  const store = await makeStore()
  const settings = await store.get()

  assert.deepEqual(settings, { studiesServer: { host: '', path: '' } })
})

test('loadLocalDefaultOverrides reads host/path from the override file when present', async () => {
  const overrideDir = await mkdtemp(join(tmpdir(), 'datalad-desktop-override-'))
  const overridePath = join(overrideDir, 'studies-server.local.json')
  await writeFile(overridePath, JSON.stringify({ host: 'user@server.example.org', path: '/data/studies' }), 'utf8')

  assert.deepEqual(loadLocalDefaultOverrides(overridePath), {
    host: 'user@server.example.org',
    path: '/data/studies'
  })
})

test('loadLocalDefaultOverrides returns empty host/path when the override file is missing', () => {
  assert.deepEqual(loadLocalDefaultOverrides('/nonexistent/studies-server.local.json'), { host: '', path: '' })
})

// Doesn't assert an exact host/path here since createSettingsStore's defaults
// come from this checkout's (untracked, deployment-specific) local override
// file, which may or may not be present — just that it wires up correctly.
test('createSettingsStore persists and returns updates regardless of local override defaults', async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'datalad-desktop-settings-'))
  const store = createSettingsStore(userDataPath)

  const updated = await store.update({ studiesServer: { host: 'user@server.example.org', path: '/data/studies' } })
  assert.deepEqual(updated, { studiesServer: { host: 'user@server.example.org', path: '/data/studies' } })
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
