// Pure decision logic for whether Save is currently usable, and which
// guidance hint to show. No DOM access — see button-gating.js for the
// same pattern applied to the workflow buttons.

/**
 * @param {{ hasMessage: boolean, hasSelection: boolean, hasConflicts: boolean, hasChanges: boolean }} input
 * @returns {{ disabled: boolean, guidance: { text: string, warning: boolean } }}
 */
export function computeSaveGating({ hasMessage, hasSelection, hasConflicts, hasChanges }) {
  const disabled = !hasMessage || (hasChanges && !hasSelection) || hasConflicts

  if (!hasMessage) {
    return { disabled, guidance: { text: 'Enter a save message to enable Save.', warning: false } }
  }

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

  if (hasChanges) {
    return { disabled, guidance: { text: 'Ready to save selected changes.', warning: false } }
  }

  return {
    disabled,
    guidance: { text: 'No local changes detected. Save remains available if needed.', warning: false }
  }
}
