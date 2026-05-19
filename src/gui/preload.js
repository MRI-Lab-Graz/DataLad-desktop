import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dataladDesktop', {
  checkEnvironment: () => ipcRenderer.invoke('adapter:checkEnvironment'),
  detectProject: (projectPath) => ipcRenderer.invoke('adapter:detectProject', projectPath),
  runCommand: (commandName, request) =>
    ipcRenderer.invoke('adapter:runCommand', {
      commandName,
      request
    }),
  getContract: () => ipcRenderer.invoke('adapter:getContract'),
  listDatasets: (projectPath) => ipcRenderer.invoke('adapter:listDatasets', projectPath),
  getWorkspaceRoot: () => ipcRenderer.invoke('app:getWorkspaceRoot'),
  pickDirectory: (options) => ipcRenderer.invoke('dialog:pickDirectory', options),
  listFileEntries: (rootPath, options) =>
    ipcRenderer.invoke('fs:listEntries', {
      rootPath,
      ...(options ?? {})
    }),
  revealPath: (targetPath) => ipcRenderer.invoke('fs:revealPath', targetPath)
})