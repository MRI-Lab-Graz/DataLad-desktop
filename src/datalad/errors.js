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