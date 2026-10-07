// Pure decision logic for whether Save is currently usable, and which
// guidance hint to show. No DOM access — see button-gating.js for the
// same pattern applied to the workflow buttons.

/**
 * Save stays clickable whenever there is something it could act on — a
 * message is a nice-to-have, not a lock. Missing-message is surfaced as a
 * guidance hint (and, if the user actually clicks without one, a blocking
 * message at click time) rather than by disabling the button, since a
 * disabled button with no explanation reads as broken.
 *
 * @param {{
 *   hasIdentity?: boolean (git name+email set; defaults to true),
 *   hasMessage: boolean, hasSelection: boolean, hasConflicts: boolean, hasChanges: boolean,
 *   messageLabel?: string,
 *   mergeInProgress?: boolean (a merge is being resolved; defaults to false),
 *   prismMode?: 'gated' | 'conversion' | 'bids' (PRISM or BIDS project: everything is validated and saved together)
 * }} input messageLabel lets callers swap in git terminology ("commit message") for power users
 *   while plain-language users ("checkpoint message") get the default.
 * @returns {{ disabled: boolean, guidance: { text: string, warning: boolean } }}
 */
export function computeSaveGating({
  hasMessage,
  hasSelection,
  hasConflicts,
  hasChanges,
  hasIdentity = true,
  messageLabel = 'checkpoint message',
  mergeInProgress = false,
  prismMode
}) {
  if (mergeInProgress) {
    return {
      disabled: true,
      guidance: { text: 'A merge is in progress. Finish or cancel it first.', warning: true }
    }
  }
  const selected = hasSelection || prismMode === 'gated' || prismMode === 'bids'
  const disabled = hasConflicts || (hasChanges && !selected)

  if (hasConflicts) {
    return {
      disabled,
      guidance: { text: 'Conflicts detected. Resolve conflicts before saving.', warning: true }
    }
  }

  if (hasChanges && !selected) {
    return {
      disabled,
      guidance: { text: 'Select changed files or add manual paths before saving.', warning: true }
    }
  }

  if (!hasIdentity) {
    return {
      disabled,
      guidance: { text: 'Set your name and email in Setup before saving.', warning: true }
    }
  }

  if (!hasMessage) {
    return {
      disabled,
      guidance: { text: `Add a ${messageLabel}, or Save will ask you for one.`, warning: true }
    }
  }

  if (hasChanges) {
    const texts = {
      gated: 'PRISM project: your data is checked before every save, and everything is saved together.',
      bids: 'BIDS project: your data is checked before every save, and everything is saved together.',
      conversion: 'This save adds project.json. Checking starts with your next save.'
    }
    return { disabled, guidance: { text: texts[prismMode] ?? 'Ready to save selected changes.', warning: false } }
  }

  return {
    disabled,
    guidance: { text: 'No local changes detected. Save remains available if needed.', warning: false }
  }
}
