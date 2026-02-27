import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatArea } from './ChatArea'
import type { Event, Session } from '../../../types'

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn()

// Mock electron API
const mockOnEventStream = vi.fn()
const mockGetEventsBySession = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.electronAPI = {
    ...window.electronAPI,
    onEventStream: mockOnEventStream,
    getEventsBySession: mockGetEventsBySession,
  } as typeof window.electronAPI
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatArea', () => {
  const mockSession: Session = {
    id: 'session_1',
    name: 'Test Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  describe('streaming completion', () => {
    it('captures final text on runtime:complete without stale closure', async () => {
      const unsubscribe = vi.fn()
      let eventHandler: ((event: Event) => void) | null = null

      mockOnEventStream.mockImplementation((handler: (event: Event) => void) => {
        eventHandler = handler
        return unsubscribe
      })

      mockGetEventsBySession.mockResolvedValue({ events: [], totalAvailable: 0, hasMore: false })

      render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockOnEventStream).toHaveBeenCalled())

      // Simulate streaming events
      act(() => {
        eventHandler!({
          id: 'evt_1',
          type: 'runtime:start',
          sessionId: 'session_1',
          timestamp: Date.now(),
          sequence: 1,
          isComplete: false,
        })
      })

      // Stream text chunks
      act(() => {
        eventHandler!({
          id: 'evt_2',
          type: 'runtime:text',
          sessionId: 'session_1',
          timestamp: Date.now(),
          sequence: 2,
          content: { type: 'text', text: 'Hello ' },
          isComplete: false,
        })
      })

      act(() => {
        eventHandler!({
          id: 'evt_3',
          type: 'runtime:text',
          sessionId: 'session_1',
          timestamp: Date.now(),
          sequence: 3,
          content: { type: 'text', text: 'world!' },
          isComplete: false,
        })
      })

      // Complete event - should capture accumulated text
      act(() => {
        eventHandler!({
          id: 'evt_4',
          type: 'runtime:complete',
          sessionId: 'session_1',
          timestamp: Date.now(),
          sequence: 4,
          isComplete: true,
        })
      })

      // The accumulated text should be preserved as a display event
      await waitFor(() => {
        const messages = screen.getAllByText(/Hello world!/)
        expect(messages.length).toBeGreaterThan(0)
      })
    })

    it('renders streaming text with cursor during active stream', async () => {
      const unsubscribe = vi.fn()
      let eventHandler: ((event: Event) => void) | null = null

      mockOnEventStream.mockImplementation((handler: (event: Event) => void) => {
        eventHandler = handler
        return unsubscribe
      })

      mockGetEventsBySession.mockResolvedValue({ events: [], totalAvailable: 0, hasMore: false })

      render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockOnEventStream).toHaveBeenCalled())

      act(() => {
        eventHandler!({
          id: 'evt_1',
          type: 'runtime:start',
          sessionId: 'session_1',
          timestamp: Date.now(),
          sequence: 1,
        })
      })

      act(() => {
        eventHandler!({
          id: 'evt_2',
          type: 'runtime:text',
          sessionId: 'session_1',
          timestamp: Date.now(),
          sequence: 2,
          content: { type: 'text', text: 'Streaming' },
        })
      })

      // Should show streaming text with cursor
      expect(screen.getByText('Streaming')).toBeInTheDocument()
    })

    it('handles thinking indicators', async () => {
      const unsubscribe = vi.fn()
      let eventHandler: ((event: Event) => void) | null = null

      mockOnEventStream.mockImplementation((handler: (event: Event) => void) => {
        eventHandler = handler
        return unsubscribe
      })

      mockGetEventsBySession.mockResolvedValue({ events: [], totalAvailable: 0, hasMore: false })

      render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockOnEventStream).toHaveBeenCalled())

      act(() => {
        eventHandler!({
          id: 'evt_1',
          type: 'runtime:thinking',
          sessionId: 'session_1',
          timestamp: Date.now(),
          sequence: 1,
          content: { type: 'thinking', text: 'Analyzing code...' },
        })
      })

      expect(screen.getByText(/Analyzing/)).toBeInTheDocument()
    })

    it('handles tool call events', async () => {
      const unsubscribe = vi.fn()
      let eventHandler: ((event: Event) => void) | null = null

      mockOnEventStream.mockImplementation((handler: (event: Event) => void) => {
        eventHandler = handler
        return unsubscribe
      })

      mockGetEventsBySession.mockResolvedValue({ events: [], totalAvailable: 0, hasMore: false })

      render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockOnEventStream).toHaveBeenCalled())

      act(() => {
        eventHandler!({
          id: 'evt_1',
          type: 'runtime:tool_call',
          sessionId: 'session_1',
          timestamp: Date.now(),
          sequence: 1,
          content: {
            type: 'tool_call',
            toolCallId: 'tool_1',
            toolName: 'file:read',
            arguments: { path: '/src/main.ts' },
          },
        })
      })

      expect(screen.getByText(/Using tool/)).toBeInTheDocument()
    })
  })

  describe('session-switch race handling', () => {
    it('ignores events from previous session after switching', async () => {
      const unsubscribe = vi.fn()
      let eventHandler: ((event: Event) => void) | null = null

      mockOnEventStream.mockImplementation((handler: (event: Event) => void) => {
        eventHandler = handler
        return unsubscribe
      })

      // Delay getEventsBySession to simulate slow network
      let resolveFirstSession: (value: { events: Event[]; totalAvailable: number; hasMore: boolean }) => void
      const firstSessionPromise = new Promise<{
        events: Event[]
        totalAvailable: number
        hasMore: boolean
      }>((resolve) => {
        resolveFirstSession = resolve
      })

      mockGetEventsBySession.mockReturnValueOnce(firstSessionPromise)

      const { rerender } = render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockOnEventStream).toHaveBeenCalled())

      // Switch to different session before first loads
      const newSession: Session = {
        id: 'session_2',
        name: 'New Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      mockGetEventsBySession.mockResolvedValueOnce({
        events: [
          {
            id: 'evt_new',
            type: 'runtime:text',
            sessionId: 'session_2',
            timestamp: Date.now(),
            sequence: 1,
            content: { type: 'text', text: 'New session event' },
          },
        ],
        totalAvailable: 1,
        hasMore: false,
      })

      rerender(<ChatArea activeSession={newSession} />)

      // Now resolve the old session's events
      act(() => {
        resolveFirstSession!({
          events: [
            {
              id: 'evt_old',
              type: 'runtime:text',
              sessionId: 'session_1',
              timestamp: Date.now(),
              sequence: 1,
              content: { type: 'text', text: 'Old session event' },
            },
          ],
          totalAvailable: 1,
          hasMore: false,
        })
      })

      // Should show new session event, not old
      await waitFor(() => {
        expect(screen.getByText('New session event')).toBeInTheDocument()
      })

      expect(screen.queryByText('Old session event')).not.toBeInTheDocument()
    })

    it('cleans up subscription when session changes', async () => {
      const unsubscribe1 = vi.fn()
      const unsubscribe2 = vi.fn()

      mockOnEventStream
        .mockReturnValueOnce(unsubscribe1)
        .mockReturnValueOnce(unsubscribe2)

      mockGetEventsBySession.mockResolvedValue({ events: [], totalAvailable: 0, hasMore: false })

      const { rerender } = render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockOnEventStream).toHaveBeenCalledTimes(1))

      const newSession: Session = {
        id: 'session_2',
        name: 'New Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      rerender(<ChatArea activeSession={newSession} />)

      await waitFor(() => expect(mockOnEventStream).toHaveBeenCalledTimes(2))

      expect(unsubscribe1).toHaveBeenCalled()
    })

    it('clears events when session becomes null', async () => {
      mockGetEventsBySession.mockResolvedValue({
        events: [
          {
            id: 'evt_1',
            type: 'runtime:text',
            sessionId: 'session_1',
            timestamp: Date.now(),
            sequence: 1,
            content: { type: 'text', text: 'Session event' },
          },
        ],
        totalAvailable: 1,
        hasMore: false,
      })

      const { rerender } = render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => {
        expect(screen.getByText('Session event')).toBeInTheDocument()
      })

      // Clear session
      rerender(<ChatArea activeSession={null} />)

      // Should show welcome screen
      expect(screen.getByText('Welcome to Lynae')).toBeInTheDocument()
      expect(screen.queryByText('Session event')).not.toBeInTheDocument()
    })
  })

  describe('simulate streaming button', () => {
    it('simulates word-by-word streaming on button click', async () => {
      mockGetEventsBySession.mockResolvedValue({ events: [], totalAvailable: 0, hasMore: false })

      render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockGetEventsBySession).toHaveBeenCalled())

      const simulateBtn = screen.getByText('Simulate Stream')
      await userEvent.click(simulateBtn)

      // Button should show streaming state
      await waitFor(() => {
        expect(screen.getByText('Streaming...')).toBeInTheDocument()
      })

      // Wait for streaming to complete
      await waitFor(() => {
        expect(screen.getByText('Simulate Stream')).toBeInTheDocument()
      }, { timeout: 5000 })
    })

    it('disables input during streaming', async () => {
      mockGetEventsBySession.mockResolvedValue({ events: [], totalAvailable: 0, hasMore: false })

      render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockGetEventsBySession).toHaveBeenCalled())

      const simulateBtn = screen.getByText('Simulate Stream')
      await userEvent.click(simulateBtn)

      // Input should be disabled
      const input = screen.getByPlaceholderText('Type your message...')
      expect(input).toBeDisabled()

      // Send button should be disabled
      const sendBtn = screen.getByText('Send')
      expect(sendBtn).toBeDisabled()
    })
  })

  describe('welcome state', () => {
    it('shows welcome message when no session selected', () => {
      render(<ChatArea activeSession={null} />)

      expect(screen.getByText('Welcome to Lynae')).toBeInTheDocument()
      expect(screen.getByText(/Select or create a session/)).toBeInTheDocument()
    })

    it('shows session-specific welcome when session has no events', async () => {
      mockGetEventsBySession.mockResolvedValue({ events: [], totalAvailable: 0, hasMore: false })

      render(<ChatArea activeSession={mockSession} />)

      await waitFor(() => expect(mockGetEventsBySession).toHaveBeenCalled())

      expect(screen.getByText(/Welcome to session "Test Session"/)).toBeInTheDocument()
    })
  })
})
