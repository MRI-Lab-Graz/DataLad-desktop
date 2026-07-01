import { watch } from 'node:fs'
import { relative } from 'node:path'
import { shouldIgnorePath } from './watch-ignore.js'
import { createDebouncer } from './refresh-debounce.js'

const DEBOUNCE_DELAY_MS = 400

export function createProjectWatcher({ onChange, delayMs = DEBOUNCE_DELAY_MS } = {}) {
  let watcher = null
  let watchedRoot = null
  const debouncer = createDebouncer(() => {
    if (watchedRoot) {
      onChange(watchedRoot)
    }
  }, delayMs)

  function stop() {
    debouncer.cancel()
    if (watcher) {
      watcher.close()
      watcher = null
    }
    watchedRoot = null
  }

  function start(rootPath) {
    stop()
    if (!rootPath) {
      return { ok: true }
    }

    watchedRoot = rootPath
    try {
      watcher = watch(rootPath, { recursive: true }, (_eventType, filename) => {
        const relativePath = filename ? String(filename) : relative(rootPath, rootPath)
        if (shouldIgnorePath(relativePath)) {
          return
        }
        debouncer.trigger()
      })
      watcher.on('error', () => {
        stop()
      })
      return { ok: true }
    } catch (error) {
      watchedRoot = null
      watcher = null
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  return { start, stop }
}
