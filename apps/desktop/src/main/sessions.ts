import type { Session, SessionListResponse, CreateSessionRequest } from '../types'

// In-memory session store (will be replaced with SQLite in PR-04)
const sessions: Map<string, Session> = new Map()
let activeSessionId: string | null = null
let sessionCounter = 0

function generateId(): string {
  return `session_${Date.now()}_${++sessionCounter}`
}

function generateName(): string {
  return `New Session ${sessionCounter}`
}

export function getSessions(): SessionListResponse {
  return {
    sessions: Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    activeSessionId,
  }
}

export function createSession(req?: CreateSessionRequest): Session {
  const now = Date.now()
  const session: Session = {
    id: generateId(),
    name: req?.name || generateName(),
    createdAt: now,
    updatedAt: now,
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
}

export function deleteSession(sessionId: string): void {
  if (!sessions.has(sessionId)) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  sessions.delete(sessionId)

  // If we deleted the active session, switch to the most recently updated one
  // Sort by updatedAt descending to match getSessions() order
  if (activeSessionId === sessionId) {
    const remaining = Array.from(sessions.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    )
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
