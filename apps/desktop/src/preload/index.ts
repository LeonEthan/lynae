import { contextBridge, ipcRenderer } from 'electron'

// API definition
const electronAPI = {
  // IPC placeholder - will be expanded in PR-03
  ping: () => ipcRenderer.invoke('ping'),
}

// Expose protected APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type { electronAPI }
