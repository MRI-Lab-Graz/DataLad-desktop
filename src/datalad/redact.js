// A token or password inside an http(s)/ftp URL must not reach the screen, a screenshot or a pasted bug report.
// ssh user names (git@host) are not secrets and stay.
const URL_USERINFO = /\b(https?|ftps?):\/\/[^/@\s]+@/gi

export function redactUrlCredentials(text) {
  return String(text ?? '').replace(URL_USERINFO, '$1://***@')
}
