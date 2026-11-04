import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolveTool } from '../src/datalad/resolve-tool.js'

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export function stepRunner({ getPage, outDir }) {
  return async (name, fn) => {
    try {
      await fn()
    } catch (err) {
      try {
        await getPage()?.screenshot({ path: join(outDir, `${slug(name)}.png`) })
      } catch {}
      throw err
    }
  }
}

// Same lookup as the app (Homebrew folders, .exe/.com only on Windows).
const onPath = (cmd) => resolveTool(cmd) !== null

// git-annex leaves read-only objects; make everything writable first (POSIX only; Windows needs no chmod).
export async function removeTree(dir) {
  if (process.platform !== 'win32') {
    try { execFileSync('chmod', ['-R', 'u+w', dir], { stdio: 'ignore' }) } catch {}
  }
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 5 })
  } catch (err) {
    console.warn(`walkthrough: could not remove ${dir}: ${err.message}`)
  }
}

export function requireTools(which = onPath) {
  const missing = ['datalad', 'git-annex', 'git'].filter((t) => !which(t))
  if (missing.length) {
    throw new Error(`datalad and git-annex must be on PATH to run the walkthrough (missing: ${missing.join(', ')})`)
  }
}
