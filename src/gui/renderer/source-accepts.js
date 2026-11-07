// "Can you send changes back to the place this project came from?" Pure helpers for the page.
// SECURITY: the answer only steers wording and which buttons show. Publish is always really attempted
// by the person's click, so nothing here grants or blocks anything.

/**
 * "Not sure" is remembered for this session only (never stored), as if the answer were yes.
 * @param {{ projectPath?: string, sourceAccepts?: 'yes'|'no'|null } | null} health
 * @param {Set<string>} notSurePaths
 */
export function withSessionAnswer(health, notSurePaths) {
  if (health && !health.sourceAccepts && notSurePaths.has(health.projectPath)) {
    return { ...health, sourceAccepts: 'yes' }
  }
  return health
}

/** A refused push (permission/login), not a network problem, a stop, or another command. */
export function isPushRefusal(commandName, result) {
  return commandName === 'push' && result?.ok === false && !result.cancelled && result.userError?.code === 'AUTH_FAILED'
}

export const REFUSED_PUBLISH_MESSAGE =
  'This place does not accept changes from you, so Publish cannot work. Your saves stay safe on this computer. To share them, add your own remote.'
