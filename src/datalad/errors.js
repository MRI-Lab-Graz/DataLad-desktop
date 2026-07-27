const DEFAULT_ERROR = {
  code: 'UNKNOWN',
  title: 'DataLad command failed',
  message:
    'DataLad Desktop could not finish this action. Please try again or review the technical details.',
  technicalDetails: ''
}

function hasPattern(text, pattern) {
  return pattern.test((text ?? '').toLowerCase())
}

/**
 * Map low-level command failures into researcher-friendly UI copy.
 */
export function mapCommandError(commandName, runResult) {
  const stderr = runResult.stderr ?? ''
  const stdout = runResult.stdout ?? ''
  const details = stderr.trim()

  // datalad prints this particular failure as a create(error) result line on
  // stdout, not stderr, so this one check needs to look at both streams.
  // Guarded on --force not being present: BIDS mode intentionally passes
  // --force to adopt an already-non-empty folder, so that case must not be
  // mapped as "choose an empty folder" — see the branch below instead.
  if (
    commandName === 'createProject' &&
    !(runResult.args ?? []).includes('--force') &&
    hasPattern(`${stdout}\n${stderr}`, /not empty|non-empty|already exists|refuse to create/)
  ) {
    return {
      code: 'TARGET_NOT_EMPTY',
      title: 'Folder already has content',
      message:
        'DataLad will not create a new project inside a folder that already has files in it. Choose an empty or brand-new folder.',
      technicalDetails: details || stdout.trim()
    }
  }

  if (
    (commandName === 'createProject' || commandName === 'createSubdataset') &&
    (runResult.args ?? []).includes('--force') &&
    hasPattern(`${stdout}\n${stderr}`, /not empty|non-empty|already exists|refuse to create/)
  ) {
    return {
      code: 'FORCE_CREATE_FAILED',
      title: 'Could not set up this folder',
      message:
        'DataLad could not initialize this folder even with an existing-content override. Review the technical details below.',
      technicalDetails: details || stdout.trim()
    }
  }

  if ((commandName === 'createBranch' || commandName === 'createBranchAt') && hasPattern(stderr, /already exists/)) {
    return {
      code: 'BRANCH_EXISTS',
      title: 'Branch already exists',
      message: 'A branch with this name already exists. Pick a different name or switch to the existing branch.',
      technicalDetails: details
    }
  }

  if (
    (commandName === 'createBranchAt' || commandName === 'restoreFileFromCommit') &&
    hasPattern(stderr, /unknown revision|not a valid object name|bad object|could not resolve/)
  ) {
    return {
      code: 'INVALID_START_POINT',
      title: 'Save point not found',
      message: 'The selected save point could not be found in this project\'s history.',
      technicalDetails: details
    }
  }

  if (commandName === 'restoreFileFromCommit' && hasPattern(stderr, /pathspec|did not match any file/)) {
    return {
      code: 'FILE_NOT_IN_SAVE_POINT',
      title: 'File not found in that save point',
      message:
        'The selected file does not exist in that save point. It may have been added later or had a different name back then.',
      technicalDetails: details
    }
  }

  if (commandName === 'discardChanges' && hasPattern(stderr, /pathspec|did not match any file/)) {
    return {
      code: 'FILE_NOT_TRACKED',
      title: 'File has never been saved',
      message:
        'Changes to this file cannot be discarded because it has never been part of a save point. Delete the file manually if you no longer need it.',
      technicalDetails: details
    }
  }

  if (commandName === 'switchBranch' && hasPattern(stderr, /pathspec|did not match any file|unknown revision/)) {
    return {
      code: 'BRANCH_NOT_FOUND',
      title: 'Branch was not found',
      message: 'The selected branch does not exist in this project.',
      technicalDetails: details
    }
  }

  if (
    (commandName === 'createBranch' || commandName === 'createBranchAt' || commandName === 'switchBranch') &&
    hasPattern(stderr, /local changes|would be overwritten|please commit your changes/)
  ) {
    return {
      code: 'WORKTREE_DIRTY',
      title: 'Please save or stash changes first',
      message:
        'Branch changes are blocked because local edits would be overwritten. Save your work first, then try again.',
      technicalDetails: details
    }
  }

  if (
    (commandName === 'update' || commandName === 'switchBranch' || commandName === 'createBranch' || commandName === 'createBranchAt') &&
    hasPattern(stderr, /conflict|merge conflict|unmerged files|you need to resolve your current index first/)
  ) {
    return {
      code: 'MERGE_CONFLICT',
      title: 'Resolve conflicts before continuing',
      message:
        'This action stopped because merge conflicts were detected. Resolve conflicts, then retry your branch or update action.',
      technicalDetails: details
    }
  }

  // Left behind when a previous git/git-annex process for this project was
  // killed (app crash, force-quit, power loss) mid-operation instead of
  // exiting cleanly and removing its own lock.
  if (hasPattern(stderr, /unable to create.*index\.lock|index\.lock.*file exists|another git process/)) {
    return {
      code: 'REPO_LOCKED',
      title: 'A previous operation left a lock behind',
      message:
        'A previous Save/Update/Publish was interrupted (e.g. the app or your computer was closed mid-operation) and left a lock file in place, which blocks new operations. If no other Git or DataLad process is currently running for this project, it is safe to remove the lock and retry.',
      technicalDetails: details
    }
  }

  if (hasPattern(stderr, /you have not concluded your merge|merge_head exists|merge in progress/)) {
    return {
      code: 'MERGE_IN_PROGRESS',
      title: 'Merge already in progress',
      message:
        'This repository already has an unfinished merge. Finish or abort the merge before running this action.',
      technicalDetails: details
    }
  }

  if (
    commandName === 'cloneInstall' &&
    hasPattern(`${stdout}\n${stderr}`, /not found|no such repository|repository.*not found|failed to clone/)
  ) {
    return {
      code: 'REPO_NOT_FOUND',
      title: 'Repository not found',
      message:
        'DataLad could not find a repository at the provided URL. Check that the URL is correct and the repository is publicly accessible.',
      technicalDetails: details || stdout.trim()
    }
  }

  if (hasPattern(stderr, /command not found|enoent|not recognized/)) {
    return {
      code: 'TOOLING_MISSING',
      title: 'DataLad tooling is not available',
      message:
        'The required DataLad tooling is missing on this system. Install DataLad and git-annex, then try again.',
      technicalDetails: details
    }
  }

  if (hasPattern(stderr, /no configured push target|no sibling|no remote|could not determine remote/)) {
    return {
      code: 'REMOTE_MISSING',
      title: 'No publish destination is configured',
      message:
        'This project does not have a configured remote destination for publishing.',
      technicalDetails: details
    }
  }

  if (hasPattern(stderr, /authentication|permission denied|forbidden|unauthorized/)) {
    return {
      code: 'AUTH_FAILED',
      title: 'Authentication failed',
      message:
        'DataLad Desktop could not authenticate with the remote destination. Check your credentials and try again.',
      technicalDetails: details
    }
  }

  // datalad get prints all error detail to stdout, not stderr
  if (commandName === 'get' && hasPattern(stdout, /forbidden|access denied|unauthorized/)) {
    return {
      code: 'GET_FORBIDDEN',
      title: 'Download access denied',
      message:
        'The data source rejected the download. The dataset may require authentication or a data sibling may need to be enabled first (e.g. run "datalad siblings enable -s <name>" in the Console).',
      technicalDetails: stdout.trim()
    }
  }

  if (commandName === 'get' && hasPattern(stdout, /no publicurl|cannot download content|not available|cannot get|not present/)) {
    return {
      code: 'CONTENT_UNAVAILABLE',
      title: 'Content could not be downloaded',
      message:
        'No configured remote could provide the requested file content. A data sibling may need to be enabled first — use the Console to run "datalad siblings" to list available siblings.',
      technicalDetails: stdout.trim()
    }
  }

  if (commandName === 'get' && hasPattern(stderr, /not available|cannot get|not present/)) {
    return {
      code: 'CONTENT_UNAVAILABLE',
      title: 'Requested content is not available',
      message:
        'The requested file content is currently unavailable from known remotes.',
      technicalDetails: details
    }
  }

  // Unlock needs the actual file content on disk first, unlike Save/Get which can
  // operate on placeholders — so this is the most common way Unlock fails.
  if (commandName === 'unlock' && hasPattern(`${stdout}\n${stderr}`, /not available|content not present|no content present|not present/)) {
    return {
      code: 'CONTENT_NOT_LOCAL',
      title: 'File content is not downloaded yet',
      message:
        'Unlock needs the actual file content on your computer first. Run "Get Data" for this file, then try Unlock again.',
      technicalDetails: (details || stdout.trim())
    }
  }

  return {
    ...DEFAULT_ERROR,
    technicalDetails: details
  }
}