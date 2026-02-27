// Session types for PR-02 Desktop Shell

export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface CreateSessionRequest {
  name?: string
}

export interface SessionListResponse {
  sessions: Session[]
  activeSessionId: string | null
}

// Re-export PR-03 types
export * from './events'
export * from './ipc'

// IPC API interface (re-exported from ipc.ts for backwards compatibility)
import type { ElectronAPI } from './ipc'
export type { ElectronAPI }

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
