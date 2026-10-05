import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// The Git and git-annex pins live in scripts/windows/install.ps1 and nowhere else. This reads them back and asks the
// hosts whether the pinned files are still what the pins say, and whether the git-annex mirror has a newer version.
const sha256 = (buffer) => createHash('sha256').update(Buffer.from(buffer)).digest('hex').toUpperCase()

export function parsePins(ps1) {
  const value = (name) => {
    const m = ps1.match(new RegExp(`^\\$${name} = '([^']+)'`, 'm'))
    if (!m) throw new Error(`install.ps1 has no $${name} pin`)
    return m[1]
  }
  const version = value('GitAnnexVersion')
  const urlLine = ps1.match(/^\$GitAnnexUrl = "([^"]+)"/m)
  if (!urlLine) throw new Error('install.ps1 has no $GitAnnexUrl pin')
  return {
    gitAnnex: { version, sha256: value('GitAnnexSha256').toUpperCase(), url: urlLine[1].replace('${GitAnnexVersion}', version) },
    git: { url: value('GitUrl'), sha256: value('GitSha256').toUpperCase() }
  }
}

// "10.20260901" against "9.20269999": numbers, not text.
const compareVersions = (a, b) => {
  const [pa, pb] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

async function sha256Of(fetchImpl, url) {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return sha256(await res.arrayBuffer())
}

export async function checkPins({ fetchImpl = fetch, pins }) {
  const problems = []
  for (const [label, url, expected] of [
    [`git-annex ${pins.gitAnnex.version}`, pins.gitAnnex.url, pins.gitAnnex.sha256],
    ['Git for Windows', pins.git.url, pins.git.sha256]
  ]) {
    try {
      const actual = await sha256Of(fetchImpl, url)
      if (actual !== expected.toUpperCase()) {
        problems.push(`${label}: the SHA-256 of ${url} is ${actual}, the pin is ${expected}`)
      }
    } catch (error) {
      problems.push(`${label}: could not fetch ${url} (${error.message})`)
    }
  }

  // Not a failure: a newer version only means the pin can be bumped. A mirror page that cannot be read is no news either.
  let newerGitAnnex = null
  try {
    const page = await (await fetchImpl(pins.gitAnnex.url.slice(0, pins.gitAnnex.url.lastIndexOf('/') + 1))).text()
    for (const [, version] of page.matchAll(/git-annex-installer_(\d+\.\d+)_x64\.exe/g)) {
      if (compareVersions(version, pins.gitAnnex.version) > 0 && (!newerGitAnnex || compareVersions(version, newerGitAnnex) > 0)) {
        newerGitAnnex = version
      }
    }
  } catch {
    // ignored on purpose, see above
  }
  return { ok: problems.length === 0, problems, newerGitAnnex }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pins = parsePins(await readFile(new URL('./windows/install.ps1', import.meta.url), 'utf8'))
  const { ok, problems, newerGitAnnex } = await checkPins({ pins })
  for (const problem of problems) {
    console.error(`::error::${problem}`)
  }
  if (newerGitAnnex) {
    console.log(`::notice::A newer git-annex is on the mirror: ${newerGitAnnex} (pinned: ${pins.gitAnnex.version}). Bump the pin in install.ps1 after checking it.`)
  }
  if (!ok) {
    process.exit(1)
  }
  console.log(`Pins match: git-annex ${pins.gitAnnex.version} and Git for Windows.`)
}
