import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateSessionRequest,
  EventReplayOptions,
  EventStreamCallback,
  ErrorCallback,
  IPCResponse,
  SessionListResponse,
  Session,
  EventReplayResult,
} from '../types'

// ============================================================================
// IPC Response Handler
// ============================================================================

function unwrapResponse<T>(response: IPCResponse<T>): T {
  if (!response.success) {
    const error = new Error(response.error.message)
    error.name = 'IPCError'
    ;(error as unknown as { code: string }).code = response.error.code
    throw error
  }
  return response.data
}

// ============================================================================
// API definition for PR-03: IPC Contract and Event Model
// ============================================================================

const electronAPI = {
  // Session management (PR-02)
  getSessions: async (): Promise<SessionListResponse> => {
    const response = await ipcRenderer.invoke('sessions:get') as IPCResponse<SessionListResponse>
    return unwrapResponse(response)
  },
  createSession: async (req?: CreateSessionRequest): Promise<Session> => {
    const response = await ipcRenderer.invoke('sessions:create', req) as IPCResponse<Session>
    return unwrapResponse(response)
  },
  switchSession: async (sessionId: string): Promise<void> => {
    const response = await ipcRenderer.invoke('sessions:switch', sessionId) as IPCResponse<void>
    return unwrapResponse(response)
  },
  deleteSession: async (sessionId: string): Promise<void> => {
    const response = await ipcRenderer.invoke('sessions:delete', sessionId) as IPCResponse<void>
    return unwrapResponse(response)
  },

  // Event replay (PR-03)
  replayEvents: async (options: EventReplayOptions): Promise<EventReplayResult> => {
    const response = await ipcRenderer.invoke('events:replay', options) as IPCResponse<EventReplayResult>
    return unwrapResponse(response)
  },
  getEventsBySession: async (sessionId: string, options?: EventReplayOptions): Promise<EventReplayResult> => {
    const response = await ipcRenderer.invoke('events:getBySession', { sessionId, options }) as IPCResponse<EventReplayResult>
    return unwrapResponse(response)
  },

  // Approval actions (PR-03)
  respondToApproval: async (approvalId: string, approved: boolean, reason?: string): Promise<void> => {
    const response = await ipcRenderer.invoke('approval:respond', { approvalId, approved, reason }) as IPCResponse<void>
    return unwrapResponse(response)
  },

  // Event streaming (PR-03)
  onEventStream: (callback: EventStreamCallback) => {
    const handler = (_: unknown, event: unknown) => callback(event as Parameters<EventStreamCallback>[0])
    ipcRenderer.on('event:stream', handler)
    return () => ipcRenderer.off('event:stream', handler)
  },

  onIPCError: (callback: ErrorCallback) => {
    const handler = (_: unknown, error: unknown) => callback(error as Parameters<ErrorCallback>[0])
    ipcRenderer.on('error:ipc', handler)
    return () => ipcRenderer.off('error:ipc', handler)
  },

  // Legacy placeholder
  ping: () => ipcRenderer.invoke('ping'),
}

// Expose protected APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type { electronAPI }
