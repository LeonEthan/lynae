// Event store for PR-03: IPC Contract and Event Model
// In-memory implementation - will be replaced with SQLite persistence in PR-04

import type {
  Event,
  EventReplayOptions,
  EventReplayResult,
  RuntimeEvent,
  ToolEvent,
  ApprovalEvent,
  RuntimeEventContent,
} from '../types'
import { IPCErrorException } from '../types'

// ============================================================================
// In-memory event store
// ============================================================================

const eventStore: Map<string, Event> = new Map()
let eventSequenceCounter = 0

// ============================================================================
// Event creation helpers
// ============================================================================

function generateEventId(): string {
  return `evt_${Date.now()}_${++eventSequenceCounter}`
}

interface BaseEventFields {
  id: string
  sessionId: string
  timestamp: number
  sequence: number
}

function createBaseEvent(sessionId: string): BaseEventFields {
  return {
    id: generateEventId(),
    sessionId,
    timestamp: Date.now(),
    sequence: ++eventSequenceCounter,
  }
}

// ============================================================================
// Event storage operations
// ============================================================================

export function storeEvent(event: Event): void {
  eventStore.set(event.id, event)
}

export function getEvent(eventId: string): Event | undefined {
  return eventStore.get(eventId)
}

export function getAllEvents(): Event[] {
  return Array.from(eventStore.values()).sort((a, b) => a.sequence - b.sequence)
}

export function clearEvents(): void {
  eventStore.clear()
  eventSequenceCounter = 0
}

// ============================================================================
// Event replay functionality
// ============================================================================

export function replayEvents(options: EventReplayOptions = {}): EventReplayResult {
  let events = getAllEvents()

  // Apply filters
  if (options.fromTimestamp !== undefined) {
    events = events.filter(e => e.timestamp >= options.fromTimestamp!)
  }

  if (options.toTimestamp !== undefined) {
    events = events.filter(e => e.timestamp <= options.toTimestamp!)
  }

  if (options.eventTypes !== undefined && options.eventTypes.length > 0) {
    events = events.filter(e => options.eventTypes!.includes(e.type))
  }

  const totalAvailable = events.length

  // Apply limit
  if (options.limit !== undefined && options.limit > 0) {
    events = events.slice(0, options.limit)
  }

  return {
    events,
    totalAvailable,
    hasMore: totalAvailable > events.length,
  }
}

export function getEventsBySession(
  sessionId: string,
  options: EventReplayOptions = {}
): EventReplayResult {
  // First filter by session
  let events = getAllEvents().filter(e => e.sessionId === sessionId)

  // Apply additional filters
  if (options.fromTimestamp !== undefined) {
    events = events.filter(e => e.timestamp >= options.fromTimestamp!)
  }

  if (options.toTimestamp !== undefined) {
    events = events.filter(e => e.timestamp <= options.toTimestamp!)
  }

  if (options.eventTypes !== undefined && options.eventTypes.length > 0) {
    events = events.filter(e => options.eventTypes!.includes(e.type))
  }

  const totalAvailable = events.length

  // Apply limit
  if (options.limit !== undefined && options.limit > 0) {
    events = events.slice(0, options.limit)
  }

  return {
    events,
    totalAvailable,
    hasMore: totalAvailable > events.length,
  }
}

// ============================================================================
// Runtime event creation
// ============================================================================

export function createRuntimeEvent(
  sessionId: string,
  type: RuntimeEvent['type'],
  content?: RuntimeEventContent,
  isComplete = true,
  error?: string
): RuntimeEvent {
  const event: RuntimeEvent = {
    ...createBaseEvent(sessionId),
    type,
    content,
    isComplete,
    error,
  } as RuntimeEvent

  storeEvent(event)
  return event
}

// ============================================================================
// Simulated streaming events for PR-03 demo
// ============================================================================

