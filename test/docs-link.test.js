import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const html = await readFile(new URL('../src/gui/renderer/index.html', import.meta.url), 'utf8')

test('the header links to the Read the Docs tutorials, opened outside the app', () => {
  const link = /<a\b[^>]*id="open-docs"[^>]*>/.exec(html)?.[0] ?? ''
  assert.match(link, /href="https:\/\/worldline-desktop\.readthedocs\.io\/"/)
  assert.match(link, /target="_blank"/)
})

const settingsCard = /<section id="settings-card"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
const hero = /<header[^>]*class="hero[\s\S]*?<\/header>/.exec(html)?.[0] ?? ''

test('the Docs link has an icon and shares a row with Setup', () => {
  assert.match(/<a\b[^>]*id="open-docs"[\s\S]*?<\/a>/.exec(html)?.[0] ?? '', /aria-hidden="true"/)
  assert.match(hero, /class="hero-actions"[^>]*>\s*<button\s+id="switch-project"[\s\S]*?<button\s+id="open-settings"[\s\S]*?id="open-docs"/)
})

test('Auto-nest BIDS lives in Setup, not the header', () => {
  for (const id of ['bids-auto-nest-toggle']) {
    assert.ok(settingsCard.includes(`id="${id}"`), `${id} in Setup`)
    assert.ok(!hero.includes(`id="${id}"`), `${id} not in header`)
  }
})

test('Auto-nest BIDS explains itself in plain words, linked to the switch', () => {
  assert.match(settingsCard, /id="bids-auto-nest-toggle"[^>]*aria-describedby="bids-auto-nest-help"/)
  const help = settingsCard.match(/<div id="bids-auto-nest-help"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''
  for (const part of ['sub-', 'rawdata', 'derivatives', 'sourcedata', 'saves', 'Convert to subdataset', 'this computer']) {
    assert.ok(help.includes(part), `help mentions ${part}`)
  }
  assert.ok(!/subdatasets?\b(?! )/i.test(help.replace(/Convert to subdataset/g, '')), 'no unexplained jargon: say "nested dataset"')
})
