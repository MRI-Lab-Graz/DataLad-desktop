/**
 * Quote-aware whitespace tokenizer. There is no shell involved anywhere in the
 * console command path, so shell metacharacters (&&, |, $(), backticks) are
 * inert literal argv characters here, not a parsing concern.
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

export function buildConsoleCommand({ commandText, projectPath } = {}) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('projectPath is required to run a console command')
  }

  const [binary, ...args] = tokenizeCommand(commandText ?? '')
  if (!binary) {
    throw new Error('Enter a command to run')
  }

  return {
    command: binary,
    args,
    options: { cwd: projectPath }
  }
}
