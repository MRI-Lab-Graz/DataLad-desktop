// Only the app's own top-level page may call our IPC handlers. Navigation and CSP
// already keep other pages out; this makes a stray frame or window unable to ask for
// files, commands or folders even if one ever got in.
const strip = (url) => {
  const parsed = new URL(url)
  parsed.search = ''
  parsed.hash = ''
  return parsed.href
}

export function isTrustedSender(event, appUrl) {
  const frame = event?.senderFrame
  if (!frame || frame.parent) {
    return false
  }
  try {
    return strip(frame.url) === strip(appUrl)
  } catch {
    return false
  }
}

export function guardedHandler(appUrl, handler) {
  return (event, ...args) => {
    if (!isTrustedSender(event, appUrl)) {
      throw new Error('Rejected IPC call from an untrusted sender.')
    }
    return handler(event, ...args)
  }
}
