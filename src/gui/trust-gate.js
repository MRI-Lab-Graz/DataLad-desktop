import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describeVectors } from './folder-trust.js'

// A missing folder or one with no entries has nothing foreign in it.
// 'unreadable' (no permission, and the like) is not "has files": the user should be told to fix permissions.
export async function folderState(path) {
  try {
    return (await readdir(path)).length === 0 ? 'empty' : 'has-files'
  } catch (error) {
    if (error.code === 'ENOENT') {
      return 'missing'
    }
    return error.code === 'ENOTDIR' ? 'has-files' : 'unreadable'
  }
}

export async function isEmptyOrMissing(path) {
  return ['empty', 'missing'].includes(await folderState(path))
}

// The path is shown the way the folder really is: ".." resolved, control and bidi characters removed, and kept
// short with both ends visible. A folder name from an archive must not be able to reorder or hide what the prompt says.
const MAX_PATH = 300
function cleanPath(path) {
  const flat = resolve(String(path)).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()
  return flat.length > MAX_PATH ? `${flat.slice(0, 60)}…${flat.slice(-(MAX_PATH - 61))}` : flat
}

const BUTTONS = ['Cancel', 'Trust this folder', 'Trust everything inside this folder']

export function describeTrustPrompt({ path, kind, vectors }) {
  const shown = cleanPath(path)
  const found =
    vectors.length > 0
      ? `What the app found there (advice, not a verdict):\n${describeVectors(vectors)}`
      : 'Nothing unusual was found, but this app cannot prove a folder is safe. Only trust folders from people you trust.'
  return kind === 'remote'
    ? { title: 'Push to this folder?', message: 'Pushing to this folder runs programs stored in it.', detail: `${shown}\n\n${found}`, buttons: BUTTONS }
    : { title: 'Only open folders you trust', message: 'This folder can run programs on your computer.', detail: `${shown}\n\n${found}`, buttons: BUTTONS }
}

// The one place a folder becomes a project root: authorize() is only ever called here, after the folder is
// trusted. The scan is advice for the prompt and the change detector for later opens; it does not decide.
export function createTrustGate({ store, scan, ask, authorize }) {
  return {
    async require(path, { kind = 'folder', event } = {}) {
      if (typeof path !== 'string' || !path.trim()) {
        throw new Error('Choose a folder first.')
      }
      const done = () => {
        if (kind === 'folder') {
          authorize(path)
        }
      }
      if (store.covers(path)) {
        return done()
      }
      const vectors = await scan(path, kind)
      if (store.decide(path, vectors).trusted) {
        return done()
      }
      const answer = await ask({ path, kind, vectors, event })
      if (answer !== 'folder' && answer !== 'tree') {
        throw new Error(kind === 'remote' ? 'Not pushed: the remote folder was not trusted.' : 'Folder not opened: it was not trusted.')
      }
      store.trust(path, { scope: answer, vectors })
      return done()
    },
    createdByApp(path) {
      store.trust(path, { scope: 'folder', vectors: [] })
      authorize(path)
    }
  }
}
