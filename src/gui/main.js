import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { access, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DataLadAdapter } from '../datalad/adapter.js'
import { buildConsoleCommand } from '../datalad/console-command.js'
import { createConsoleConsent } from './console-consent.js'
import { getGitIdentity, setGitIdentity } from '../datalad/git-identity.js'
import { createEnsureGuard, describeEnvFailure, ensureEnv, envBin, envStatus, resolveUv } from '../datalad/managed-env.js'
import { gateSave, isConversionSave, isPrismProject } from '../datalad/prism-gate.js'
import { ProcessRunner } from '../datalad/process-runner.js'
import { createResultCounter } from '../datalad/result-counter.js'
import { createProjectWatcher } from './fs-watch.js'
import { listDirectory } from './list-directory.js'
import { initialAuthorizedRoots, isWithinRoots } from './path-confinement.js'
import { loadPolicy, policyFiles } from './policy.js'
import { guardedHandler } from './ipc-guard.js'
import { findExecVectors, findRemoteVectors, localRemotePaths } from './folder-trust.js'
import { createTrustStore } from './trust-store.js'
import { createTrustGate, describeTrustPrompt, isEmptyOrMissing } from './trust-gate.js'
import { createLatestLineThrottle, createRunRegistry } from './run-registry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const adapter = new DataLadAdapter()
const consoleRunner = new ProcessRunner()
const runRegistry = createRunRegistry()
const ensureGuard = createEnsureGuard()
// Packaged: electron-builder copies build/uv to <resources>/uv; dev: build/uv in the repo.
const uvBaseDir = () => (app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', 'build'))
const managedEnvDir = () => join(app.getPath('userData'), 'env')

let activeProjectWatcher = null
// The console executes arbitrary commands, so the renderer's power-user toggle
// alone must not be the only gate — a compromised renderer could skip it. The
// main process tracks the toggle itself and refuses console runs while off.
let consoleEnabled = false
const policy = loadPolicy({
  files: policyFiles({ resourcesDir: app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', 'build') })
})
// fs:* handlers only operate inside roots the user has legitimated: the
// workspace the app started in, folders picked via the native dialog, and
// paths that passed project detection or were created by clone/create.
const authorizedRoots = initialAuthorizedRoots({ cwd: process.cwd(), isPackaged: app.isPackaged })
const APP_NAME = 'DataLad Desktop'
const APP_ICON_PATH = join(__dirname, 'assets', 'icons', 'datalad_desktop.png')
// macOS Dock icons need transparent padding around a smaller squircle (Apple's
// grid), unlike the full-bleed source PNG used for the window/Windows/Linux icon.
const APP_DOCK_ICON_PATH_DARWIN = join(__dirname, 'assets', 'icons', 'datalad_desktop_macos.png')
const APP_RENDERER_URL = pathToFileURL(join(__dirname, 'renderer', 'index.html')).toString()
// Every IPC channel goes through here so only the app's own page can call it.
const handle = (channel, fn) => ipcMain.handle(channel, guardedHandler(APP_RENDERER_URL, fn))
// Runs `run({ signal, onOutput })` as a cancellable, observable run when the
// renderer supplied a runId; otherwise runs it plain, as before.
async function runWithHandle(event, runId, run, { progress = false } = {}) {
  if (runId === undefined) {
    return run({})
  }

  const signal = runRegistry.register(runId)
  const send = (channel, payload) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(channel, payload)
    }
  }
  const activity = createLatestLineThrottle((line) => send('command:activity', { runId, line }))
  // The throttle only ever sends the newest value, which is what a running count needs.
  const counted = progress ? createLatestLineThrottle((done) => send('command:progress', { runId, done })) : null
  const counter = progress ? createResultCounter() : null
  try {
    return await run({
      signal,
      onOutput: activity.push,
      ...(counted ? { onData: (chunk) => counted.push(counter.push(chunk)) } : {})
    })
  } finally {
    activity.stop()
    counted?.stop()
    runRegistry.finish(runId)
  }
}

// Folders the user picked in the native dialog that were empty: only a place for a new project, never a root.
const pickedLocations = new Set()

// E2E has no human: an unpackaged app started by the e2e driver answers "this folder" itself;
// a packaged app never does.
async function askToTrust({ path, kind, vectors, event }) {
  if (!app.isPackaged && process.env.DATALAD_DESKTOP_E2E_CONFIRM === '1') {
    return 'folder'
  }
  const prompt = describeTrustPrompt({ path, kind, vectors })
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    buttons: prompt.buttons,
    defaultId: 0,
    cancelId: 0,
    title: prompt.title,
    message: prompt.message,
    detail: prompt.detail
  })
  return ['cancel', 'folder', 'tree'][response]
}

