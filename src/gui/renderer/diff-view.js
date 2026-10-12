// Pure rendering of a file diff (from the adapter's getFileDiff) as escaped HTML.
// TSV/CSV files get their changed cells highlighted. No DOM access; same pattern as project-health-chips.js.
import { escapeHtml } from './escape-html.js'

export const DIFF_DEFAULT_LINES = 500
export const DIFF_MAX_LINES = 20000

/** @param {string} patch unified diff starting at its first "@@" line */
export function parseUnifiedDiff(patch) {
  const lines = []
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      lines.push({ type: 'hunk', text: line })
    } else if (line.startsWith('+')) {
      lines.push({ type: 'add', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      lines.push({ type: 'del', text: line.slice(1) })
    } else if (line.startsWith(' ')) {
      lines.push({ type: 'context', text: line.slice(1) })
    }
    // "\ No newline at end of file" and the empty tail after the last newline are dropped.
  }
  return lines
}

export function separatorFor(path) {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase()
  if (extension === 'tsv' || extension === 'tab') {
    return '\t'
  }
  return extension === 'csv' ? ',' : null
}

// ponytail: a plain split; fields with quotes (which may hold the separator) fall back to the line diff.
export function cellChanges(oldLine, newLine, separator) {
  if (oldLine.includes('"') || newLine.includes('"')) {
    return null
  }
  const before = oldLine.split(separator)
  const after = newLine.split(separator)
  if (before.length !== after.length) {
    return null
  }
  return {
    old: before.map((text, index) => ({ text, changed: text !== after[index] })),
    new: after.map((text, index) => ({ text, changed: text !== before[index] }))
  }
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`
}

function rowHtml(type, mark, content) {
  return `<div class="diff-line diff-${type}"><span class="diff-mark">${mark}</span>${content}</div>`
}

function cellsHtml(cells, separator) {
  return cells
    .map((cell) => (cell.changed ? `<span class="diff-cell-changed">${escapeHtml(cell.text)}</span>` : escapeHtml(cell.text)))
    .join(escapeHtml(separator))
}

function renderRows(lines, separator) {
  const rows = []
  for (let index = 0; index < lines.length; ) {
    const line = lines[index]
    if (line.type === 'hunk') {
      rows.push(rowHtml('hunk', '', escapeHtml(line.text)))
      index += 1
    } else if (line.type === 'context') {
      rows.push(rowHtml('context', ' ', escapeHtml(line.text)))
      index += 1
    } else {
      // A run of removed lines followed by added lines: pair them by position for cell highlighting.
      const removed = []
      const added = []
      while (lines[index]?.type === 'del') {
        removed.push(lines[index].text)
        index += 1
      }
      while (lines[index]?.type === 'add') {
        added.push(lines[index].text)
        index += 1
      }
      const paired = separator ? removed.map((text, i) => (i < added.length ? cellChanges(text, added[i], separator) : null)) : []
      removed.forEach((text, i) => {
        rows.push(rowHtml('del', '-', paired[i] ? cellsHtml(paired[i].old, separator) : escapeHtml(text)))
      })
      added.forEach((text, i) => {
        rows.push(rowHtml('add', '+', paired[i] ? cellsHtml(paired[i].new, separator) : escapeHtml(text)))
      })
    }
  }
  return rows.join('')
}

const STATUS_WORD = { added: 'added', deleted: 'deleted', modified: 'changed' }

/**
 * @param {{ kind: string, status?: string, patch?: string, totalLines?: number, truncated?: boolean, oldSize?: number|null, newSize?: number|null }} diff
 * @param {{ path: string, requestedMax: number }} options
 */
export function renderDiffHtml(diff, { path, requestedMax }) {
  if (diff.kind === 'unchanged') {
    return '<p class="hint-inline">No changes.</p>'
  }

  if (diff.kind === 'binary') {
    const sizes = [diff.oldSize, diff.newSize].every((size) => size === null || size === undefined)
      ? ''
      : ` (${diff.oldSize == null ? 'new' : formatBytes(diff.oldSize)} → ${diff.newSize == null ? 'removed' : formatBytes(diff.newSize)})`
    return `<p class="hint-inline">Data file ${STATUS_WORD[diff.status] ?? 'changed'} (not shown as text)${sizes}.</p>`
  }

  const lines = parseUnifiedDiff(diff.patch ?? '')
  let footer = ''
  if (diff.truncated) {
    const shown = lines.length
    footer = requestedMax < DIFF_MAX_LINES
      ? `<p class="hint-inline">Showing ${shown} of ${diff.totalLines} lines. ` +
        '<button type="button" class="button button-ghost button-inline diff-more-button">Show the rest</button></p>'
      : `<p class="hint-inline">Showing ${shown} of ${diff.totalLines} lines. The rest is not shown.</p>`
  }
  return `<div class="diff" role="group" aria-label="Changes in ${escapeHtml(path)}">${renderRows(lines, separatorFor(path))}</div>${footer}`
}
