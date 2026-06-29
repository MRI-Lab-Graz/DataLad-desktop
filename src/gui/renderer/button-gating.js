// Pure decision logic for which workflow buttons are usable, given the
// current project's classification and health snapshot. No DOM access here
// on purpose — this module is unit-testable without Electron, and app.js is
// responsible for applying whatever it returns to the actual buttons.

const NO_REMOTE_TITLE =
  'No remote is configured for this project, so there is nothing to sync with. ' +
  'This project can still be used fully offline with Save and Get Data.'

const NOT_A_DATASET_TITLE =
  'This is a plain Git project, not a DataLad dataset, so there is no annexed data to fetch.'

const GET_DATA_READY_TITLE =
  'Download the actual content for large/tracked files that are present only as placeholders.'

/**
 * @param {string|null|undefined} classification one of 'git' | 'dataset' | 'superdataset' | 'unknown' | null
 * @returns {{ disabled: boolean, title: string }}
 */
export function computeDatasetGating(classification) {
  const isDataLadDataset = classification === 'dataset' || classification === 'superdataset'

  return {
    disabled: !isDataLadDataset,
    title: isDataLadDataset ? GET_DATA_READY_TITLE : NOT_A_DATASET_TITLE
  }
}

/**
 * @param {{ hasUpstream?: boolean, upstream?: string|null, remoteUrl?: string|null } | null | undefined} health
 * @returns {{
 *   update: { disabled: boolean, title: string },
 *   publish: { disabled: boolean, title: string },
 *   remoteInfo: { hidden: boolean, text: string }
 * }}
 */
export function computeRemoteGating(health) {
  const hasRemote = Boolean(health?.hasUpstream)

  if (!hasRemote) {
    return {
      update: { disabled: true, title: NO_REMOTE_TITLE },
      publish: { disabled: true, title: NO_REMOTE_TITLE },
      remoteInfo: { hidden: true, text: '' }
    }
  }

  const remoteLabel = health.remoteUrl ? `${health.upstream} (${health.remoteUrl})` : health.upstream

  return {
    update: { disabled: false, title: `Pull and merge the latest changes from ${remoteLabel}.` },
    publish: { disabled: false, title: `Push your saved changes to ${remoteLabel}.` },
    remoteInfo: { hidden: false, text: `Remote: ${remoteLabel}` }
  }
}
