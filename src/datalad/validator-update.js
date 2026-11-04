export const PRISM_COOLDOWN_DAYS = 3

export function parseVersion(text) {
  return typeof text === 'string' ? (text.match(/\d+(?:\.\d+)+/)?.[0] ?? null) : null
}

export function compareVersions(a, b) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d
  }
  return 0
}

export function pickRelease(pypiJson, { now, cooldownDays }) {
  const releases = pypiJson?.releases
  if (!releases || typeof releases !== 'object') return null
  const cutoffMs = now.getTime() - cooldownDays * 86400000
  let best = null
  for (const [version, files] of Object.entries(releases)) {
    if (!/^\d+(\.\d+)*$/.test(version) || !Array.isArray(files) || !files.length) continue
    if (files.every((f) => f?.yanked)) continue
    const earliest = Math.min(...files.map((f) => Date.parse(f?.upload_time_iso_8601)))
    if (!(earliest <= cutoffMs)) continue // also rejects NaN
    if (!best || compareVersions(version, best) > 0) best = version
  }
  return best && { version: best, cutoff: new Date(cutoffMs).toISOString() }
}
