// Pure decision logic for the status chips shown in the Project Health
// card: save status, remote sync status, and missing-annex-content status.
// Returns plain data (tone + label text); app.js is responsible for
// escaping and rendering it as HTML. Same pattern as button-gating.js.

/**
 * @param {{ clean: boolean, totalChanged: number } | null | undefined} tree
 * @returns {{ tone: 'good'|'urgent'|'neutral', label: string }}
 */
export function computeSaveStatusChip(tree) {
  if (!tree) {
    return { tone: 'neutral', label: 'Save status unknown' }
  }

  if (tree.clean) {
    return { tone: 'good', label: 'Saved' }
  }

  return { tone: 'urgent', label: `Unsaved changes ${tree.totalChanged}` }
}

/**
 * @param {{ hasUpstream?: boolean, upstream?: string|null, ahead?: number|null, behind?: number|null } | null | undefined} health
 * @returns {{ tone: 'good'|'warning'|'neutral', label: string }}
 */
export function computeSyncStatusChip(health) {
  if (!health?.hasUpstream) {
    return { tone: 'neutral', label: 'No remote tracked' }
  }

  if (health.ahead === null || health.behind === null || health.ahead === undefined || health.behind === undefined) {
    return { tone: 'neutral', label: `Tracking ${health.upstream}` }
  }

  if (health.ahead === 0 && health.behind === 0) {
    return { tone: 'good', label: `In sync with ${health.upstream}` }
  }

  const parts = []
  if (health.ahead > 0) {
    parts.push(`${health.ahead} to publish`)
  }
  if (health.behind > 0) {
    parts.push(`${health.behind} to update`)
  }
  return { tone: 'warning', label: parts.join(', ') }
}

/**
 * @param {{ annexSupported?: boolean, missingContentCount?: number|null } | null | undefined} health
 * @returns {{ tone: 'good'|'warning', label: string } | null} null means: don't show this chip at all.
 */
export function computeMissingContentChip(health) {
  if (!health?.annexSupported) {
    return null
  }

  if (health.missingContentCount > 0) {
    return { tone: 'warning', label: `Data not downloaded: ${health.missingContentCount}` }
  }

  return { tone: 'good', label: 'All data present' }
}
