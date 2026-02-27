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

// IPC API interface
export interface ElectronAPI {
  // Session management
  getSessions: () => Promise<SessionListResponse>
  createSession: (req?: CreateSessionRequest) => Promise<Session>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>

  // Legacy placeholder
  ping: () => Promise<string>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
