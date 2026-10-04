import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { killProcessTree, QUIT_ABORT_REASON } from './kill-tree.js'
import { resolveTool } from './resolve-tool.js'

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
// A dataset with millions of files must not be able to exhaust the app's memory.
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024
const OUTPUT_LIMIT_EXIT_CODE = 125

// Only the stock git-annex hooks ever run: a repository's own hooks (from a zip, a USB stick,
// a nested repo the scanner never saw) are ignored. Packaged: resources/git-hooks (git cannot
// run a script inside app.asar); dev/tests: build/git-hooks.
export function resolveHooksDir({ resourcesPath = process.resourcesPath, exists = existsSync } = {}) {
  const packaged = resourcesPath ? join(resourcesPath, 'git-hooks') : null
  return packaged && exists(packaged) ? packaged : fileURLToPath(new URL('../../build/git-hooks', import.meta.url))
}
export const HOOKS_DIR = resolveHooksDir()

// safe.bareRepository=explicit: git only uses a repository it finds as `.git` (or is told about). A folder
// that merely looks like a bare git directory could otherwise name a work tree elsewhere and bring its own
// filters and attributes. Pushing to or cloning from bare remotes does not go through discovery.
// Hardening applied to every child: file names are never git pathspec patterns,
// a repo's own .git/config cannot make `git status` run a program, only the stock git-annex
// hooks run, and datalad never runs procedures a dataset ships.
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const [key, value] of [['core.fsmonitor', 'false'], ['core.hooksPath', HOOKS_DIR], ['safe.bareRepository', 'explicit']]) {
    const n = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0
    env[`GIT_CONFIG_KEY_${n}`] = key
    env[`GIT_CONFIG_VALUE_${n}`] = value
    env.GIT_CONFIG_COUNT = String(n + 1)
  }
  env.GIT_LITERAL_PATHSPECS = '1'
  // A dataset can ship .datalad/procedures/cfg_<name> that datalad prefers over its own
  // (create -c text2git --force on an adopted dataset ran it). Point the dataset-procedures
  // location at a file: nothing can be found "inside" it.
  env.DATALAD_LOCATIONS_DATASET__PROCEDURES = process.execPath
  // A dataset's committed .datalad/config can name datalad.clone.reckless (e.g. shared-0777, which
  // makes every subdataset's .git world-writable); an empty environment value overrides it.
  env.DATALAD_CLONE_RECKLESS = ''
  env.NoDefaultCurrentDirectoryInExePath = '1'
  return env
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
  #resolve

  constructor({ resolve = resolveTool } = {}) {
    this.#resolve = resolve
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
    const { signal, timeoutMs, killGraceMs = DEFAULT_KILL_GRACE_MS, onOutput, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES } = options

    // Bare names are looked up on PATH ourselves: Windows would otherwise try the
    // (dataset-controlled) cwd first. A shell line is the console's business.
    const bare = !options.shell && !/[\\/]/.test(command)
    const exe = bare ? this.#resolve(command) : null
    const notFound = bare && !exe

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

      if (notFound) {
        finish({
          command,
          args,
          exitCode: 127,
          stdout,
          stderr: `${command} not found on PATH`,
          failed: true
        })
        return
      }

      const child = spawn(exe ?? command, args, {
        cwd: options.cwd,
        env: childEnv(options.env),
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

      let received = 0
      const accept = (chunk) => {
        received += chunk.length
        if (received > maxOutputBytes) {
          killProcessTree(child, killGraceMs)
          finish({
            command,
            args,
            exitCode: OUTPUT_LIMIT_EXIT_CODE,
            stdout: '',
            stderr: `${command} output exceeded ${maxOutputBytes} bytes and was stopped`,
            failed: true
          })
          return false
        }
        return true
      }

      child.stdout.on('data', (chunk) => {
        if (accept(chunk)) {
          stdout += String(chunk)
          report(chunk)
        }
      })

      child.stderr.on('data', (chunk) => {
        if (accept(chunk)) {
          stderr += String(chunk)
          report(chunk)
        }
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
