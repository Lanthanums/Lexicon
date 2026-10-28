const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lexicon', {
  saveBeforeImport: raw => ipcRenderer.invoke('snapshot:before-import', raw),
  saveSnapshot: raw => ipcRenderer.invoke('snapshot:save', raw),
  loadSnapshot: () => ipcRenderer.invoke('snapshot:load'),
  migrateLegacy: () => ipcRenderer.invoke('legacy:import'),
  cancelMigration: () => ipcRenderer.invoke('legacy:cancel'),
  openDataFolder: () => ipcRenderer.invoke('data:open'),
})
