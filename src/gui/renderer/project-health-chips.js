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

/**
 * A single plain-language summary of the three chips above, for people who
 * just want to know "am I okay?" without parsing git jargon. The detailed
 * chips stay available behind a "Show details" disclosure for anyone who
 * wants the specifics.
 *
 * @param {{ clean: boolean, totalChanged: number } | null | undefined} tree
 * @param {{ hasUpstream?: boolean, upstream?: string|null, ahead?: number|null, behind?: number|null, annexSupported?: boolean, missingContentCount?: number|null } | null | undefined} health
 * @returns {{ tone: 'good'|'warning'|'urgent'|'neutral', label: string }}
 */
export function computeStatusLine(tree, health) {
  if (!tree || !health) {
    return { tone: 'neutral', label: 'Status unknown.' }
  }

  if (!tree.clean) {
    const changed = tree.totalChanged
    return {
      tone: 'urgent',
      label: `⚠️ ${changed} unsaved change${changed === 1 ? '' : 's'} — save a checkpoint when ready.`
    }
  }

  const missingChip = computeMissingContentChip(health)
  if (missingChip?.tone === 'warning') {
    return { tone: 'warning', label: '⚠️ Saved, but some file content has not been downloaded yet.' }
  }

  const syncChip = computeSyncStatusChip(health)
  if (syncChip.tone === 'warning') {
    return { tone: 'warning', label: `⚠️ Saved, but out of sync with remote (${syncChip.label}).` }
  }

  return { tone: 'good', label: '✅ Everything is saved and up to date.' }
}