// The only way a folder becomes a project root: the user said yes, an administrator listed its location,
// or the app created it empty. What the scan finds is advice for the prompt and change detection.
let gate
const trustGate = () =>
  (gate ??= createTrustGate({
    store: createTrustStore({ file: join(app.getPath('userData'), 'trusted-folders.json'), adminRoots: policy.trustedRoots }),
    scan: (path, kind) => (kind === 'remote' ? findRemoteVectors(consoleRunner, path) : findExecVectors(path)),
    ask: askToTrust,
    authorize: authorizeRoot
  }))

// Native yes/no the renderer cannot answer. E2E drives the real app without a human, so an
// unpackaged build started by the e2e driver answers yes itself; a packaged app never does.
async function confirmNative(event, { title, message, detail, confirmLabel }) {
  if (!app.isPackaged && process.env.DATALAD_DESKTOP_E2E_CONFIRM === '1') {
    return true
  }
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    buttons: ['Cancel', confirmLabel],
    defaultId: 0,
    cancelId: 0,
    title,
    message,
    detail
  })
  return response === 1
}

let consentStore
const consoleConsent = () => (consentStore ??= createConsoleConsent({ file: join(app.getPath('userData'), 'console-consent.json') }))

// A new project is created or cloned at a path the page typed. Outside every folder the user has
// opened, that could be anywhere (home, a login-items folder), so the main process asks.
async function confirmNewProjectLocation(event, targetPath) {
  const ok = await confirmNative(event, {
    title: 'Create a project here?',
    message: 'This folder is outside the projects you have opened.',
    detail: `${targetPath}\n\nFiles will be created or downloaded into it.`,
    confirmLabel: 'Create here'
  })
  if (!ok) {
    throw new Error('Not created: the location was not confirmed.')
  }
}

function authorizeRoot(rootPath) {
  if (typeof rootPath === 'string' && rootPath.trim()) {
    authorizedRoots.add(resolve(rootPath))
  }
}

function isWithinAuthorizedRoot(targetPath) {
  return isWithinRoots(targetPath, authorizedRoots)
}

// Every IPC handler that accepts a renderer-supplied path must call this
// before touching the filesystem — a handler that skips it is a path-
// confinement gap (see commit 2df927e's fs:* handlers for the pattern).
function requireAuthorizedRoot(targetPath) {
  if (!targetPath || typeof targetPath !== 'string' || !isWithinAuthorizedRoot(targetPath)) {
    throw new Error('This folder is not part of an opened project.')
  }
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#eef6fb',
    title: APP_NAME,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged
    }
  })

  mainWindow.webContents.session.setPermissionCheckHandler(() => false)
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  mainWindow.loadURL(APP_RENDERER_URL)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }

    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault()
      void shell.openExternal(url)
      return
    }

    if (url !== APP_RENDERER_URL) {
      event.preventDefault()
    }
  })
}

function applyAppIcon() {
  if (process.platform !== 'darwin' || !app.dock) {
    return
  }

  const iconImage = nativeImage.createFromPath(APP_DOCK_ICON_PATH_DARWIN)
  if (iconImage.isEmpty()) {
    return
  }

  app.dock.setIcon(iconImage)
}

handle('adapter:checkEnvironment', async () => {
  return adapter.checkEnvironment()
})

handle('adapter:detectProject', async (event, projectPath) => {
  await trustGate().require(projectPath, { event })
  return adapter.detectProject(projectPath)
})

// Read-only probe of a folder that isn't (and may never become) a project —
// deliberately does not call authorizeRoot, unlike detectProject above.
handle('adapter:inspectBidsCandidate', async (_event, folderPath) => {
  return adapter.inspectBidsCandidate(folderPath)
})

handle('adapter:ensureBidsMarker', async (_event, payload = {}) => {
  requireAuthorizedRoot(payload.projectPath)
  return adapter.ensureBidsMarker(payload.projectPath, payload.metadata)
})

