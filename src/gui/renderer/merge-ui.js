// Pure logic behind the Merge controls and the merge banner. DOM wiring is in app.js.

// git-annex's own "adjusted/<branch>(unlocked)" branches (Windows) are internal; merging one is never what is meant.
const ADJUSTED = /^adjusted\/.+\(\w+\)$/

export function mergeCandidates(branches, currentBranch) {
  return branches.filter((branch) => branch !== currentBranch && !ADJUSTED.test(branch))
}

// A refresh rebuilds the picker; keep what the user chose unless it is gone.
export function mergeSelection(candidates, previous) {
  return candidates.includes(previous) ? previous : (candidates[0] ?? '')
}

// Why a merge cannot start right now, in researcher language, or null. Untracked files do not count: git itself
// refuses (and names them) only when one would be overwritten.
export function mergeBlockReason({ branchName, currentBranch, detachedHead, snapshot }) {
  if (detachedHead || !currentBranch) {
    return 'Switch to a branch before merging.'
  }
  if (!branchName) {
    return 'Pick the branch to merge in first.'
  }
  if (snapshot?.mergeInProgress) {
    return 'Finish or cancel the current merge first.'
  }
  if (snapshot && snapshot.stagedCount + snapshot.unstagedCount > 0) {
    return 'Save your changes first, then merge.'
  }
  return null
}

export function mergeBannerModel(snapshot, currentBranch) {
  if (!snapshot?.mergeInProgress) {
    return { visible: false }
  }
  const other = snapshot.mergeBranch ?? 'the other branch'
  const conflicted = snapshot.conflicts ?? []
  return {
    visible: true,
    title: `Merging ${snapshot.mergeBranch ?? 'the other branch'} into ${currentBranch ?? 'this branch'}`,
    summary:
      conflicted.length === 0
        ? 'Everything is decided. Finish the merge to save it.'
        : `${conflicted.length} file${conflicted.length === 1 ? '' : 's'} to decide`,
    canFinish: conflicted.length === 0,
    conflicts: conflicted.map((file) => ({
      path: file.path,
      oursLabel: file.sides?.ours === false ? 'Keep it deleted' : "Keep this branch's version",
      theirsLabel: file.sides?.theirs === false ? 'Keep it deleted' : `Keep ${other}'s version`
    }))
  }
}

// Electron wraps a main-process error as "Error invoking remote method '<channel>': Error: <message>".
export function friendlyIpcError(error) {
  const message = String(error?.message ?? error ?? '').replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
  return message || 'Could not resolve that file.'
}
