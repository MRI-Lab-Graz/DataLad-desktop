const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dataladDesktop', {
  platform: process.platform,
  checkEnvironment: () => ipcRenderer.invoke('adapter:checkEnvironment'),
  detectProject: (projectPath) => ipcRenderer.invoke('adapter:detectProject', projectPath),
  inspectBidsCandidate: (folderPath) => ipcRenderer.invoke('adapter:inspectBidsCandidate', folderPath),
  ensureBidsMarker: (projectPath, metadata) =>
    ipcRenderer.invoke('adapter:ensureBidsMarker', { projectPath, metadata }),
  findUnnestedBidsCandidates: (projectPath) => ipcRenderer.invoke('adapter:findUnnestedBidsCandidates', projectPath),
  untrackPath: (projectPath, relativePath) =>
    ipcRenderer.invoke('adapter:untrackPath', { projectPath, relativePath }),
  runCommand: (commandName, request) =>
    ipcRenderer.invoke('adapter:runCommand', {
      commandName,
      request
    }),
  runConsoleCommand: (payload) => ipcRenderer.invoke('console:runCommand', payload),
  setConsoleEnabled: (enabled) => ipcRenderer.invoke('console:setEnabled', enabled),
  getContract: () => ipcRenderer.invoke('adapter:getContract'),
  listDatasets: (projectPath) => ipcRenderer.invoke('adapter:listDatasets', projectPath),
  ignoreOsNoiseFiles: (projectPath) => ipcRenderer.invoke('adapter:ignoreOsNoiseFiles', projectPath),
  readGitignore: (projectPath, relativeDatasetPath) =>
    ipcRenderer.invoke('adapter:readGitignore', { projectPath, relativeDatasetPath }),
  addIgnorePatterns: (projectPath, relativeDatasetPaths, patterns) =>
    ipcRenderer.invoke('adapter:addIgnorePatterns', { projectPath, relativeDatasetPaths, patterns }),
  listBranches: (projectPath) => ipcRenderer.invoke('adapter:listBranches', projectPath),
  listRemoteStudies: () => ipcRenderer.invoke('adapter:listRemoteStudies'),
  setSshPassword: (password) => ipcRenderer.invoke('adapter:setSshPassword', password),
  clearSshPassword: () => ipcRenderer.invoke('adapter:clearSshPassword'),
  hasSshPassword: () => ipcRenderer.invoke('adapter:hasSshPassword'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  getLastCommit: (projectPath) => ipcRenderer.invoke('adapter:getLastCommit', projectPath),
  getWorkingTreeStatus: (projectPath) => ipcRenderer.invoke('adapter:getWorkingTreeStatus', projectPath),
  listRecentCommits: (projectPath, options) =>
    ipcRenderer.invoke('adapter:listRecentCommits', {
      projectPath,
      options
    }),
  getCommitDetails: (projectPath, commitHash) =>
    ipcRenderer.invoke('adapter:getCommitDetails', { projectPath, commitHash }),
  getProjectHealth: (projectPath) => ipcRenderer.invoke('adapter:getProjectHealth', projectPath),
  clearRepositoryLock: (projectPath) => ipcRenderer.invoke('adapter:clearRepositoryLock', projectPath),
  getWorkspaceRoot: () => ipcRenderer.invoke('app:getWorkspaceRoot'),
  pickDirectory: (options) => ipcRenderer.invoke('dialog:pickDirectory', options),
  listFileEntries: (rootPath, options) =>
    ipcRenderer.invoke('fs:listEntries', {
      rootPath,
      ...(options ?? {})
    }),
  revealPath: (targetPath) => ipcRenderer.invoke('fs:revealPath', targetPath),
  setWatchedProject: (projectPath) => ipcRenderer.invoke('watch:setActiveProject', projectPath),
  onFilesChanged: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('watch:changed', listener)
    return () => ipcRenderer.removeListener('watch:changed', listener)
  }
})