import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { access, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DataLadAdapter } from '../datalad/adapter.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const adapter = new DataLadAdapter()
const APP_NAME = 'DataLad Desktop'
const APP_ICON_PATH = join(__dirname, 'assets', 'icons', 'datalad_desktop.png')
const IGNORED_FOLDERS = new Set(['.git', '.datalad', '.github', 'node_modules'])

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
      sandbox: false
    }
  })

  mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }

    return { action: 'allow' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault()
      void shell.openExternal(url)
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
    const errorMessage = await shell.openPath(normalizedTargetPath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }
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

  return {
    rootPath: normalizedRoot,
    maxDepth,
    truncated,
    entries
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