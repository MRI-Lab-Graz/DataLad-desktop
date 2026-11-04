import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareVersions, parseVersion } from './validator-update.js'
import { resolveTool } from './resolve-tool.js'

// Information only: nothing is downloaded or installed from here.
const TOOLS = [
  {
    tool: 'datalad',
    name: 'DataLad',
    args: ['--version'],
    url: 'https://pypi.org/pypi/datalad/json',
    latestOf: (j) => j?.info?.version
  },
  {
    tool: 'git-annex',
    name: 'git-annex',
    args: ['version'],
    url: 'https://formulae.brew.sh/api/formula/git-annex.json',
    latestOf: (j) => j?.versions?.stable
  }
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

async function oneNotice({ tool, name, args, url, latestOf }, { runner, fetchJson, resolve, skipped }) {
  try {
    const path = resolve(tool)
    if (!path) return null
    const run = await runner(path, args, {})
    const installed = run.failed ? null : parseVersion(run.stdout)
    const latest = parseVersion(String(latestOf(await fetchJson(url)) ?? ''))
    if (!installed || !latest || compareVersions(installed, latest) >= 0) return null
    if (skipped[tool] === latest) return null
    const how = /\/cellar\/|\/homebrew\/|\/usr\/local\//i.test(path.replaceAll('\\', '/'))
      ? `Update it with: brew upgrade ${tool}`
      : 'Update it the same way you installed it.'
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
  const all = await Promise.all(TOOLS.map((t) => oneNotice(t, { runner, fetchJson, resolve, skipped })))
  return all.filter(Boolean)
}

export async function skipNotice({ userDataDir, tool, version }) {
  const skipped = { ...(await readSkipped(userDataDir)), [tool]: version }
  await mkdir(userDataDir, { recursive: true })
  await writeFile(join(userDataDir, FILE), JSON.stringify({ skipped }))
}
