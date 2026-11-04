export const PRISM_COOLDOWN_DAYS = 3

export function parseVersion(text) {
  if (typeof text !== 'string') return null
  const v = text.slice(0, 200).match(/\d+(?:\.\d+)+/)?.[0] ?? null
  return v && isSafe(v) ? v : null
}

const isSafe = (v) => v.split('.').every((p) => Number.isSafeInteger(Number(p)))

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
  if (!releases || typeof releases !== 'object' || Array.isArray(releases)) return null
  const cutoffMs = now.getTime() - cooldownDays * 86400000
  let best = null
  for (const [version, files] of Object.entries(releases)) {
    if (!/^\d+(\.\d+)*$/.test(version) || !isSafe(version) || !Array.isArray(files)) continue
    let earliest = Infinity
    for (const f of files) {
      if (!f || f.yanked) continue
      const t = Date.parse(f.upload_time_iso_8601)
      earliest = Number.isNaN(t) ? NaN : Math.min(earliest, t)
      if (Number.isNaN(earliest)) break
    }
    if (!(earliest <= cutoffMs)) continue // also rejects NaN and no non-yanked file
    const c = best && compareVersions(version, best)
    if (!best || c > 0 || (c === 0 && version.length > best.length)) best = version
  }
  return best && { version: best, cutoff: new Date(cutoffMs).toISOString() }
}
