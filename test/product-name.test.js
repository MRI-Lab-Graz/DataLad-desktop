import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// The app is an independent project, not DataLad's own: its name, icon and settings must not pose as theirs.
// The GitHub repo is now MRI-Lab-Graz/Worldline-desktop, so its old slug is no longer allowed anywhere.
// Docs live at worldline-desktop.readthedocs.io; the old Read the Docs slug is no longer allowed.
// appId (org.datalad.desktop) waits for the owner's admin to confirm a namespace we control.
// (Regexes in other tests write the slug with escaped slashes and dots, hence the optional backslashes.)
const ALLOWED = [
  /software-DataLad-desktop/g, // a local path inside a generated requirements comment
  /org\.datalad\.desktop/g
]
const OLD_NAME = /datalad[ _-]?desktop|dataladDesktop/i
// SECURITY.md must name the old settings once, to tell administrators they are no longer read.
const LEGACY_NOTE = /Renamed settings/
const HISTORY = [/^docs\/superpowers\//, /^CHANGELOG\.md$/, /^package-lock\.json$/, /^deno\.lock$/, /^test\/product-name\.test\.js$/, /^\.claude\//]

function trackedTextFiles() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((f) => f && !HISTORY.some((h) => h.test(f)) && !/\.(png|ico|icns|svg|jpg|woff2?)$/.test(f))
}

test('the product is called Worldline Desktop', () => {
  assert.equal(pkg.name, 'worldline-desktop')
  assert.equal(pkg.build.productName, 'Worldline Desktop')
})

test('no file outside the history uses the old DataLad Desktop name', () => {
  const hits = []
  for (const file of trackedTextFiles()) {
    if (!existsSync(join(root, file))) continue
    let text = readFileSync(join(root, file), 'utf8')
    for (const ok of ALLOWED) text = text.replace(ok, '')
    text.split('\n').forEach((line, i) => { if (OLD_NAME.test(line) && !LEGACY_NOTE.test(line)) hits.push(`${file}:${i + 1}`) })
  }
  assert.deepEqual(hits, [])
})

test('the app icon is our own and is referenced under the new name', () => {
  for (const ext of ['png', 'ico', 'icns']) assert.ok(existsSync(join(root, `src/gui/assets/icons/worldline_desktop.${ext}`)), ext)
  assert.ok(existsSync(join(root, 'src/gui/assets/icons/worldline_desktop_macos.png')))
  assert.ok(!existsSync(join(root, 'src/gui/assets/icons/datalad_desktop.png')), 'the old DataLad-style icon must be gone')
})

test('the README says the project is independent of DataLad', () => {
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /not affiliated with or endorsed by the DataLad project/i)
})

test('the Setup screen says the app is independent of DataLad', () => {
  assert.match(readFileSync(join(root, 'src/gui/renderer/index.html'), 'utf8'), /not affiliated with or endorsed by the DataLad project/i)
})

// The header logo is an endless animation: people who asked their system for less motion get the still icon.
test('the header shows the animated logo, with the still icon for "reduce motion"', () => {
  const html = readFileSync(join(root, 'src/gui/renderer/index.html'), 'utf8')
  assert.ok(existsSync(join(root, 'src/gui/assets/icons/worldline_desktop_streams.gif')))
  assert.match(html, /<picture>\s*<source media="\(prefers-reduced-motion: reduce\)" srcset="\.\.\/assets\/icons\/worldline_desktop\.png"\s*\/?>\s*<img src="\.\.\/assets\/icons\/worldline_desktop_streams\.gif" alt="Worldline Desktop logo" class="hero-logo"\s*\/>\s*<\/picture>/)
})
