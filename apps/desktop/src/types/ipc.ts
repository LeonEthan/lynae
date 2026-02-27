// Typed IPC contract for PR-03: IPC Contract and Event Model

import type { Event, EventReplayOptions, EventReplayResult } from './events'
import type { Session, SessionListResponse, CreateSessionRequest } from './index'

// ============================================================================
// IPC Error Types
// ============================================================================

export type IPCErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ALREADY_EXISTS'
  | 'EVENT_NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'STREAM_ERROR'
  | 'INTERNAL_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'PERMISSION_DENIED'

export interface IPCError {
  code: IPCErrorCode
  message: string
  details?: Record<string, unknown>
}

export class IPCErrorException extends Error {
  constructor(
    public readonly code: IPCErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'IPCErrorException'
  }

  toJSON(): IPCError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

// ============================================================================
// IPC Response Wrapper
// ============================================================================

export type IPCResponse<T> =
  | { success: true; data: T }
  | { success: false; error: IPCError }

// ============================================================================
// IPC Channel Definitions
// ============================================================================

/**
 * IPC channels for invoke/handle pattern (request-response)
 */
export type IPCInvokeChannel =
  // Session management (from PR-02)
  | 'sessions:get'
  | 'sessions:create'
  | 'sessions:switch'
  | 'sessions:delete'
  // Event replay (PR-03)
  | 'events:replay'
  | 'events:getBySession'
  // Approval actions (PR-03)
  | 'approval:respond'
  // Health check
  | 'ping'

/**
 * IPC channels for send/on pattern (one-way / event streaming)
 */
export type IPCEventChannel =
  // Event streaming from main to renderer
  | 'event:stream'
  // Session events
  | 'session:created'
  | 'session:switched'
  | 'session:deleted'
  // Error events
  | 'error:ipc'

// ============================================================================
// Channel Request/Response Types
// ============================================================================

export interface IPCChannelMap {
  // Session management (PR-02)
  'sessions:get': {
    request: void
    response: SessionListResponse
  }
  'sessions:create': {
    request: CreateSessionRequest | undefined
    response: Session
  }
  'sessions:switch': {
    request: string // sessionId
    response: void
  }
  'sessions:delete': {
    request: string // sessionId
    response: void
  }

  // Event replay (PR-03)
  'events:replay': {
    request: EventReplayOptions
    response: EventReplayResult
  }
  'events:getBySession': {
    request: { sessionId: string; options?: EventReplayOptions }
    response: EventReplayResult
  }

  // Approval actions (PR-03)
  'approval:respond': {
    request: { approvalId: string; approved: boolean; reason?: string }
    response: void
  }

  // Health check
  'ping': {
    request: void
    response: string
  }
}

// ============================================================================
// Type-safe channel access helpers
// ============================================================================

export type IPCChannelRequest<T extends IPCInvokeChannel> = IPCChannelMap[T]['request']
export type IPCChannelResponse<T extends IPCInvokeChannel> = IPCChannelMap[T]['response']

// ============================================================================
// Event Callback Types for Streaming
// ============================================================================

export type EventStreamCallback = (event: Event) => void
export type ErrorCallback = (error: IPCError) => void

export interface EventStreamHandlers {
  onEvent: EventStreamCallback
  onError?: ErrorCallback
}

// ============================================================================
// Renderer Process API Interface
// ============================================================================

export interface ElectronAPI {
  // Session management (PR-02)
  getSessions: () => Promise<SessionListResponse>
  createSession: (req?: CreateSessionRequest) => Promise<Session>
  switchSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>

  // Event replay (PR-03)
  replayEvents: (options: EventReplayOptions) => Promise<EventReplayResult>
  getEventsBySession: (
    sessionId: string,
    options?: EventReplayOptions
  ) => Promise<EventReplayResult>

  // Approval actions (PR-03)
  respondToApproval: (
    approvalId: string,
    approved: boolean,
    reason?: string
  ) => Promise<void>

  // Event streaming (PR-03)
  /** Subscribe to real-time event stream */
  onEventStream: (callback: EventStreamCallback) => () => void
  /** Subscribe to IPC errors */
  onIPCError: (callback: ErrorCallback) => () => void

  // Legacy placeholder
  ping: () => Promise<string>
}

// ============================================================================
// Helper functions for error handling
// ============================================================================

export function createIPCError(
  code: IPCErrorCode,
  message: string,
  details?: Record<string, unknown>
): IPCError {
  return { code, message, details }
}

export function isIPCError(obj: unknown): obj is IPCError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'code' in obj &&
    'message' in obj &&
    typeof (obj as IPCError).code === 'string' &&
    typeof (obj as IPCError).message === 'string'
  )
}

export function isIPCResponse<T>(obj: unknown): obj is IPCResponse<T> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'success' in obj &&
    typeof (obj as IPCResponse<T>).success === 'boolean'
  )
}
