import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const DEFAULT_SETTINGS = {
  studiesServer: { host: '', path: '' }
}

export class SettingsStore {
  constructor({ filePath }) {
    this.filePath = filePath
  }

  async get() {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      return {
        studiesServer: {
          ...DEFAULT_SETTINGS.studiesServer,
          ...(parsed.studiesServer ?? {})
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return structuredClone(DEFAULT_SETTINGS)
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
