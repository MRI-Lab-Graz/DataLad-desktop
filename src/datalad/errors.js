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
  const details = stderr.trim()

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