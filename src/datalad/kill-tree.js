import { spawn } from 'node:child_process'
import { join } from 'node:path'

// Abort reason used when the app is quitting: there is no later moment to
// escalate to SIGKILL, so the kill must be immediate.
export const QUIT_ABORT_REASON = 'app-quit'

// Kills `child` and everything it spawned.
// POSIX: the child was spawned `detached`, so it leads its own process group.
// SIGTERM the group first (git and git-annex remove their own .git/index.lock on
// SIGTERM), then SIGKILL after graceMs for anything that ignores it.
// Windows has no graceful equivalent for console processes: taskkill /T /F.
export function killProcessTree(child, graceMs = 3000) {
  if (child.pid === undefined) {
    return
  }

  if (process.platform === 'win32') {
    // By absolute path: a bare name would be looked up in places a dataset can write to.
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {})
    return
  }

  signalGroup(child.pid, 'SIGTERM')
  if (graceMs <= 0) {
    signalGroup(child.pid, 'SIGKILL')
    return
  }

  // Deliberately not cleared when the direct child closes: other members of the
  // group (a git-annex helper that ignores SIGTERM) may outlive it. Signalling
  // a group that is already gone is a harmless ESRCH.
  setTimeout(() => signalGroup(child.pid, 'SIGKILL'), graceMs).unref()
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group is already gone.
  }
}
