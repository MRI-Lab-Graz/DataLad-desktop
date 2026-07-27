import { spawn } from 'node:child_process'

// git acquires .git/index.lock atomically before any mutation, so a command
// that fails to acquire it never partially ran — a retry after a short
// backoff is safe. This fires when two of our own child processes race
// against the same repo (e.g. a background status refresh overlapping a
// multi-step automated sequence like BIDS nesting), not just from truly
// external tools.
const INDEX_LOCK_PATTERN = /unable to create '.*\.lock'.*file exists/i
const MAX_LOCK_RETRIES = 4
const LOCK_RETRY_BASE_DELAY_MS = 150

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Small shell boundary used by the adapter so UI layers can stay command-agnostic.
 */
export class ProcessRunner {
  async run(command, args = [], options = {}) {
    const startedAt = Date.now()

    for (let attempt = 0; ; attempt += 1) {
      const result = await this.#runOnce(command, args, options)

      if (result.failed && attempt < MAX_LOCK_RETRIES && INDEX_LOCK_PATTERN.test(result.stderr)) {
        await sleep(LOCK_RETRY_BASE_DELAY_MS * (attempt + 1))
        continue
      }

      return { ...result, durationMs: Date.now() - startedAt }
    }
  }

  async #runOnce(command, args, options) {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false

      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: options.shell ?? false
      })

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })

      child.on('error', (error) => {
        if (settled) {
          return
        }
        settled = true
        resolve({
          command,
          args,
          exitCode: 127,
          stdout,
          stderr: stderr || String(error.message),
          failed: true,
          error
        })
      })

      child.on('close', (exitCode) => {
        if (settled) {
          return
        }
        settled = true
        resolve({
          command,
          args,
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          failed: (exitCode ?? 1) !== 0
        })
      })
    })
  }
}