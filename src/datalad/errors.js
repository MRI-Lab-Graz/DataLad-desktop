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
  if (
    commandName === 'createProject' &&
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

  if (commandName === 'createBranch' && hasPattern(stderr, /already exists/)) {
    return {
      code: 'BRANCH_EXISTS',
      title: 'Branch already exists',
      message: 'A branch with this name already exists. Pick a different name or switch to the existing branch.',
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
    (commandName === 'createBranch' || commandName === 'switchBranch') &&
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
    (commandName === 'update' || commandName === 'switchBranch' || commandName === 'createBranch') &&
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

  return {
    ...DEFAULT_ERROR,
    technicalDetails: details
  }
}