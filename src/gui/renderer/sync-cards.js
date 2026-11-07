// What the Sync tab says, in plain words, from a health snapshot. Pure data: app.js shows it with textContent only.
// Whether the buttons are usable is decided elsewhere (computeRemoteGating); nothing here enables or blocks anything.
import { redactUrlCredentials } from '../../datalad/redact.js'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const known = (n) => Number.isFinite(n)

// A URL scheme (other than file) or user@host:path means online; everything else is a folder.
function describeLocation(url) {
  const shown = redactUrlCredentials(url)
  if (/^file:\/\//i.test(shown)) return `a folder at ${decodeURIComponent(shown.replace(/^file:\/\//i, ''))}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(shown) || /^[^/\\\s]+@[^/\\\s]+:/.test(shown)) return `an online repository: ${shown}`
  return `a folder at ${shown}`
}

function sendPart(ahead) {
  if (!known(ahead)) return 'your saves: not checked yet'
  if (ahead === 0) return 'All your saves are there'
  return `${plural(ahead, 'save', 'saves')} of yours ${ahead === 1 ? 'is' : 'are'} not there yet`
}

function getPart(behind) {
  if (!known(behind)) return 'saves from others: not checked yet'
  if (behind === 0) return 'nothing new from others'
  return `${plural(behind, 'new save', 'new saves')} from others ${behind === 1 ? 'is' : 'are'} waiting`
}

function count(n, none) {
  return !known(n) ? 'not checked yet' : n === 0 ? none : `${n} waiting`
}

/**
 * @param {{ hasUpstream?: boolean, upstream?: string|null, ahead?: number|null, behind?: number|null, remoteUrl?: string|null, sourceAccepts?: 'yes'|'no'|null } | null | undefined} health
 */
export function describeSync(health) {
  const update = { label: 'Get updates', help: '', countText: '' }
  const publish = { label: 'Send my saves', help: '', countText: '' }
  if (!health?.hasUpstream) return { remoteLine: '', statusLine: '', update, publish }

  const name = health.upstream?.split('/')[0] || 'the remote'
  const remoteLine = health.remoteUrl ? `${name} — ${describeLocation(health.remoteUrl)}` : name
  const { ahead, behind } = health
  const statusLine =
    ahead === 0 && behind === 0
      ? 'Everything is in sync.'
      : !known(ahead) && !known(behind)
        ? 'Not checked yet.'
        : `${sendPart(ahead)} · ${getPart(behind)}`

  update.help = 'Bring in saves that others (or another computer) added there. Nothing of yours is changed. (called Update)'
  update.countText = count(behind, 'none waiting')
  publish.help =
    health.sourceAccepts === 'no'
      ? `${name} does not accept changes from you, so sending will most likely be turned down. Your saves stay safe on this computer; add your own remote below to share them. You can still try. (called Publish)`
      : `Copy the saves you made here to ${name}, so others can get them. (called Publish)`
  publish.countText = count(ahead, 'nothing to send')
  return { remoteLine, statusLine, update, publish }
}
