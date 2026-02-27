import type { Session, SessionListResponse, CreateSessionRequest } from '../types'

// Internal session type with sequence for deterministic sorting
type InternalSession = Session & { sequence: number }

// In-memory session store (will be replaced with SQLite in PR-04)
const sessions: Map<string, InternalSession> = new Map()
let activeSessionId: string | null = null
let sessionCounter = 0
let sequenceCounter = 0

function generateId(): string {
  return `session_${Date.now()}_${++sessionCounter}`
}

function generateName(): string {
  return `New Session ${sessionCounter}`
}

// Sort comparator: primary by updatedAt desc, secondary by sequence desc for deterministic ordering
function sortByRecent(a: InternalSession, b: InternalSession): number {
  const timeDiff = b.updatedAt - a.updatedAt
  if (timeDiff !== 0) return timeDiff
  return b.sequence - a.sequence
}

export function getSessions(): SessionListResponse {
  return {
    sessions: Array.from(sessions.values()).sort(sortByRecent),
    activeSessionId,
  }
}

export function createSession(req?: CreateSessionRequest): Session {
  const now = Date.now()
  const session: InternalSession = {
    id: generateId(),
    name: req?.name || generateName(),
    createdAt: now,
    updatedAt: now,
    sequence: ++sequenceCounter,
  }

  sessions.set(session.id, session)
  activeSessionId = session.id

  return session
}

export function switchSession(sessionId: string): void {
  if (!sessions.has(sessionId)) {
    throw new Error(`Session not found: ${sessionId}`)
  }
  activeSessionId = sessionId

  // Update updatedAt and sequence so the active session appears first in the sorted list
  const session = sessions.get(sessionId)!
  session.updatedAt = Date.now()
  session.sequence = ++sequenceCounter
}

export function deleteSession(sessionId: string): void {
  if (!sessions.has(sessionId)) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  sessions.delete(sessionId)

  // If we deleted the active session, switch to the most recently updated one
  // Sort by updatedAt descending to match getSessions() order
  if (activeSessionId === sessionId) {
    const remaining = Array.from(sessions.values()).sort(sortByRecent)
    activeSessionId = remaining.length > 0 ? remaining[0].id : null
  }
}

// Initialize with some mock data for PR-02 testing
export function initMockSessions(): void {
  if (sessions.size === 0) {
    const session1 = createSession({ name: 'Welcome Session' })
    createSession({ name: 'Quick Start' })
    // Switch back to first session
    switchSession(session1.id)
  }
}

// Reset function for testing
export function __resetSessions(): void {
  sessions.clear()
  activeSessionId = null
  sessionCounter = 0
  sequenceCounter = 0
}
