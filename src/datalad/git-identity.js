// Git author identity (user.name / user.email) in the *global* git config, so the
// app and the user's terminal share one source of truth. Takes a `run(command, args)`
// function (ProcessRunner-shaped) so it is independent of the adapter.

const MAX_NAME = 200
const MAX_EMAIL = 254

async function readKey(run, key) {
  const result = await run('git', ['config', '--global', '--get', key])
  if (result.error || result.exitCode === null) {
    return { available: false, value: '' }
  }
  // exit 1 = key unset, which is a normal state, not an error
  return { available: true, value: result.failed ? '' : result.stdout.trim() }
}

export async function getGitIdentity(run) {
  const [name, email] = await Promise.all([readKey(run, 'user.name'), readKey(run, 'user.email')])
  const available = name.available && email.available
  return {
    available,
    name: name.value,
    email: email.value,
    complete: available && Boolean(name.value && email.value)
  }
}

function validate({ name, email }) {
  // Leading '-' is rejected so user text can never be parsed as a git flag.
  if (!name || name.length > MAX_NAME || name.startsWith('-') || /[\u0000-\u001f\u007f]/.test(name)) {
    return 'Enter your name (up to 200 characters, no line breaks, not starting with "-").'
  }
  if (email.length > MAX_EMAIL || email.startsWith('-') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Enter a valid email address, like jane@lab.org.'
  }
  return null
}

export async function setGitIdentity(run, input) {
  const name = String(input?.name ?? '').trim()
  const email = String(input?.email ?? '').trim()

  const error = validate({ name, email })
  if (error) {
    return { ok: false, error }
  }

  for (const [key, value] of [['user.name', name], ['user.email', email]]) {
    const result = await run('git', ['config', '--global', key, value])
    if (result.failed) {
      return { ok: false, error: result.stderr?.trim() || `Git could not save ${key}.` }
    }
  }

  return { ok: true, identity: await getGitIdentity(run) }
}
