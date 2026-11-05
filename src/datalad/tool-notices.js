import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareVersions, parseVersion } from './validator-update.js'
import { resolveTool } from './resolve-tool.js'

// Information only: nothing is downloaded or installed from here.
const brewFeed = (tool) => ({ url: `https://formulae.brew.sh/api/formula/${tool}.json`, latestOf: (j) => j?.versions?.stable })
const TOOLS = [
  {
    tool: 'datalad',
    name: 'DataLad',
    args: ['--version'],
    // A Homebrew DataLad is compared with what Homebrew ships, not with PyPI (which can be ahead).
    feed: (brew) => (brew ? brewFeed('datalad') : { url: 'https://pypi.org/pypi/datalad/json', latestOf: (j) => j?.info?.version })
  },
  { tool: 'git-annex', name: 'git-annex', args: ['version'], feed: () => brewFeed('git-annex') }
]
const FILE = 'update-notices.json'

async function readSkipped(userDataDir) {
  try {
    const s = JSON.parse(await readFile(join(userDataDir, FILE), 'utf8'))?.skipped
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

async function oneNotice({ tool, name, args, feed }, { runner, fetchJson, resolve, skipped, platform }) {
  try {
    // Windows: the install script ships a tested git-annex pinned with this DataLad; the app cannot update it.
    if (tool === 'git-annex' && platform === 'win32') return null
    const path = resolve(tool)
    if (!path) return null
    // The app's own installer put this DataLad there and pins it: nothing the user can do.
    if (tool === 'datalad' && /[\\/]datalad-env[\\/]/i.test(path)) return null
    const brew = platform === 'darwin' && /\/cellar\/|\/homebrew\/|\/usr\/local\//i.test(path)
    const { url, latestOf } = feed(brew)
    const run = await runner(path, args, { timeoutMs: 15000 })
    const installed = run.failed ? null : parseVersion(run.stdout)
    const latest = parseVersion(String(latestOf(await fetchJson(url)) ?? ''))
    if (!installed || !latest || compareVersions(installed, latest) >= 0) return null
    if (skipped[tool] === latest) return null
    const how = brew ? `Update it with: brew upgrade ${tool}` : 'Update it the same way you installed it.'
    return {
      tool,
      installed,
      latest,
      message: `A newer version of ${name} is available (${latest}). You have ${installed}.\n${how}`
    }
  } catch {
    return null
  }
}

export async function collectNotices({ runner, fetchJson, userDataDir, platform = process.platform, resolve = (n) => resolveTool(n, { platform }) }) {
  const skipped = await readSkipped(userDataDir)
  const all = await Promise.all(TOOLS.map((t) => oneNotice(t, { runner, fetchJson, resolve, skipped, platform })))
  return all.filter(Boolean)
}

// Ignores anything but a known tool and a plain version number (the value comes from the renderer).
export async function skipNotice({ userDataDir, tool, version }) {
  if (!TOOLS.some((t) => t.tool === tool) || typeof version !== 'string' || parseVersion(version) !== version) return
  const skipped = { ...(await readSkipped(userDataDir)), [tool]: version }
  await mkdir(userDataDir, { recursive: true })
  await writeFile(join(userDataDir, FILE), JSON.stringify({ skipped }))
}
