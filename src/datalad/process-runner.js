import { spawn } from 'node:child_process'

/**
 * Small shell boundary used by the adapter so UI layers can stay command-agnostic.
 */
export class ProcessRunner {
  async run(command, args = [], options = {}) {
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