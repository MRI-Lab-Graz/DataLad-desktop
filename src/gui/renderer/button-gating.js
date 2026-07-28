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

const NOTHING_TO_GET_TITLE =
  'All tracked file content is already downloaded here, so there is nothing to get.'

const NOT_A_DATASET_UNLOCK_TITLE =
  'This is a plain Git project, not a DataLad dataset, so there is nothing to unlock.'

const UNLOCK_READY_TITLE =
  'Use with caution: replaces the link to selected file(s) with a real, editable copy. ' +
  'Content must already be downloaded (Get Data), and this roughly doubles disk usage until you Save again.'

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

/**
 * @param {string|null|undefined} classification one of 'git' | 'dataset' | 'superdataset' | 'unknown' | null
 * @returns {{ disabled: boolean, title: string }}
 */
export function computeUnlockGating(classification) {
  const isDataLadDataset = classification === 'dataset' || classification === 'superdataset'

  if (!isDataLadDataset) {
    return { disabled: true, title: NOT_A_DATASET_UNLOCK_TITLE }
  }

  return { disabled: false, title: UNLOCK_READY_TITLE }
}

/**
 * @param {{ hasUpstream?: boolean, upstream?: string|null, remoteUrl?: string|null } | null | undefined} health
 * @returns {{
 *   update: { disabled: boolean, title: string },
 *   publish: { disabled: boolean, title: string },
 *   disconnect: { disabled: boolean, title: string },
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
    remoteInfo: { hidden: false, text: `Remote: ${remoteLabel}` }
  }
}

/**
 * The "Get Data & Remote Sync" section only makes sense when there's
 * something to sync with: a configured remote, or a DataLad dataset whose
 * annexed files might have real content to fetch. A plain local Git
 * project has neither, so the whole section stays hidden for it.
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
 * The section stays visible (per computeSyncSectionVisible) for as long as
 * it *could* become useful, but a dataset with no remote and nothing
 * missing to fetch has all three actions disabled at once — three greyed
 * buttons plus an info icon reads as broken rather than "not needed yet".
 * In that case, swap the button strip for one quiet explanatory line
 * instead of hiding the section outright, so the feature stays
 * discoverable for when a remote gets added or content goes missing.
 *
 * @param {string|null|undefined} classification one of 'git' | 'dataset' | 'superdataset' | 'unknown' | null
 * @param {{
 *   hasUpstream?: boolean, annexSupported?: boolean, missingContentCount?: number|null
 * } | null | undefined} health
 * @returns {string|null} the quiet message to show, or null to show the normal button strip
 */
/**
 * Whether a project's remote is the lab's shared studies server, so callers
 * can warn before pushing to it — someone who cloned an existing study isn't
 * necessarily thinking of "Publish" as "overwrite the shared copy everyone
 * else installs from". Matches on bare hostname only (the part after the
 * last "@", same convention ssh/OpenSSH itself uses for "user@domain@host"
 * logins) so it doesn't matter whose username is embedded in either string.
 *
 * @param {string|null|undefined} remoteUrl e.g. "ssh://user@host/data/studies/some-study"
 * @param {string|null|undefined} studiesServerHost the configured Setup → Server Host (SSH) value
 * @returns {boolean}
 */
export function isSharedStudiesServerRemote(remoteUrl, studiesServerHost) {
  if (!remoteUrl || !studiesServerHost) {
    return false
  }

  const hostname = studiesServerHost.trim().split('@').pop()
  if (!hostname) {
    return false
  }

  return remoteUrl.includes(hostname)
}

export function computeSyncActionsQuietMessage(classification, health) {
  const datasetGating = computeDatasetGating(classification, health)
  const remoteGating = computeRemoteGating(health)
  const allDisabled = datasetGating.disabled && remoteGating.update.disabled && remoteGating.publish.disabled

  if (!allDisabled) {
    return null
  }

  const isDataLadDataset = classification === 'dataset' || classification === 'superdataset'

  return isDataLadDataset
    ? 'Nothing to sync right now — add a remote to enable Update/Publish, or Get Data once files have missing content.'
    : 'Nothing to sync right now — add a remote to enable Update and Publish.'
}
