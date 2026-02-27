import { contextBridge, ipcRenderer } from 'electron'
import type { CreateSessionRequest } from '../types'

// API definition for PR-02 Desktop Shell
const electronAPI = {
  // Session management
  getSessions: () => ipcRenderer.invoke('sessions:get'),
  createSession: (req?: CreateSessionRequest) => ipcRenderer.invoke('sessions:create', req),
  switchSession: (sessionId: string) => ipcRenderer.invoke('sessions:switch', sessionId),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('sessions:delete', sessionId),

  // Legacy placeholder
  ping: () => ipcRenderer.invoke('ping'),
}

// Expose protected APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type { electronAPI }
