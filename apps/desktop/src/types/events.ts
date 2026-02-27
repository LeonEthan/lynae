// Event types for PR-03: IPC Contract and Event Model

/**
 * Base event interface that all events extend
 */
export interface LynaeEvent {
  /** Unique event identifier */
  id: string
  /** Event type discriminator */
  type: string
  /** Session this event belongs to */
  sessionId: string
  /** Event creation timestamp (milliseconds since epoch) */
  timestamp: number
  /** Event sequence number for deterministic ordering */
  sequence: number
}

// ============================================================================
// Runtime Events - AI assistant communication
// ============================================================================

export type RuntimeEventType =
  | 'runtime:start'
  | 'runtime:thinking'
  | 'runtime:text'
  | 'runtime:code'
  | 'runtime:tool_call'
  | 'runtime:tool_result'
  | 'runtime:error'
  | 'runtime:complete'

export interface RuntimeTextContent {
  type: 'text'
  text: string
}

export interface RuntimeThinkingContent {
  type: 'thinking'
  text: string
}

export interface RuntimeCodeContent {
  type: 'code'
  language: string
  code: string
}

export interface RuntimeToolCallContent {
  type: 'tool_call'
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface RuntimeToolResultContent {
  type: 'tool_result'
  toolCallId: string
  result: unknown
  error?: string
}

export type RuntimeEventContent =
  | RuntimeTextContent
  | RuntimeThinkingContent
  | RuntimeCodeContent
  | RuntimeToolCallContent
  | RuntimeToolResultContent

export interface RuntimeEvent extends LynaeEvent {
  type: RuntimeEventType
  /** Content chunks for streaming - undefined for non-content events */
  content?: RuntimeEventContent
  /** Whether this is the final chunk of a streaming event */
  isComplete?: boolean
  /** Error message for runtime:error events */
  error?: string
}

// ============================================================================
// Tool Events - Tool execution lifecycle
// ============================================================================

export type ToolEventType =
  | 'tool:started'
  | 'tool:progress'
  | 'tool:completed'
  | 'tool:failed'
  | 'tool:cancelled'

export interface ToolStartedEvent extends LynaeEvent {
  type: 'tool:started'
  toolName: string
  toolCallId: string
  arguments: Record<string, unknown>
}

export interface ToolProgressEvent extends LynaeEvent {
  type: 'tool:progress'
  toolName: string
  toolCallId: string
  progress: number
  message?: string
}

export interface ToolCompletedEvent extends LynaeEvent {
  type: 'tool:completed'
  toolName: string
  toolCallId: string
  result: unknown
  executionTimeMs: number
}

export interface ToolFailedEvent extends LynaeEvent {
  type: 'tool:failed'
  toolName: string
  toolCallId: string
  error: string
  executionTimeMs: number
}

export interface ToolCancelledEvent extends LynaeEvent {
  type: 'tool:cancelled'
  toolName: string
  toolCallId: string
  reason: string
}

export type ToolEvent =
  | ToolStartedEvent
  | ToolProgressEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | ToolCancelledEvent

// ============================================================================
// Approval Events - User approval workflow
// ============================================================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export type ApprovalEventType =
  | 'approval:requested'
  | 'approval:responded'
  | 'approval:expired'

export interface ApprovalRequest {
  /** Approval request ID */
  id: string
  /** What is being requested approval for */
  action: string
  /** Detailed description of the action */
  description: string
  /** Risk level of the action */
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  /** Arguments/details of the action */
  details: Record<string, unknown>
  /** When the request expires (timestamp) */
  expiresAt: number
}

export interface ApprovalRequestedEvent extends LynaeEvent {
  type: 'approval:requested'
  approvalId: string
  request: ApprovalRequest
}

export interface ApprovalRespondedEvent extends LynaeEvent {
  type: 'approval:responded'
  approvalId: string
  approved: boolean
  reason?: string
}

export interface ApprovalExpiredEvent extends LynaeEvent {
  type: 'approval:expired'
  approvalId: string
  request: ApprovalRequest
}

export type ApprovalEvent =
  | ApprovalRequestedEvent
  | ApprovalRespondedEvent
  | ApprovalExpiredEvent

// ============================================================================
// Union type for all events
// ============================================================================

export type Event = RuntimeEvent | ToolEvent | ApprovalEvent

// ============================================================================
// Event replay types
// ============================================================================

export interface EventReplayOptions {
  /** Start timestamp for replay window */
  fromTimestamp?: number
  /** End timestamp for replay window */
  toTimestamp?: number
  /** Specific event types to include */
  eventTypes?: string[]
  /** Maximum number of events to return */
  limit?: number
}

export interface EventReplayResult {
  events: Event[]
  totalAvailable: number
  hasMore: boolean
}

// ============================================================================
// Event filter types for UI rendering
// ============================================================================

export interface EventFilter {
  sessionId?: string
  eventTypes?: string[]
  fromTimestamp?: number
  toTimestamp?: number
}
