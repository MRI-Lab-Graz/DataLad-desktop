/**
 * Quote-aware whitespace tokenizer used for the no-shell (macOS/Linux) console
 * path. Shell metacharacters (&&, |, $(), backticks) are inert literal argv
 * characters here, not a parsing concern, since there is no shell involved.
 */
export function tokenizeCommand(input) {
  if (typeof input !== 'string') {
    return []
  }

  const tokens = []
  let current = ''
  let inToken = false
  let quoteChar = null

  for (const char of input) {
    if (quoteChar) {
      if (char === quoteChar) {
        quoteChar = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quoteChar = char
      inToken = true
      continue
    }

    if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current)
        current = ''
        inToken = false
      }
      continue
    }

    current += char
    inToken = true
  }

  if (quoteChar) {
    throw new Error('Unterminated quote in command arguments')
  }

  if (inToken) {
    tokens.push(current)
  }

  return tokens
}

export function buildConsoleCommand({ commandText, projectPath, platform = process.platform } = {}) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('projectPath is required to run a console command')
  }

  const trimmedCommandText = (commandText ?? '').trim()
  if (!trimmedCommandText) {
    throw new Error('Enter a command to run')
  }

  if (platform === 'win32') {
    // Windows can't directly spawn .cmd/.bat shims (npm, npx, yarn, ...)
    // without a shell. Hand the raw line to cmd.exe so it behaves exactly
    // like a normal Windows terminal, shell operators included.
    return {
      command: trimmedCommandText,
      args: [],
      options: { cwd: projectPath, shell: true }
    }
  }

  const [binary, ...args] = tokenizeCommand(trimmedCommandText)
  return {
    command: binary,
    args,
    options: { cwd: projectPath, shell: false }
  }
}
