const { contextBridge, ipcRenderer } = require('electron')

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
  listBranches: (projectPath) => ipcRenderer.invoke('adapter:listBranches', projectPath),
  getLastCommit: (projectPath) => ipcRenderer.invoke('adapter:getLastCommit', projectPath),
  getWorkingTreeStatus: (projectPath) => ipcRenderer.invoke('adapter:getWorkingTreeStatus', projectPath),
  listRecentCommits: (projectPath, options) =>
    ipcRenderer.invoke('adapter:listRecentCommits', {
      projectPath,
      options
    }),
  getProjectHealth: (projectPath) => ipcRenderer.invoke('adapter:getProjectHealth', projectPath),
  getWorkspaceRoot: () => ipcRenderer.invoke('app:getWorkspaceRoot'),
  pickDirectory: (options) => ipcRenderer.invoke('dialog:pickDirectory', options),
  listFileEntries: (rootPath, options) =>
    ipcRenderer.invoke('fs:listEntries', {
      rootPath,
      ...(options ?? {})
    }),
  revealPath: (targetPath) => ipcRenderer.invoke('fs:revealPath', targetPath)
})