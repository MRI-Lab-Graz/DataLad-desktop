// A token or password inside an http(s)/ftp URL must not reach the screen, a screenshot or a pasted bug report.
// ssh user names (git@host) are not secrets and stay. Userinfo ends at the LAST @ before the path, so a password
// that itself contains @ does not leak its tail.
const URL_USERINFO = /\b(https?|ftps?):\/\/[^/?#\s]*@/gi
const SECRET_QUERY = /([?&](?:access_token|token|password|passwd|key|secret|sig)=)[^&#\s]*/gi

export function redactUrlCredentials(text) {
  return String(text ?? '')
    .replace(URL_USERINFO, '$1://***@')
    .replace(/\bhttps?:\/\/[^\s]*/gi, (url) => url.replace(SECRET_QUERY, '$1***'))
}