handle('adapter:findUnnestedBidsCandidates', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  return adapter.findUnnestedBidsCandidates(projectPath)
})

handle('adapter:untrackPath', async (_event, payload = {}) => {
  requireAuthorizedRoot(payload.projectPath)
  return adapter.untrackPath(payload.projectPath, payload.relativePath)
})

// create/clone targets do not exist yet (or are empty); see the trust rules in the handler below.
const COMMANDS_CREATING_A_NEW_PROJECT = new Set(['cloneInstall', 'createProject'])
// Everything that writes to a remote: a local-path remote runs its own hooks, so trust is re-checked first.
const PUSHES = new Set(['push', 'pushTags'])

handle('adapter:runCommand', async (event, payload) => {
  const target = payload.request?.targetPath
  let createdEmpty = false
  let recheckTrust = async () => {}
  if (!COMMANDS_CREATING_A_NEW_PROJECT.has(payload.commandName)) {
    requireAuthorizedRoot(payload.request?.projectPath)
    // A push to a local-path remote (a share, a USB stick) runs that remote's own hooks and uses its config, and
    // the project or the remote may have changed since it was trusted: look again, right before. Nesting a folder
    // (createSubdataset) runs that folder's own settings, and it may have been dropped into an open project since.
    // This scans (seconds on a big project), so it runs inside the registered run below: a Stop pressed meanwhile
    // is honoured instead of finding nothing to cancel.
    recheckTrust = async () => {
      if (PUSHES.has(payload.commandName) || payload.commandName === 'createSubdataset') {
        await trustGate().require(payload.request.projectPath, { event })
      }
      if (PUSHES.has(payload.commandName)) {
        for (const remote of await localRemotePaths(consoleRunner, payload.request.projectPath)) {
          await trustGate().require(remote.path, { kind: 'remote', event })
        }
      }
    }
  } else {
    if (typeof target !== 'string' || !target.trim()) {
      throw new Error('Choose a folder first.')
    }
    if (!isWithinAuthorizedRoot(target) && !isWithinRoots(target, pickedLocations)) {
      await confirmNewProjectLocation(event, target)
    }
    // Only a new, empty project is the app's own. Adopting an existing folder (`create --force`) runs that
    // folder's own settings, and a clone brings content from elsewhere: those are asked about, a clone on its first open.
    if (payload.commandName === 'createProject') {
      createdEmpty = await isEmptyOrMissing(target)
      if (!createdEmpty) {
        await trustGate().require(target, { event })
      }
    }
  }

  let request = payload.request
  if (createdEmpty) {
    request = { ...request, force: false } // empty a moment ago: nothing to adopt, and nothing filled in since may be
  }
  if (payload.commandName === 'save') {
    const gate = await runWithHandle(event, payload.runId, (runOptions) =>
      gateSave({
        runner: consoleRunner,
        projectPath: request.projectPath,
        validatorBin: envBin(managedEnvDir(), 'prism-validator'),
        checkValidator: async () => (await envStatus({ runner: consoleRunner, envDir: managedEnvDir() })).ready,
        ...runOptions
      })
    )
    if (!gate.allow) {
      return gate.result
    }
    // The validator checked the whole project, so commit the whole project, whatever the UI selected.
    if (gate.saveAll) {
      request = { ...request, paths: [] }
    }
  }

  const result = await runWithHandle(event, payload.runId, async (runOptions) => {
    await recheckTrust()
    return adapter.runCommand(payload.commandName, request, runOptions)
  }, { progress: payload.commandName === 'get' || payload.commandName === 'push' })
  if (result?.ok && createdEmpty) {
    trustGate().createdByApp(request.targetPath)
  }
  return result
})

handle('prism:inspect', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  if (!(await isPrismProject(projectPath))) {
    return { isPrism: false, validatorReady: false, introducesPrism: false }
  }
  const validatorReady = (await envStatus({ runner: consoleRunner, envDir: managedEnvDir() })).ready
  const introducesPrism = await isConversionSave({ runner: consoleRunner, projectPath }).catch(() => false)
  return { isPrism: true, validatorReady, introducesPrism }
})

handle('adapter:cancelCommand', (_event, runId) => {
  return typeof runId === 'string' ? runRegistry.cancel(runId) : false
})

handle('env:status', () => envStatus({ runner: consoleRunner, envDir: managedEnvDir() }))

