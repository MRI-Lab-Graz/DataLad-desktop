import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../src/gui/${p}`, import.meta.url), 'utf8')

// Users need to see which build they run (e.g. "is this 0.5.1?"): header and Setup tab both show app.getVersion().
test('main answers app:version with the packaged app version', () => {
  assert.match(read('main.js'), /handle\('app:version',\s*\(\)\s*=>\s*app\.getVersion\(\)\)/)
})

test('preload exposes getAppVersion', () => {
  assert.match(read('preload.js'), /getAppVersion:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('app:version'\)/)
})

test('header and Setup tab each have a version slot, filled by the renderer', () => {
  const html = read('renderer/index.html')
  assert.equal(html.split('data-app-version').length - 1, 2)
  assert.match(read('renderer/app.js'), /api\.getAppVersion\(\)[\s\S]{0,200}\[data-app-version\]/)
})
