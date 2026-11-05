import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { checkPins, parsePins } from '../scripts/check-install-pins.mjs'

const sha = (text) => createHash('sha256').update(text).digest('hex').toUpperCase()
const MIRROR = 'https://mirror.example/windows/'
const pins = {
  gitAnnex: { version: '10.20260901', sha256: sha('annex'), url: `${MIRROR}git-annex-installer_10.20260901_x64.exe`, fallbackUrl: 'https://github.example/git-annex-installer_10.20260901_x64.exe' },
  git: { url: 'https://github.example/Git-64-bit.exe', sha256: sha('git') }
}
const listing = (...versions) => versions.map((v) => `<a href="git-annex-installer_${v}_x64.exe">x</a>`).join('\n')
// Stands in for fetch(): a map of url -> body, the mirror directory page, and 404 for anything else.
const fakeFetch = (files, page) => async (url) => {
  if (url === MIRROR) return { ok: true, status: 200, text: async () => page }
  return url in files
    ? { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(files[url]).buffer }
    : { ok: false, status: 404 }
}
const files = { [pins.gitAnnex.url]: 'annex', [pins.gitAnnex.fallbackUrl]: 'annex', [pins.git.url]: 'git' }

test('parsePins reads the pins from windows-install.cmd, the only place they are written', async () => {
  const parsed = parsePins(await readFile(new URL('../scripts/windows/windows-install.cmd', import.meta.url), 'utf8'))
  assert.equal(parsed.gitAnnex.version, '10.20260901')
  assert.equal(parsed.gitAnnex.url, 'https://datasets.datalad.org/datalad/packages/windows/git-annex-installer_10.20260901_x64.exe')
  assert.match(parsed.gitAnnex.sha256, /^[0-9A-F]{64}$/)
  assert.match(parsed.git.url, /^https:\/\/github\.com\/git-for-windows\/git\/releases\/download\//)
  assert.match(parsed.git.sha256, /^[0-9A-F]{64}$/)
})

test('matching hashes pass and report nothing newer', async () => {
  const result = await checkPins({ fetchImpl: fakeFetch(files, listing('10.20260901')), pins })
  assert.deepEqual(result, { ok: true, problems: [], newerGitAnnex: null })
})

test('a changed git-annex file fails and names the pin', async () => {
  const result = await checkPins({ fetchImpl: fakeFetch({ ...files, [pins.gitAnnex.url]: 'swapped' }, listing('10.20260901')), pins })
  assert.equal(result.ok, false)
  assert.match(result.problems[0], /git-annex 10\.20260901.*SHA-256/)
})

test('a changed Git installer fails and names it', async () => {
  const result = await checkPins({ fetchImpl: fakeFetch({ ...files, [pins.git.url]: 'swapped' }, listing('10.20260901')), pins })
  assert.equal(result.ok, false)
  assert.match(result.problems.join('\n'), /Git for Windows.*SHA-256/)
})

test('a newer git-annex on the mirror is reported without failing; snapshots and older versions are ignored', async () => {
  const page = listing('10.20260525', '10.20260901', '10.20260920') + '<a href="git-annex-installer_latest-snapshot_x64.exe">x</a>'
  const result = await checkPins({ fetchImpl: fakeFetch(files, page), pins })
  assert.equal(result.ok, true)
  assert.equal(result.newerGitAnnex, '10.20260920')
})

test('versions compare as numbers, so 10.20260901 is newer than 9.20269999', async () => {
  const result = await checkPins({ fetchImpl: fakeFetch(files, listing('9.20269999', '10.20260901')), pins })
  assert.equal(result.newerGitAnnex, null)
})

test('a file that cannot be fetched is a problem, not a crash', async () => {
  const result = await checkPins({ fetchImpl: fakeFetch({ [pins.git.url]: 'git' }, listing('10.20260901')), pins })
  assert.equal(result.ok, false)
  assert.match(result.problems[0], /git-annex 10\.20260901.*HTTP 404/)
})

test('a download that drops once is retried; a changed file is never retried into a pass', async () => {
  let failures = 1
  const flaky = (inner) => async (url) => { if (url === pins.gitAnnex.url && failures-- > 0) throw new TypeError('fetch failed'); return inner(url) }
  const ok = await checkPins({ fetchImpl: flaky(fakeFetch(files, listing('10.20260901'))), pins, retryDelayMs: 0 })
  assert.equal(ok.ok, true)

  failures = 0
  const swapped = await checkPins({ fetchImpl: fakeFetch({ ...files, [pins.gitAnnex.url]: 'swapped' }, listing('10.20260901')), pins, retryDelayMs: 0 })
  assert.equal(swapped.ok, false)

  failures = 99
  const down = await checkPins({ fetchImpl: flaky(fakeFetch(files, listing('10.20260901'))), pins, retryDelayMs: 0 })
  assert.equal(down.ok, false)
  assert.match(down.problems[0], /could not fetch/)
})

test('the GitHub fallback must match the pin too, so a swapped fallback fails the check', async () => {
  const result = await checkPins({ fetchImpl: fakeFetch({ ...files, [pins.gitAnnex.fallbackUrl]: 'swapped' }, listing('10.20260901')), pins, retryDelayMs: 0 })
  assert.equal(result.ok, false)
  assert.match(result.problems[0], /git-annex 10\.20260901 \(fallback\).*SHA-256/)
})

test('parsePins reads the fallback URL', async () => {
  const parsed = parsePins(await readFile(new URL('../scripts/windows/windows-install.cmd', import.meta.url), 'utf8'))
  assert.equal(parsed.gitAnnex.fallbackUrl, 'https://github.com/con/git-annex/releases/download/10.20260901/git-annex-installer_10.20260901_x64.exe')
})
