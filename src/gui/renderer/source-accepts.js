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

/**
 * True only when the git push itself was refused for lack of permission (GitHub-style "Permission to X denied to
 * Y" or HTTP 403). Not a login problem, a special-remote (S3) error, a USB/share error, or a network failure.
 */
export function isSourceRefusal(commandName, result) {
  if (commandName !== 'push' || result?.ok !== false || result.cancelled) {
    return false
  }
  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}\n${result.userError?.technicalDetails ?? ''}`
  return /permission to .+ denied to |returned error: 403/i.test(text) && !/amazonaws|\bs3\b|special remote/i.test(text)
}

export const REFUSED_PUBLISH_MESSAGE =
  'Publish was refused. Either this place does not accept changes from you, or your login is not valid. If this project came from a public source such as OpenNeuro, add your own remote to share these saves.'
