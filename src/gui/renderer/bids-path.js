// Reads a project-relative BIDS path (with "/") into its parts. Anything that is not BIDS just gives empty parts.
export function parseBidsPath(path) {
  const parts = path.split('/')
  const file = parts[parts.length - 1]
  const dot = file.indexOf('.')
  const stem = dot < 0 ? file : file.slice(0, dot)
  const ext = dot < 0 ? null : file.slice(dot + 1)
  const entities = {}
  let suffix = null
  for (const piece of stem.split('_')) {
    const dash = piece.indexOf('-')
    if (dash > 0) entities[piece.slice(0, dash)] = piece.slice(dash + 1)
    else if (piece) suffix = piece
  }
  const subIdx = parts.findIndex((p) => p.startsWith('sub-'))
  const datasetLevel = subIdx < 0 || subIdx === parts.length - 1
  const folders = parts.slice(subIdx + 1, -1)
  const sesFolder = folders[0]?.startsWith('ses-') ? folders[0] : null
  const modality = subIdx >= 0 && folders.length === (sesFolder ? 2 : 1) ? folders[folders.length - 1] : null
  return {
    path,
    sub: datasetLevel ? null : (entities.sub ?? parts[subIdx].slice(4)),
    ses: sesFolder ? sesFolder.slice(4) : null,
    modality,
    entities,
    suffix: Object.keys(entities).length ? suffix : null,
    ext,
    datasetLevel
  }
}
