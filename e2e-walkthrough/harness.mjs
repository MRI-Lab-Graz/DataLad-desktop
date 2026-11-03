import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

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

const onPath = (cmd) => !spawnSync(cmd, ['--version']).error

export function requireTools(which = onPath) {
  const missing = ['datalad', 'git-annex', 'git'].filter((t) => !which(t))
  if (missing.length) {
    throw new Error(`datalad and git-annex must be on PATH to run the walkthrough (missing: ${missing.join(', ')})`)
  }
}
