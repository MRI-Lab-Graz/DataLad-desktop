import { readFileSync, writeFileSync } from 'node:fs'

// The console runs any command, so the renderer's toggle is only a request: the main process turns it
// on after a native yes, remembered in a file only the main process writes. The saved power-user setting
// still works across launches (the renderer re-requests it at startup), but a page that never got a
// native yes starts from no file and has to ask. Turning the console off forgets the yes.
export function createConsoleConsent({ file }) {
  const remembered = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')).confirmed === true
    } catch {
      return false
    }
  }
  const remember = (confirmed) => {
    try {
      writeFileSync(file, JSON.stringify({ confirmed }))
    } catch {
      // unwritable: the user is simply asked again next time
    }
  }
  return {
    async allow(wanted, confirm) {
      if (!wanted) {
        remember(false)
        return false
      }
      if (remembered()) {
        return true
      }
      if (!(await confirm())) {
        return false
      }
      remember(true)
      return true
    }
  }
}
