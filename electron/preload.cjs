const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lexicon', {
  saveBeforeImport: raw => ipcRenderer.invoke('snapshot:before-import', raw),
  saveSnapshot: raw => ipcRenderer.invoke('snapshot:save', raw),
  loadSnapshot: () => ipcRenderer.invoke('snapshot:load'),
  setTheme: theme => ipcRenderer.invoke('appearance:set', theme),
  openDataFolder: () => ipcRenderer.invoke('data:open'),
})