handle('env:ensure', (event, runId) =>
  ensureGuard.run(async () => {
    const uvPath = resolveUv(uvBaseDir())
    const result = await runWithHandle(event, runId, (runOptions) =>
      ensureEnv({
        runner: consoleRunner,
        uvPath,
        envDir: managedEnvDir(),
        lockPath: join(uvBaseDir(), 'prism-requirements.txt'),
        ...runOptions
      })
    )
    if (result.ready) {
      return result
    }
    const { code, message } = describeEnvFailure({ failure: result.failure, cancelled: result.cancelled, uvPath })
    return { ready: false, cancelled: result.cancelled, code, message, technical: result.failure.stderr }
  })
)

handle('adapter:listDatasets', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  return adapter.listDatasets(projectPath)
})

handle('adapter:ignoreOsNoiseFiles', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  return adapter.ignoreOsNoiseFiles(projectPath)
})

handle('adapter:readGitignore', async (_event, payload = {}) => {
  requireAuthorizedRoot(payload.projectPath)
  return adapter.readGitignore(payload.projectPath, payload.relativeDatasetPath)
})

handle('adapter:addIgnorePatterns', async (_event, payload = {}) => {
  requireAuthorizedRoot(payload.projectPath)
  return adapter.addIgnorePatterns(payload.projectPath, payload.relativeDatasetPaths, payload.patterns)
})

handle('adapter:listBranches', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  return adapter.listBranches(projectPath)
})

handle('adapter:getLastCommit', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  return adapter.getLastCommit(projectPath)
})

handle('adapter:getWorkingTreeStatus', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  return adapter.getWorkingTreeStatus(projectPath)
})

handle('adapter:listRecentCommits', async (_event, payload = {}) => {
  const projectPath = payload.projectPath
  const options = payload.options ?? {}
  requireAuthorizedRoot(projectPath)
  return adapter.listRecentCommits(projectPath, options)
})

handle('adapter:getCommitDetails', async (_event, payload = {}) => {
  requireAuthorizedRoot(payload.projectPath)
  return adapter.getCommitDetails(payload.projectPath, payload.commitHash)
})

handle('adapter:getProjectHealth', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  return adapter.getProjectHealth(projectPath)
})

handle('adapter:clearRepositoryLock', async (_event, projectPath) => {
  requireAuthorizedRoot(projectPath)
  return adapter.clearRepositoryLock(projectPath)
})

// Writes a new repository into a folder the user chose (USB drive, share). Never into one with content.
handle('adapter:prepareFolderRemote', async (event, payload = {}) => {
  const { folderPath } = payload
  requireAuthorizedRoot(payload.projectPath)
  await adapter.assertNewRemoteName(payload.projectPath, payload.remoteName)
  if (typeof folderPath !== 'string' || !folderPath.trim()) {
    throw new Error('Choose a folder first.')
  }
  if (!(await isEmptyOrMissing(folderPath))) {
    // A retry after a later step failed: nothing to write, and not trusted here, so Publish asks about it.
    if (await adapter.isPreparedFolderRemote(folderPath)) {
      return { ok: true, folderPath, alreadyPrepared: true }
    }
    throw new Error('Choose an empty folder: this one already has files in it.')
  }
  if (!isWithinRoots(folderPath, pickedLocations)) {
    const ok = await confirmNative(event, {
      title: 'Create a backup copy here?',
      message: 'This folder was typed, not picked.',
      detail: `${folderPath}\n\nA copy of the project will be stored in it.`,
      confirmLabel: 'Use this folder'
    })
    if (!ok) {
      throw new Error('Not created: the location was not confirmed.')
    }
  }
  const result = await adapter.prepareFolderRemote(folderPath)
  // Publish re-checks a local remote's trust; this one the app made itself, empty.
  trustGate().createdByApp(folderPath)
  return result
})

handle('adapter:trackRemote', async (_event, payload = {}) => {
  requireAuthorizedRoot(payload.projectPath)
  return adapter.trackRemote(payload.projectPath, payload.remoteName)
})