export function* generateSimulatedStream(
  sessionId: string,
  message: string
): Generator<RuntimeEvent, void, unknown> {
  const chunks = message.split(' ')

  // Start event
  yield createRuntimeEvent(sessionId, 'runtime:start', undefined, false)

  // Thinking event
  yield createRuntimeEvent(
    sessionId,
    'runtime:thinking',
    { type: 'thinking', text: 'Processing your request...' },
    true
  )

  // Stream text chunks
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    yield createRuntimeEvent(
      sessionId,
      'runtime:text',
      { type: 'text', text: chunks[i] + (isLast ? '' : ' ') },
      isLast
    )
  }

  // Complete event
  yield createRuntimeEvent(sessionId, 'runtime:complete', undefined, true)
}

export function generateSimulatedEvents(sessionId: string): Event[] {
  const events: Event[] = []

  // Simulate a conversation
  events.push(createRuntimeEvent(
    sessionId,
    'runtime:start',
    undefined,
    false
  ))

  events.push(createRuntimeEvent(
    sessionId,
    'runtime:thinking',
    { type: 'thinking', text: 'Analyzing the code structure...' },
    true
  ))

  events.push(createRuntimeEvent(
    sessionId,
    'runtime:text',
    { type: 'text', text: 'I can help you with that. Let me analyze the codebase.' },
    true
  ))

  events.push(createRuntimeEvent(
    sessionId,
    'runtime:tool_call',
    {
      type: 'tool_call',
      toolCallId: `tool_${Date.now()}`,
      toolName: 'file:read',
      arguments: { path: '/src/main.ts' }
    },
    true
  ))

  events.push(createRuntimeEvent(
    sessionId,
    'runtime:text',
    { type: 'text', text: 'Looking at the main file, I can see the structure.' },
    true
  ))

  events.push(createRuntimeEvent(
    sessionId,
    'runtime:complete',
    undefined,
    true
  ))

  return events
}

// ============================================================================
// Event streaming (for real-time updates)
// ============================================================================

export type EventStreamHandler = (event: Event) => void

const streamHandlers: Set<EventStreamHandler> = new Set()

export function subscribeToEventStream(handler: EventStreamHandler): () => void {
  streamHandlers.add(handler)
  return () => streamHandlers.delete(handler)
}

export function broadcastEvent(event: Event): void {
  storeEvent(event)
  streamHandlers.forEach(handler => {
    try {
      handler(event)
    } catch (error) {
      console.error('Error in event stream handler:', error)
    }
  })
}

// ============================================================================
// Approval management (placeholder for PR-08)
// ============================================================================

interface PendingApproval {
  id: string
  sessionId: string
  action: string
  description: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  details: Record<string, unknown>
  expiresAt: number
}

const pendingApprovals: Map<string, PendingApproval> = new Map()

export function createApprovalRequest(
  sessionId: string,
  action: string,
  description: string,
  riskLevel: 'low' | 'medium' | 'high' | 'critical',
  details: Record<string, unknown>,
  expiresAt?: number
): string {
  const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const approval: PendingApproval = {
    id,
    sessionId,
    action,
    description,
    riskLevel,
    details,
    expiresAt: expiresAt ?? Date.now() + 5 * 60 * 1000, // 5 minutes default
  }
  pendingApprovals.set(id, approval)
  return id
}

export function respondToApproval(
  approvalId: string,
  approved: boolean,
  reason?: string
): void {
  const approval = pendingApprovals.get(approvalId)
  if (!approval) {
    throw new IPCErrorException('EVENT_NOT_FOUND', `Approval request not found: ${approvalId}`)
  }

  // In a real implementation, this would trigger the continuation of the workflow
  console.log(`Approval ${approvalId} ${approved ? 'approved' : 'rejected'}${reason ? `: ${reason}` : ''}`)

  pendingApprovals.delete(approvalId)
}

export function getPendingApprovals(sessionId?: string): PendingApproval[] {
  const approvals = Array.from(pendingApprovals.values())
  if (sessionId) {
    return approvals.filter(a => a.sessionId === sessionId)
  }
  return approvals
}

// Reset function for testing
export function __resetEvents(): void {
  eventStore.clear()
  pendingApprovals.clear()
  streamHandlers.clear()
  eventSequenceCounter = 0
}
