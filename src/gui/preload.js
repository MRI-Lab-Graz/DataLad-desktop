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
  getWorkspaceRoot: () => ipcRenderer.invoke('app:getWorkspaceRoot')
})