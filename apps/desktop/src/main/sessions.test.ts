import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSession,
  deleteSession,
  getSessions,
  switchSession,
  __resetSessions,
} from './sessions'

describe('sessions', () => {
  beforeEach(() => {
    __resetSessions()
  })

  describe('createSession', () => {
    it('creates a session with auto-generated name', () => {
      const session = createSession()

      expect(session.id).toMatch(/^session_\d+_\d+$/)
      expect(session.name).toMatch(/^New Session \d+$/)
      expect(session.createdAt).toBeDefined()
      expect(session.updatedAt).toBeDefined()
    })

    it('creates a session with custom name', () => {
      const session = createSession({ name: 'My Custom Session' })

      expect(session.name).toBe('My Custom Session')
    })

    it('sets the new session as active', () => {
      const session = createSession()
      const { activeSessionId } = getSessions()

      expect(activeSessionId).toBe(session.id)
    })

    it('increments session counter for names', () => {
      const session1 = createSession()
      const session2 = createSession()

      expect(session1.name).toBe('New Session 1')
      expect(session2.name).toBe('New Session 2')
    })
  })

  describe('getSessions', () => {
    it('returns empty array when no sessions', () => {
      const { sessions, activeSessionId } = getSessions()

      expect(sessions).toEqual([])
      expect(activeSessionId).toBeNull()
    })

    it('returns all sessions sorted by updatedAt descending', async () => {
      const session1 = createSession({ name: 'First' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session2 = createSession({ name: 'Second' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session3 = createSession({ name: 'Third' })

      const { sessions } = getSessions()

      expect(sessions).toHaveLength(3)
      expect(sessions[0].id).toBe(session3.id) // Most recent first
      expect(sessions[1].id).toBe(session2.id)
      expect(sessions[2].id).toBe(session1.id)
    })

    it('returns current active session ID', () => {
      const session = createSession()
      const { activeSessionId } = getSessions()

      expect(activeSessionId).toBe(session.id)
    })
  })

  describe('switchSession', () => {
    it('switches to the specified session', () => {
      const session1 = createSession()
      createSession() // session2 becomes active

      switchSession(session1.id)

      const { activeSessionId } = getSessions()
      expect(activeSessionId).toBe(session1.id)
    })

    it('throws error for non-existent session', () => {
      expect(() => switchSession('non-existent-id')).toThrow(
        'Session not found: non-existent-id'
      )
    })
  })

  describe('deleteSession', () => {
    it('deletes the specified session', () => {
      const session = createSession()
      deleteSession(session.id)

      const { sessions } = getSessions()
      expect(sessions).toHaveLength(0)
    })

    it('throws error for non-existent session', () => {
      expect(() => deleteSession('non-existent-id')).toThrow(
        'Session not found: non-existent-id'
      )
    })

    it('switches to most recently updated session when deleting active session', async () => {
      const session1 = createSession({ name: 'First' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session2 = createSession({ name: 'Second' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session3 = createSession({ name: 'Third' })

      // session3 is currently active
      deleteSession(session3.id)

      const { activeSessionId, sessions } = getSessions()
      // Should switch to session2 (second most recent)
      expect(activeSessionId).toBe(session2.id)
      expect(sessions).toHaveLength(2)
    })

    it('sets active to null when deleting the last session', () => {
      const session = createSession()
      deleteSession(session.id)

      const { activeSessionId, sessions } = getSessions()
      expect(activeSessionId).toBeNull()
      expect(sessions).toHaveLength(0)
    })

    it('preserves active session when deleting non-active session', async () => {
      const session1 = createSession()
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session2 = createSession() // This becomes active

      deleteSession(session1.id)

      const { activeSessionId } = getSessions()
      expect(activeSessionId).toBe(session2.id)
    })

    it('correctly handles updatedAt sorting when selecting fallback', async () => {
      // Create sessions with specific timestamps
      const session1 = createSession({ name: 'Oldest' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session2 = createSession({ name: 'Middle' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session3 = createSession({ name: 'Newest' })

      // Delete the newest (currently active)
      deleteSession(session3.id)

      const { activeSessionId } = getSessions()
      // Should select middle session, not oldest
      expect(activeSessionId).toBe(session2.id)
    })
  })

  describe('integration scenarios', () => {
    it('handles full session lifecycle', async () => {
      // Create sessions
      const session1 = createSession({ name: 'Session 1' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session2 = createSession({ name: 'Session 2' })

      expect(getSessions().sessions).toHaveLength(2)
      expect(getSessions().activeSessionId).toBe(session2.id)

      // Switch to first session
      switchSession(session1.id)
      expect(getSessions().activeSessionId).toBe(session1.id)

      // Delete second session (non-active)
      deleteSession(session2.id)
      expect(getSessions().sessions).toHaveLength(1)
      expect(getSessions().activeSessionId).toBe(session1.id)

      // Delete last session
      deleteSession(session1.id)
      expect(getSessions().sessions).toHaveLength(0)
      expect(getSessions().activeSessionId).toBeNull()
    })

    it('maintains correct sort order after multiple operations', async () => {
      const session1 = createSession({ name: 'A' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session2 = createSession({ name: 'B' })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const session3 = createSession({ name: 'C' })

      // Delete middle session
      deleteSession(session2.id)

      const { sessions } = getSessions()
      expect(sessions[0].id).toBe(session3.id)
      expect(sessions[1].id).toBe(session1.id)
    })
  })
})
