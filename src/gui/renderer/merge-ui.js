// Pure logic behind the Merge controls and the merge banner. DOM wiring is in app.js.

export function mergeCandidates(branches, currentBranch) {
  return branches.filter((branch) => branch !== currentBranch)
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
  const conflicted = (snapshot.files ?? []).filter((file) => file.conflicted)
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
