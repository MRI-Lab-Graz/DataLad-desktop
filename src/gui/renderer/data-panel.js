// The "Choose data" panel as an HTML string. Pure: no DOM, no I/O. Every value comes from file names, so all of it is escaped.
import { escapeHtml as esc } from './escape-html.js'

/** Decimal units (1 KB = 1000 B, as on macOS), one decimal above bytes. */
export function formatBytes(n) {
  if (!(n >= 1000)) return `${Math.max(0, Math.round(n) || 0)} B`
  const units = ['KB', 'MB', 'GB']
  let i = -1
  do {
    n /= 1000
    i++
  } while (n >= 1000 && i < units.length - 1)
  return `${n.toFixed(1)} ${units[i]}`
}

function summaryText({ count, bytes, unknownSize }) {
  if (!count) return 'Nothing chosen yet'
  const text = `${count} ${count === 1 ? 'file' : 'files'}, about ${formatBytes(bytes)}`
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
    `<fieldset><legend>${esc(group.title)} (${esc(group.hint)})</legend>` +
    `<button type="button" data-group-all="${key}">All</button> <button type="button" data-group-none="${key}">None</button>` +
    `<div>${boxes}</div></fieldset>`
  )
}

export function renderDataPanel({ groups, selection, summary, mode }) {
  const off = summary.count === 0 ? ' disabled' : ''
  return (
    groups.filter((g) => g.values.length).map((g) => renderGroup(g, selection[g.key])).join('') +
    `<p id="data-panel-summary" data-mode="${mode === 'drop' ? 'drop' : 'get'}" aria-live="polite">${esc(summaryText(summary))}</p>` +
    `<button type="button" id="data-panel-download"${off} title="Copy the chosen files onto this computer so you can open them">Download selected</button> ` +
    `<button type="button" id="data-panel-free"${off} title="Remove the chosen files from this computer. They stay available from where they came from">Free up space</button>`
  )
}
