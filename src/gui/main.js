import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { access, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DataLadAdapter } from '../datalad/adapter.js'
import { buildConsoleCommand } from '../datalad/console-command.js'
import { getGitIdentity, setGitIdentity } from '../datalad/git-identity.js'
import { createEnsureGuard, describeEnvFailure, ensureEnv, envBin, envStatus, resolveUv } from '../datalad/managed-env.js'
import { gateSave, isConversionSave, isPrismProject } from '../datalad/prism-gate.js'
import { ProcessRunner } from '../datalad/process-runner.js'
import { tryLoadRustAdapter } from '../datalad/rust-bridge.js'
import { createProjectWatcher } from './fs-watch.js'
import { listDirectory } from './list-directory.js'
import { initialAuthorizedRoots, isWithinRoots } from './path-confinement.js'
import { loadPolicy } from './policy.js'
import { guardedHandler } from './ipc-guard.js'
import { createTrustStore, findExecVectors } from './folder-trust.js'
import { createLatestLineThrottle, createRunRegistry } from './run-registry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const adapter = createAdapter()
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
  file: join(app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', 'build'), 'policy.json')
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
async function runWithHandle(event, runId, run) {
  if (runId === undefined) {
    return run({})
  }

  const signal = runRegistry.register(runId)
  const activity = createLatestLineThrottle((line) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('command:activity', { runId, line })
    }
  })
  try {
    return await run({ signal, onOutput: activity.push })
  } finally {
    activity.stop()
    runRegistry.finish(runId)
  }
}

function createAdapter() {
  const rustAdapterState = tryLoadRustAdapter()
  if (rustAdapterState.enabled) {
    return rustAdapterState.adapter
  }


  return new DataLadAdapter()
}

let trustStore
const folderTrust = () => (trustStore ??= createTrustStore(join(app.getPath('userData'), 'trusted-folders.json')))

// Opening a folder runs git in it, and a folder from elsewhere can name programs for git
// to run (hooks, config). Ask once per folder; the app's own clones/creates are trusted.
async function requireTrustedFolder(event, projectPath) {
  if (typeof projectPath !== 'string' || folderTrust().has(projectPath)) {
    return
  }
  const vectors = findExecVectors(projectPath)
  if (vectors.length === 0) {
    return
  }
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
    type: 'warning',
    buttons: ['Cancel', 'Open and trust this folder'],
    defaultId: 0,
    cancelId: 0,
    title: 'Only open folders you trust',
    message: 'This folder can run programs on your computer.',
    detail:
      `${projectPath}\n\nIt contains settings that make Git run commands (${vectors.slice(0, 5).join(', ')}). ` +
      'Open it only if you know where it came from.'
  })
  if (response !== 1) {
    throw new Error('Folder not opened: it was not trusted.')
  }
  folderTrust().add(projectPath)
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
  await requireTrustedFolder(event, projectPath)
  const result = await adapter.detectProject(projectPath)
  if (result?.classification) {
    authorizeRoot(projectPath)
  }
  return result
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

// clone/create targets don't exist yet; they are authorized after they succeed.
const COMMANDS_CREATING_A_NEW_PROJECT = new Set(['cloneInstall', 'createProject'])

handle('adapter:runCommand', async (event, payload) => {
  if (!COMMANDS_CREATING_A_NEW_PROJECT.has(payload.commandName)) {
    requireAuthorizedRoot(payload.request?.projectPath)
  }

  let request = payload.request
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

  const result = await runWithHandle(event, payload.runId, (runOptions) =>
    adapter.runCommand(payload.commandName, request, runOptions)
  )
  if (
    result?.ok &&
    (payload.commandName === 'cloneInstall' || payload.commandName === 'createProject')
  ) {
    authorizeRoot(request?.targetPath)
    folderTrust().add(request.targetPath)
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

handle('adapter:getContract', async () => {
  return adapter.getInterfaceContract()
})

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

handle('console:setEnabled', async (_event, enabled) => {
  consoleEnabled = Boolean(enabled) && !policy.consoleDisabled
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

  authorizeRoot(result.filePaths[0])
  return result.filePaths[0]
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