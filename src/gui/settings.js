import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const REAL_OVERRIDE_PATH = join(__dirname, '..', '..', 'config', 'studies-server.local.json')

// This project is public, so no lab's real server belongs in tracked source.
// An untracked config/studies-server.local.json (see .gitignore and
// config/studies-server.local.example.json) lets a specific deployment (e.g.
// the MRI-Lab's own checkout) preset host/path without publishing them —
// everyone else gets empty defaults, same as before.
export function loadLocalDefaultOverrides(overridePath = REAL_OVERRIDE_PATH) {
  try {
    const raw = readFileSync(overridePath, 'utf8')
    const parsed = JSON.parse(raw)
    return { host: parsed.host ?? '', path: parsed.path ?? '' }
  } catch {
    return { host: '', path: '' }
  }
}

export class SettingsStore {
  constructor({ filePath, defaultStudiesServer = loadLocalDefaultOverrides() }) {
    this.filePath = filePath
    this.defaults = { studiesServer: defaultStudiesServer }
  }

  async get() {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      return {
        studiesServer: {
          ...this.defaults.studiesServer,
          ...(parsed.studiesServer ?? {})
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return structuredClone(this.defaults)
      }
      throw error
    }
  }

  async update(partial) {
    const current = await this.get()
    const next = {
      studiesServer: {
        ...current.studiesServer,
        ...(partial?.studiesServer ?? {})
      }
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
    return next
  }
}

export function createSettingsStore(userDataPath) {
  return new SettingsStore({ filePath: join(userDataPath, 'settings.json') })
}
