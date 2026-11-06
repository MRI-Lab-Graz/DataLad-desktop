// The "Choose data" panel as an HTML string. Pure: no DOM, no I/O. Every value comes from file names, so all of it is escaped.
import { escapeHtml as esc } from './escape-html.js'

/** Decimal units (1 KB = 1000 B, as on macOS), one decimal above bytes. */
export function formatBytes(n) {
  if (!(n >= 1000)) return `${Math.max(0, Math.round(n) || 0)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do {
    n /= 1000
    i++
  } while (n >= 1000 && i < units.length - 1)
  return `${n.toFixed(1)} ${units[i]}`
}

function summaryText({ count, bytes, unknownSize }) {
  if (!count) return 'Nothing chosen yet'
  const files = `${count} ${count === 1 ? 'file' : 'files'}`
  if (unknownSize >= count) return `${files}, size unknown`
  const text = `${files}, about ${formatBytes(bytes)}`
  return unknownSize > 0 ? `${text}, size unknown for ${unknownSize} ${unknownSize === 1 ? 'file' : 'files'}` : text
}

function renderGroup(group, selected) {
  const key = esc(group.key)
  const boxes = group.values
    .map((value, i) => {
      const id = `data-${key}-${i}`
      return `<label for="${id}"><input type="checkbox" id="${id}" data-group="${key}" data-value="${esc(value)}"${selected?.has(value) ? ' checked' : ''}> ${esc(value)}</label>`
    })
    .join('')
  return (
    `<fieldset><legend>${esc(group.title)}${group.hint ? ` (${esc(group.hint)})` : ''}</legend>` +
    `<button type="button" data-group-all="${key}">All</button> <button type="button" data-group-none="${key}">None</button>` +
    `<div>${boxes}</div></fieldset>`
  )
}

const EMPTY = 'No downloadable files were found. If this project was copied without its sub-datasets, they are not shown yet.'

// fileCount: how many files were listed at all (0 = explain the empty panel; undefined = unknown, say nothing).
export function renderDataPanel({ groups, selection, summary, mode, fileCount }) {
  const off = summary.count === 0 ? ' disabled' : ''
  return (
    (fileCount === 0
      ? `<p role="status">${esc(EMPTY)}</p>`
      : groups.filter((g) => g.values.length).map((g) => renderGroup(g, selection[g.key])).join('')) +
    `<p id="data-panel-summary" data-mode="${mode === 'drop' ? 'drop' : 'get'}" aria-live="polite">${esc(summaryText(summary))}</p>` +
    `<button type="button" id="data-panel-download"${off} title="Copy the chosen files onto this computer so you can open them">Download selected</button> ` +
    `<button type="button" id="data-panel-free"${off} title="Remove the chosen files from this computer. They stay available from where they came from">Free up space</button>`
  )
}