handle('watch:setActiveProject', async (event, projectPath = null) => {
  if (activeProjectWatcher) {
    activeProjectWatcher.stop()
    activeProjectWatcher = null
  }

  if (!projectPath) {
    return { ok: true }
  }

  requireAuthorizedRoot(projectPath)

  const watcher = createProjectWatcher({
    onChange: (watchedPath) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('watch:changed', { projectPath: watchedPath, changedAt: Date.now() })
      }
    }
  })

  const result = watcher.start(projectPath)
  if (result.ok) {
    activeProjectWatcher = watcher
  }
  return result
})

handle('console:setEnabled', async (event, enabled) => {
  consoleEnabled =
    !policy.consoleDisabled &&
    (await consoleConsent().allow(Boolean(enabled), () =>
      confirmNative(event, {
        title: 'Turn on the command console?',
        message: 'The console runs any command you type, with your permissions.',
        detail: 'Only turn it on if you need it. Never paste commands from someone you do not trust.',
        confirmLabel: 'Turn on the console'
      })
    ))
  return consoleEnabled
})

handle('console:runCommand', async (event, payload = {}) => {
  if (policy.consoleDisabled) {
    throw new Error('The command console has been disabled by your administrator.')
  }
  if (!consoleEnabled) {
    throw new Error('The command console is disabled. Enable power-user mode first.')
  }
  requireAuthorizedRoot(payload.projectPath)

  const commandSpec = buildConsoleCommand(payload)
  return runWithHandle(event, payload.runId, (runOptions) =>
    consoleRunner.run(commandSpec.command, commandSpec.args, { ...commandSpec.options, ...runOptions })
  )
})

// Global git config only (user.name/user.email); setGitIdentity validates its input.
handle('identity:get', () => getGitIdentity((command, args) => consoleRunner.run(command, args)))
handle('identity:set', (_event, identity) =>
  setGitIdentity((command, args) => consoleRunner.run(command, args), identity)
)

handle('app:getWorkspaceRoot', async () => {
  return app.isPackaged ? '' : process.cwd()
})

handle('dialog:pickDirectory', async (_event, options = {}) => {
  const ownerWindow = BrowserWindow.fromWebContents(_event.sender)
  const defaultPath = await resolveDialogDefaultPath(options.defaultPath)

  const result = await dialog.showOpenDialog(ownerWindow, {
    title: options.title ?? 'Select folder',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const picked = result.filePaths[0]
  // A clone SOURCE is only read from: the user is not asked to trust it as a project, and it is not authorized.
  if (options.purpose === 'source') {
    return picked
  }
  // An empty folder has nothing to trust yet: it is only a place to create a project in.
  if (await isEmptyOrMissing(picked)) {
    pickedLocations.add(resolve(picked))
    return picked
  }
  try {
    await trustGate().require(picked, { event: _event })
  } catch {
    return null // the user declined to trust it: it is not authorized
  }
  return picked
})

handle('fs:listEntries', async (_event, payload = {}) => {
  const { rootPath, dirPath = rootPath } = payload

  for (const path of [rootPath, dirPath]) {
    if (!path || typeof path !== 'string') {
      throw new Error('rootPath is required for file listing')
    }
    if (!isWithinAuthorizedRoot(path)) {
      throw new Error('This folder is not part of an opened project.')
    }
  }

  return listDirectory({ rootPath, dirPath, run: (command, args) => consoleRunner.run(command, args) })
})

handle('fs:revealPath', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('targetPath is required')
  }

  if (!isWithinAuthorizedRoot(targetPath)) {
    throw new Error('This path is not part of an opened project.')
  }

  const normalizedTargetPath = resolve(targetPath)
  await access(normalizedTargetPath)

  const targetStat = await stat(normalizedTargetPath)
  if (targetStat.isDirectory()) {
    shell.showItemInFolder(normalizedTargetPath)
    return true
  }

  shell.showItemInFolder(normalizedTargetPath)
  return true
})

async function resolveDialogDefaultPath(requestedPath) {
  const fallbackPath = process.cwd()
  if (!requestedPath || typeof requestedPath !== 'string') {
    return fallbackPath
  }

  const normalizedPath = requestedPath.trim()
  if (!normalizedPath) {
    return fallbackPath
  }

  try {
    await access(normalizedPath)
    return normalizedPath
  } catch {
    return fallbackPath
  }
}

app.whenReady().then(() => {
  app.setName(APP_NAME)
  applyAppIcon()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  runRegistry.abortAll()
  if (activeProjectWatcher) {
    activeProjectWatcher.stop()
    activeProjectWatcher = null
  }
})