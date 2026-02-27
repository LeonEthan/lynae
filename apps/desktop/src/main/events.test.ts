import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createRuntimeEvent,
  broadcastEvent,
  subscribeToEventStream,
  storeEvent,
  getEventsBySession,
  replayEvents,
  clearEvents,
  __resetEvents,
} from './events'
import type { RuntimeEvent, Event } from '../types'

describe('events', () => {
  beforeEach(() => {
    __resetEvents()
  })

  describe('createRuntimeEvent', () => {
    it('creates and stores a runtime event', () => {
      const event = createRuntimeEvent('session_1', 'runtime:text', {
        type: 'text',
        text: 'Hello',
      })

      expect(event.type).toBe('runtime:text')
      expect(event.sessionId).toBe('session_1')
      expect(event.content).toEqual({ type: 'text', text: 'Hello' })
      expect(event.id).toMatch(/^evt_\d+_\d+$/)
    })

    it('broadcasts event to subscribers', () => {
      const handler = vi.fn()
      subscribeToEventStream(handler)

      createRuntimeEvent('session_1', 'runtime:start', undefined, false)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'runtime:start',
          sessionId: 'session_1',
        })
      )
    })

    it('increments sequence counter once per event', () => {
      const event1 = createRuntimeEvent('session_1', 'runtime:text', {
        type: 'text',
        text: 'First',
      })
      const event2 = createRuntimeEvent('session_1', 'runtime:text', {
        type: 'text',
        text: 'Second',
      })

      expect(event2.sequence).toBe(event1.sequence + 1)
      // ID should contain the same sequence number
      expect(event1.id).toContain(`_${event1.sequence}`)
      expect(event2.id).toContain(`_${event2.sequence}`)
    })

    it('supports streaming event lifecycle', () => {
      const events: Event[] = []
      subscribeToEventStream((e) => events.push(e))

      const startEvent = createRuntimeEvent('session_1', 'runtime:start', undefined, false)
      const textEvent = createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Hello' }, false)
      const completeEvent = createRuntimeEvent('session_1', 'runtime:complete', undefined, true)

      expect(events).toHaveLength(3)
      expect(startEvent.isComplete).toBe(false)
      expect(textEvent.isComplete).toBe(false)
      expect(completeEvent.isComplete).toBe(true)
    })
  })

  describe('subscribeToEventStream', () => {
    it('returns unsubscribe function', () => {
      __resetEvents()
      const handler = vi.fn()
      const unsubscribe = subscribeToEventStream(handler)

      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'First' })
      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()

      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Second' })
      expect(handler).toHaveBeenCalledTimes(1) // Still 1, not 2
    })

    it('handles multiple subscribers', () => {
      __resetEvents()
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      subscribeToEventStream(handler1)
      subscribeToEventStream(handler2)

      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Hello' })

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })

    it('handles subscriber errors gracefully', () => {
      __resetEvents()
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error')
      })
      const goodHandler = vi.fn()

      subscribeToEventStream(errorHandler)
      subscribeToEventStream(goodHandler)

      // Should not throw
      expect(() => {
        createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Hello' })
      }).not.toThrow()

      expect(goodHandler).toHaveBeenCalledTimes(1)
      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error in event stream handler:', expect.any(Error))

      consoleErrorSpy.mockRestore()
    })
  })

  describe('broadcastEvent', () => {
    it('stores and broadcasts event', () => {
      const handler = vi.fn()
      subscribeToEventStream(handler)

      const event: RuntimeEvent = {
        id: 'test_1',
        type: 'runtime:text',
        sessionId: 'session_1',
        timestamp: Date.now(),
        sequence: 1,
        content: { type: 'text', text: 'Test' },
        isComplete: true,
      }

      broadcastEvent(event)

      expect(handler).toHaveBeenCalledWith(event)
    })
  })

  describe('getEventsBySession', () => {
    it('returns events for specific session only', () => {
      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Event 1' })
      createRuntimeEvent('session_2', 'runtime:text', { type: 'text', text: 'Event 2' })
      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Event 3' })

      const result = getEventsBySession('session_1')

      expect(result.events).toHaveLength(2)
      expect(result.events.every((e) => e.sessionId === 'session_1')).toBe(true)
      expect(result.totalAvailable).toBe(2)
    })

    it('filters by timestamp range', async () => {
      const before = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 10))

      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Middle' })

      await new Promise((resolve) => setTimeout(resolve, 10))
      const after = Date.now()

      const result = getEventsBySession('session_1', { fromTimestamp: before, toTimestamp: after })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].content).toEqual({ type: 'text', text: 'Middle' })
    })

    it('filters by event types', () => {
      createRuntimeEvent('session_1', 'runtime:start', undefined, false)
      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Hello' })
      createRuntimeEvent('session_1', 'runtime:complete', undefined, true)

      const result = getEventsBySession('session_1', { eventTypes: ['runtime:text'] })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('runtime:text')
    })

    it('supports pagination with limit', () => {
      for (let i = 0; i < 5; i++) {
        createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: `Event ${i}` })
      }

      const result = getEventsBySession('session_1', { limit: 3 })

      expect(result.events).toHaveLength(3)
      expect(result.totalAvailable).toBe(5)
      expect(result.hasMore).toBe(true)
    })
  })

  describe('replayEvents', () => {
    it('returns all events sorted by sequence', () => {
      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'First' })
      createRuntimeEvent('session_2', 'runtime:text', { type: 'text', text: 'Second' })
      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Third' })

      const result = replayEvents()

      expect(result.events).toHaveLength(3)
      // Should be sorted by sequence
      expect(result.events[0].sequence).toBeLessThan(result.events[1].sequence)
      expect(result.events[1].sequence).toBeLessThan(result.events[2].sequence)
    })

    it('filters by event type globally', () => {
      createRuntimeEvent('session_1', 'runtime:start', undefined, false)
      createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Hello' })
      createRuntimeEvent('session_2', 'runtime:text', { type: 'text', text: 'World' })
      createRuntimeEvent('session_1', 'runtime:complete', undefined, true)

      const result = replayEvents({ eventTypes: ['runtime:text'] })

      expect(result.events).toHaveLength(2)
      expect(result.events.every((e) => e.type === 'runtime:text')).toBe(true)
    })
  })

  describe('event lifecycle', () => {
    it('handles complete streaming conversation', () => {
      const events: Event[] = []
      subscribeToEventStream((e) => events.push(e))

      // Simulate a complete streaming response
      const start = createRuntimeEvent('session_1', 'runtime:start', undefined, false)
      const thinking = createRuntimeEvent('session_1', 'runtime:thinking', {
        type: 'thinking',
        text: 'Analyzing...',
      })
      const text1 = createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'Hello ' }, false)
      const text2 = createRuntimeEvent('session_1', 'runtime:text', { type: 'text', text: 'world' }, false)
      const complete = createRuntimeEvent('session_1', 'runtime:complete', undefined, true)

      expect(events).toHaveLength(5)
      expect(start.type).toBe('runtime:start')
      expect(thinking.content).toEqual({ type: 'thinking', text: 'Analyzing...' })
      expect(complete.type).toBe('runtime:complete')

      // Verify stored events
      const sessionEvents = getEventsBySession('session_1')
      expect(sessionEvents.events).toHaveLength(5)
    })
  })
})
