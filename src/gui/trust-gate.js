import { readdir } from 'node:fs/promises'
import { describeVectors } from './folder-trust.js'

// A missing folder or one with no entries has nothing foreign in it.
export async function isEmptyOrMissing(path) {
  try {
    return (await readdir(path)).length === 0
  } catch (error) {
    return error.code === 'ENOENT'
  }
}

const BUTTONS = ['Cancel', 'Trust this folder', 'Trust everything inside this folder']

export function describeTrustPrompt({ path, kind, vectors }) {
  const found =
    vectors.length > 0
      ? `What the app found there (advice, not a verdict):\n${describeVectors(vectors)}`
      : 'Nothing unusual was found, but this app cannot prove a folder is safe. Only trust folders from people you trust.'
  return kind === 'remote'
    ? { title: 'Push to this folder?', message: 'Pushing to this folder runs programs stored in it.', detail: `${path}\n\n${found}`, buttons: BUTTONS }
    : { title: 'Only open folders you trust', message: 'This folder can run programs on your computer.', detail: `${path}\n\n${found}`, buttons: BUTTONS }
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
