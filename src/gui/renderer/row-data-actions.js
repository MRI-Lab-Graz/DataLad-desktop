// Which data actions a Files-tab row offers. Only annexed content has any: a row whose annexPresent is null is a plain
// Git file or an unknown state and gets none.
const GET = { action: 'get', label: 'Get', title: 'Download the actual content from your remote or backup.' }
const DROP = {
  action: 'drop',
  label: 'Free up space',
  title: 'Remove the local copy to free disk space. Only works when another copy (remote or backup) is confirmed; Get brings it back.'
}
const UNLOCK = {
  action: 'unlock',
  label: 'Unlock',
  title:
    "Use with caution. Some other software can't open DataLad-managed files because they are links to the underlying data, " +
    'not normal files. Unlock replaces the link with a real, editable copy of this file. This roughly doubles disk usage ' +
    "for the file until you run Save again, which puts it back under DataLad's tracking."
}

/**
 * @param {{ type: 'file'|'directory', annexPresent?: boolean|'partial'|null }} node
 * @returns {Array<{ action: 'get'|'drop'|'unlock', label: string, title: string }>}
 */
export function rowDataActions({ type, annexPresent }) {
  if (annexPresent === null || annexPresent === undefined) return []
  if (type === 'directory') return [annexPresent !== true && GET, annexPresent !== false && DROP].filter(Boolean)
  return annexPresent === false ? [GET] : annexPresent === true ? [DROP, UNLOCK] : []
}
