// Pure decision logic for which workflow buttons are usable, given the
// current project's classification and health snapshot. No DOM access here
// on purpose — this module is unit-testable without Electron, and app.js is
// responsible for applying whatever it returns to the actual buttons.

const NO_REMOTE_TITLE =
  'No remote is configured for this project, so there is nothing to sync with. ' +
  'This project can still be used fully offline with Save.'

const NOT_A_DATASET_TITLE =
  'This is a plain Git project, not a DataLad dataset, so there is no annexed data to fetch.'

const GET_DATA_READY_TITLE =
  'Download the actual content for large/tracked files that are present only as placeholders.'

const NOTHING_TO_GET_TITLE =
  'All tracked file content is already downloaded here, so there is nothing to get.'

/**
 * @param {string|null|undefined} classification one of 'git' | 'dataset' | 'superdataset' | 'unknown' | null
 * @param {{ annexSupported?: boolean, missingContentCount?: number|null } | null | undefined} health
 * @returns {{ disabled: boolean, title: string }}
 */
export function computeDatasetGating(classification, health) {
  const isDataLadDataset = classification === 'dataset' || classification === 'superdataset'

  if (!isDataLadDataset) {
    return { disabled: true, title: NOT_A_DATASET_TITLE }
  }

  // Once health has resolved, an empty/fully-hydrated dataset has nothing
  // for `datalad get` to fetch — running it anyway used to surface as a
  // confusing "Get Data failed" error rather than a clear no-op.
  if (health?.annexSupported && health.missingContentCount === 0) {
    return { disabled: true, title: NOTHING_TO_GET_TITLE }
  }

  return { disabled: false, title: GET_DATA_READY_TITLE }
}

const NOT_A_DATASET_ANNEX_TITLE =
  'This is a plain Git project, not a DataLad dataset, so it has no separately stored data.'

/**
 * Actions that only make sense on git-annex content (Free Up Space, Check Data Integrity).
 * @param {string|null|undefined} classification
 * @param {string} readyTitle tooltip when the action is available
 * @returns {{ disabled: boolean, title: string }}
 */
export function computeAnnexToolGating(classification, readyTitle) {
  const isDataLadDataset = classification === 'dataset' || classification === 'superdataset'
  return isDataLadDataset ? { disabled: false, title: readyTitle } : { disabled: true, title: NOT_A_DATASET_ANNEX_TITLE }
}

/**
 * The remote Publish uses for `projectPath`, or null. A health snapshot belongs to one project: a subdataset
 * has its own remotes, so another project's snapshot must not name one for it.
 * @param {{ projectPath?: string, hasUpstream?: boolean, upstream?: string|null } | null | undefined} health
 * @param {string} projectPath
 * @returns {string|null}
 */
export function remoteNameForProject(health, projectPath) {
  return health?.hasUpstream && health.projectPath === projectPath ? health.upstream?.split('/')[0] ?? null : null
}

/**
 * @param {{ hasUpstream?: boolean, upstream?: string|null, remoteUrl?: string|null } | null | undefined} health
 * @returns {{
 *   update: { disabled: boolean, title: string },
 *   publish: { disabled: boolean, title: string },
 *   disconnect: { disabled: boolean, title: string },
 *   addRemote: { hidden: boolean },
 *   remoteInfo: { hidden: boolean, text: string }
 * }}
 */
export function computeRemoteGating(health) {
  const hasRemote = Boolean(health?.hasUpstream)

  if (!hasRemote) {
    return {
      update: { disabled: true, title: NO_REMOTE_TITLE },
      publish: { disabled: true, title: NO_REMOTE_TITLE },
      disconnect: { disabled: true, title: NO_REMOTE_TITLE },
      addRemote: { hidden: false },
      remoteInfo: { hidden: true, text: '' }
    }
  }

  const remoteLabel = health.remoteUrl ? `${health.upstream} (${health.remoteUrl})` : health.upstream
  const remoteName = health.upstream?.split('/')[0] ?? health.upstream

  return {
    update: { disabled: false, title: `Pull and merge the latest changes from ${remoteLabel}.` },
    publish: { disabled: false, title: `Push your saved changes to ${remoteLabel}.` },
    disconnect: {
      disabled: false,
      title:
        `Remove the "${remoteName}" remote from this project. Useful for read-only sources ` +
        `(e.g. OpenNeuro) you never intend to push to or pull further updates from — nothing already ` +
        `saved here is affected, this project just stops being linked to ${remoteName}.`
    },
    addRemote: { hidden: true },
    remoteInfo: { hidden: false, text: `Remote: ${remoteLabel}` }
  }
}

/**
 * The Sync section only makes sense when there's something to sync with:
 * a configured remote, or a DataLad dataset that could be given one (Add a
 * Remote lives there). A plain local Git project has neither, so the whole
 * section stays hidden for it.
 *
 * @param {string|null|undefined} classification one of 'git' | 'dataset' | 'superdataset' | 'unknown' | null
 * @param {{ hasUpstream?: boolean } | null | undefined} health
 * @returns {boolean}
 */
export function computeSyncSectionVisible(classification, health) {
  const isDataLadDataset = classification === 'dataset' || classification === 'superdataset'
  const hasRemote = Boolean(health?.hasUpstream)

  return isDataLadDataset || hasRemote
}

/**
 * Without a remote, Update and Publish are both disabled — two greyed buttons plus an info icon read as broken rather
 * than "not needed yet". Swap the strip for one quiet line instead of hiding the section, so Add a Remote stays
 * discoverable. Null before health has resolved, to avoid a premature flash.
 *
 * @param {{ hasUpstream?: boolean } | null | undefined} health
 * @returns {string|null} the quiet message to show, or null to show the normal button strip
 */
export function computeSyncActionsQuietMessage(health) {
  if (!health) {
    return null
  }
  const { update, publish } = computeRemoteGating(health)
  return update.disabled && publish.disabled
    ? 'Nothing to sync right now — use Add a Remote below to enable Update and Publish.'
    : null
}
