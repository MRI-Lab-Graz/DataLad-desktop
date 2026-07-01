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
 * @param {{ hasMessage: boolean, hasSelection: boolean, hasConflicts: boolean, hasChanges: boolean }} input
 * @returns {{ disabled: boolean, guidance: { text: string, warning: boolean } }}
 */
export function computeSaveGating({ hasMessage, hasSelection, hasConflicts, hasChanges }) {
  const disabled = hasConflicts || (hasChanges && !hasSelection)

  if (hasConflicts) {
    return {
      disabled,
      guidance: { text: 'Conflicts detected. Resolve conflicts before saving.', warning: true }
    }
  }

  if (hasChanges && !hasSelection) {
    return {
      disabled,
      guidance: { text: 'Select changed files or add manual paths before saving.', warning: true }
    }
  }

  if (!hasMessage) {
    return {
      disabled,
      guidance: { text: 'Add a save message, or Save will ask you for one.', warning: true }
    }
  }

  if (hasChanges) {
    return { disabled, guidance: { text: 'Ready to save selected changes.', warning: false } }
  }

  return {
    disabled,
    guidance: { text: 'No local changes detected. Save remains available if needed.', warning: false }
  }
}
