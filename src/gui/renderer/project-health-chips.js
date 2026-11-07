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
      label: `⚠️ ${changed} unsaved change${changed === 1 ? '' : 's'} — save when ready.`
    }
  }

  const missingChip = computeMissingContentChip(health)
  if (missingChip?.tone === 'warning') {
    return { tone: 'warning', label: '⚠️ Saved, but some file content has not been downloaded yet.' }
  }

  const onlyHere = onlyHereCount(health)
  if (onlyHere && health.sourceAccepts === null) {
    return { tone: 'neutral', label: `${plural(onlyHere, 'save is', 'saves are')} only on this computer.` }
  }
  if (onlyHere && health.sourceAccepts === 'no') {
    return { tone: 'neutral', label: `${plural(onlyHere, 'save', 'saves')} only on this computer. The place this project came from does not accept changes.` }
  }

  const syncChip = computeSyncStatusChip(health)
  if (syncChip.tone === 'warning') {
    return { tone: 'warning', label: `⚠️ Saved, but out of sync with remote (${syncChip.label}).` }
  }

  return { tone: 'good', label: '✅ Everything is saved and up to date.' }
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

// Saves that exist only here, while the answer to "does the source accept changes?" is unknown or no.
// (undefined = an old snapshot without the answer: behaves as yes, like today.)
function onlyHereCount(health) {
  const unanswered = health?.sourceAccepts === null || health?.sourceAccepts === 'no'
  return unanswered && health.hasUpstream && health.ahead > 0 ? health.ahead : 0
}

/**
 * The one-click "needs attention" rows on the Home view: only things the
 * researcher can fix with a single existing action. Empty when all is well.
 *
 * @param {{ annexSupported?: boolean, missingContentCount?: number|null, hasUpstream?: boolean, ahead?: number|null, behind?: number|null } | null | undefined} health
 * @returns {Array<{ kind: 'missing'|'publish'|'update'|'question'|'readonly', count: number, label: string, action?: string, undo?: string, groupLabel?: string, answers?: Array<{ answer: 'yes'|'no'|'unsure', text: string }> }>}
 */
export function computeAttentionRows(health) {
  const rows = []
  if (health?.annexSupported && health.missingContentCount > 0) {
    const count = health.missingContentCount
    rows.push({ kind: 'missing', count, label: `${plural(count, 'file', 'files')} not downloaded`, action: 'Get all' })
  }
  const onlyHere = onlyHereCount(health)
  if (onlyHere && health.sourceAccepts === null) {
    const question = 'Can you send changes back to the place this project came from?'
    rows.push({
      kind: 'question',
      count: onlyHere,
      label: `${onlyHere === 1 ? 'This' : 'These'} ${plural(onlyHere, 'save is', 'saves are')} only on this computer. ${question}`,
      groupLabel: 'Can you send changes back?',
      answers: [
        { answer: 'yes', text: 'Yes' },
        { answer: 'no', text: 'No, it is read-only' },
        { answer: 'unsure', text: 'Not sure' }
      ]
    })
  } else if (onlyHere) {
    rows.push({
      kind: 'readonly',
      count: onlyHere,
      label: 'To share these saves, add your own remote (a USB drive, a network share or your own repository).',
      action: 'Add a Remote',
      undo: 'My answer was wrong'
    })
  } else if (health?.hasUpstream && health.ahead > 0) {
    rows.push({ kind: 'publish', count: health.ahead, label: `${plural(health.ahead, 'save', 'saves')} not published`, action: 'Publish' })
  }
  if (health?.hasUpstream && health.behind > 0) {
    rows.push({ kind: 'update', count: health.behind, label: `${plural(health.behind, 'update', 'updates')} available`, action: 'Update' })
  }
  return rows
}
