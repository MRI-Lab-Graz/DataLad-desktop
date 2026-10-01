import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { killProcessTree, QUIT_ABORT_REASON } from './kill-tree.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// ssh (and anything shelling out to it, like datalad/git-annex over ssh://)
// normally refuses password auth entirely when stdin isn't a terminal — this
// is the standard OpenSSH-supported way to supply one anyway: SSH_ASKPASS
// is invoked in place of a terminal prompt when SSH_ASKPASS_REQUIRE=force
// (OpenSSH 8.4+), no tty or X11 DISPLAY needed.
// Packaged builds run from inside app.asar, a virtual archive only Electron's
// own Node can read — ssh.exe is a plain external process and can't open a
// path through it, so the script has to be pulled out of the archive at
// build time (see build.asarUnpack in package.json) and referenced there.
export function outsideAsar(path) {
  return path.replace(/([\\/]app\.asar)([\\/])/, '$1.unpacked$2')
}

const SSH_ASKPASS_SCRIPT = outsideAsar(
  join(__dirname, process.platform === 'win32' ? 'ssh-askpass.cmd' : 'ssh-askpass.sh')
)

// git acquires .git/index.lock atomically before any mutation, so a command
// that fails to acquire it never partially ran — a retry after a short
// backoff is safe. This fires when two of our own child processes race
// against the same repo (e.g. a background status refresh overlapping a
// multi-step automated sequence like BIDS nesting), not just from truly
// external tools.
const INDEX_LOCK_PATTERN = /unable to create '.*\.lock'.*file exists/i
const MAX_LOCK_RETRIES = 4
const LOCK_RETRY_BASE_DELAY_MS = 150
const CANCELLED_EXIT_CODE = 130
const DEFAULT_KILL_GRACE_MS = 3000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Progress bars redraw with \r, so split on both; only the latest visible line
// of a chunk matters for the activity display. A line split across two chunks
// is shown as two partial lines - acceptable for a status hint.
function latestLine(chunk) {
  return String(chunk)
    .split(/[\r\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1)
}

/**
 * Small shell boundary used by the adapter so UI layers can stay command-agnostic.
 */
export class ProcessRunner {
  // In-memory only, for the running session — never written to disk. Set via
  // the Setup panel's SSH password dialog when the studies server requires
  // password (not key-based) auth.
  #sshPassword = null

  setSshPassword(password) {
    this.#sshPassword = password || null
  }

  clearSshPassword() {
    this.#sshPassword = null
  }

  hasSshPassword() {
    return this.#sshPassword !== null
  }

  #envWithSshPassword(baseEnv) {
    if (!this.#sshPassword) {
      return baseEnv
    }
    return {
      ...baseEnv,
      SSH_ASKPASS: SSH_ASKPASS_SCRIPT,
      SSH_ASKPASS_REQUIRE: 'force',
      DATALAD_DESKTOP_SSH_PASSWORD: this.#sshPassword
    }
  }

  async run(command, args = [], options = {}) {
    const startedAt = Date.now()

    for (let attempt = 0; ; attempt += 1) {
      const result = await this.#runOnce(command, args, options)

      if (
        result.failed &&
        !result.cancelled &&
        attempt < MAX_LOCK_RETRIES &&
        INDEX_LOCK_PATTERN.test(result.stderr)
      ) {
        await sleep(LOCK_RETRY_BASE_DELAY_MS * (attempt + 1))
        continue
      }

      return { ...result, durationMs: Date.now() - startedAt }
    }
  }

  async #runOnce(command, args, options) {
    const { signal, timeoutMs, killGraceMs = DEFAULT_KILL_GRACE_MS, onOutput } = options

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      let cancelled = false
      const timers = []

      function finish(result) {
        if (settled) {
          return
        }
        settled = true
        timers.forEach(clearTimeout)
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }

      const cancelledResult = () => ({
        command,
        args,
        exitCode: CANCELLED_EXIT_CODE,
        stdout,
        stderr,
        failed: true,
        cancelled: true
      })

      function onAbort() {
        if (settled || cancelled) {
          return
        }
        // The command already finished (only a helper still holds its output pipes
        // open): its real result stands, there is nothing left to cancel.
        if (child.exitCode !== null || child.signalCode !== null) {
          return
        }
        cancelled = true
        killProcessTree(child, signal?.reason === QUIT_ABORT_REASON ? 0 : killGraceMs)
        // `close` normally settles us once the tree is dead; this is the
        // failsafe for a kill that never lands (e.g. taskkill failing).
        timers.push(setTimeout(() => finish(cancelledResult()), killGraceMs + 1000))
      }

      if (signal?.aborted) {
        finish(cancelledResult())
        return
      }

      const child = spawn(command, args, {
        cwd: options.cwd,
        env: this.#envWithSshPassword({ ...process.env, ...(options.env ?? {}) }),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: options.shell ?? false,
        // POSIX: lead our own process group so cancel/timeout can signal the whole tree.
        detached: process.platform !== 'win32'
      })

      signal?.addEventListener('abort', onAbort, { once: true })

      // Opt-in: clone/get/push legitimately run for minutes, so only probes
      // that must return promptly pass timeoutMs.
      if (timeoutMs) {
        timers.push(
          setTimeout(() => {
            killProcessTree(child, killGraceMs)
            finish({
              command,
              args,
              exitCode: 124,
              stdout,
              stderr: `${stderr}\n${command} timed out after ${timeoutMs}ms`.trim(),
              failed: true
            })
          }, timeoutMs)
        )
      }

      const report = (chunk) => {
        const line = onOutput ? latestLine(chunk) : undefined
        if (line) {
          onOutput(line)
        }
      }

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
        report(chunk)
      })

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
        report(chunk)
      })

      child.on('error', (error) => {
        finish({
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
        if (cancelled) {
          finish(cancelledResult())
          return
        }
        finish({
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
