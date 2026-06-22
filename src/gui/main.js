import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { access, readdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DataLadAdapter } from '../datalad/adapter.js'
import { tryLoadRustAdapter } from '../datalad/rust-bridge.js'
import { buildGitStatusMap } from '../datalad/status.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const adapter = createAdapter()
const APP_NAME = 'DataLad Desktop'
const APP_ICON_PATH = join(__dirname, 'assets', 'icons', 'datalad_desktop.png')
const APP_RENDERER_URL = pathToFileURL(join(__dirname, 'renderer', 'index.html')).toString()
const IGNORED_FOLDERS = new Set(['.git', '.datalad', '.github', 'node_modules'])

function createAdapter() {
  const rustAdapterState = tryLoadRustAdapter()
  if (rustAdapterState.enabled) {
    return rustAdapterState.adapter
  }

  if (rustAdapterState.reason) {
    // Keep startup resilient while Rust bridge is being rolled out incrementally.
    console.info(`[adapter] Using JavaScript adapter: ${rustAdapterState.reason}`)
  }

  return new DataLadAdapter()
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
      sandbox: true
    }
  })

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
  const iconImage = nativeImage.createFromPath(APP_ICON_PATH)
  if (iconImage.isEmpty()) {
    return
  }

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconImage)
  }
}

ipcMain.handle('adapter:checkEnvironment', async () => {
  return adapter.checkEnvironment()
})

ipcMain.handle('adapter:detectProject', async (_event, projectPath) => {
  return adapter.detectProject(projectPath)
})

ipcMain.handle('adapter:runCommand', async (_event, payload) => {
  return adapter.runCommand(payload.commandName, payload.request)
})

ipcMain.handle('adapter:getContract', async () => {
  return adapter.getInterfaceContract()
})

ipcMain.handle('adapter:listDatasets', async (_event, projectPath) => {
  return adapter.listDatasets(projectPath)
})

ipcMain.handle('adapter:listBranches', async (_event, projectPath) => {
  return adapter.listBranches(projectPath)
})

ipcMain.handle('adapter:getLastCommit', async (_event, projectPath) => {
  return adapter.getLastCommit(projectPath)
})

ipcMain.handle('adapter:getWorkingTreeStatus', async (_event, projectPath) => {
  return adapter.getWorkingTreeStatus(projectPath)
})

ipcMain.handle('adapter:listRecentCommits', async (_event, payload = {}) => {
  const projectPath = payload.projectPath
  const options = payload.options ?? {}
  return adapter.listRecentCommits(projectPath, options)
})

ipcMain.handle('adapter:getProjectHealth', async (_event, projectPath) => {
  return adapter.getProjectHealth(projectPath)
})

ipcMain.handle('app:getWorkspaceRoot', async () => {
  return process.cwd()
})

ipcMain.handle('dialog:pickDirectory', async (_event, options = {}) => {
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

  return result.filePaths[0]
})

ipcMain.handle('fs:listEntries', async (_event, payload = {}) => {
  const rootPath = payload.rootPath
  const maxDepth = Number.isInteger(payload.maxDepth) ? payload.maxDepth : 2
  const maxEntries = Number.isInteger(payload.maxEntries) ? payload.maxEntries : 300

  if (!rootPath || typeof rootPath !== 'string') {
    throw new Error('rootPath is required for file listing')
  }

  return listEntries(rootPath, maxDepth, maxEntries)
})

ipcMain.handle('fs:revealPath', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('targetPath is required')
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

async function listEntries(rootPath, maxDepth, maxEntries) {
  const normalizedRoot = resolve(rootPath)
  await access(normalizedRoot)

  const entries = []
  let truncated = false

  async function walk(currentPath, depth) {
    if (entries.length >= maxEntries) {
      truncated = true
      return
    }

    const children = await readdir(currentPath, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))

    for (const child of children) {
      if (entries.length >= maxEntries) {
        truncated = true
        return
      }

      if (child.isDirectory() && IGNORED_FOLDERS.has(child.name)) {
        continue
      }

      const absolutePath = join(currentPath, child.name)
      const relativePath = relative(normalizedRoot, absolutePath).split(sep).join('/')
      const depthLevel = relativePath.split('/').length - 1

      entries.push({
        name: child.name,
        absolutePath,
        relativePath,
        type: child.isDirectory() ? 'directory' : 'file',
        depth: depthLevel
      })

      if (child.isDirectory() && depth < maxDepth) {
        await walk(absolutePath, depth + 1)
      }
    }
  }

  await walk(normalizedRoot, 0)

  const gitStatusByPath = await readGitStatusMap(normalizedRoot)
  const changedPaths = [...gitStatusByPath.keys()]
  const entriesWithStatus = entries.map((entry) => {
    if (entry.type === 'file') {
      return {
        ...entry,
        gitStatus: gitStatusByPath.get(entry.relativePath) ?? null
      }
    }

    const hasChangedDescendant = changedPaths.some(
      (candidatePath) =>
        candidatePath === entry.relativePath || candidatePath.startsWith(`${entry.relativePath}/`)
    )

    return {
      ...entry,
      gitStatus: hasChangedDescendant ? 'changed' : null
    }
  })

  return {
    rootPath: normalizedRoot,
    maxDepth,
    truncated,
    entries: entriesWithStatus
  }
}

async function readGitStatusMap(rootPath) {
  const gitResult = await runCommand('git', [
    '-C',
    rootPath,
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain',
    '--untracked-files=all'
  ])

  if (gitResult.failed) {
    return new Map()
  }

  return buildGitStatusMap(gitResult.stdout)
}

async function runCommand(command, args) {
  return new Promise((resolveCommand) => {
    const processHandle = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    processHandle.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    processHandle.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    processHandle.on('error', () => {
      resolveCommand({
        stdout,
        stderr,
        failed: true
      })
    })

    processHandle.on('close', (exitCode) => {
      resolveCommand({
        stdout,
        stderr,
        failed: (exitCode ?? 1) !== 0
      })
    })
  })
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