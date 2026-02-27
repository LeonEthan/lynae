import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionList } from './SessionList'
import type { Session } from '../../../types'

const mockSessions: Session[] = [
  {
    id: 'session_1',
    name: 'Test Session 1',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'session_2',
    name: 'Test Session 2',
    createdAt: 1700000100000,
    updatedAt: 1700000100000,
  },
]

describe('SessionList', () => {
  const defaultProps = {
    sessions: mockSessions,
    activeSessionId: 'session_1',
    onSelectSession: vi.fn(),
    onCreateSession: vi.fn(),
    onDeleteSession: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders session list with correct heading', () => {
      render(<SessionList {...defaultProps} />)
      expect(screen.getByRole('heading', { name: /sessions/i })).toBeInTheDocument()
    })

    it('renders all sessions with their names', () => {
      render(<SessionList {...defaultProps} />)
      expect(screen.getByText('Test Session 1')).toBeInTheDocument()
      expect(screen.getByText('Test Session 2')).toBeInTheDocument()
    })

    it('renders empty state when no sessions', () => {
      render(<SessionList {...defaultProps} sessions={[]} />)
      expect(screen.getByText(/no sessions yet/i)).toBeInTheDocument()
    })

    it('renders create button', () => {
      render(<SessionList {...defaultProps} />)
      expect(screen.getByRole('button', { name: /create new session/i })).toBeInTheDocument()
    })
  })

  describe('accessibility - keyboard navigation', () => {
    it('allows tab navigation to all interactive elements', async () => {
      const user = userEvent.setup()
      render(<SessionList {...defaultProps} />)

      const createBtn = screen.getByRole('button', { name: /create new session/i })
      const selectBtn1 = screen.getByRole('button', { name: /select session test session 1/i })
      const deleteBtn1 = screen.getByRole('button', { name: /delete session test session 1/i })
      const selectBtn2 = screen.getByRole('button', { name: /select session test session 2/i })
      const deleteBtn2 = screen.getByRole('button', { name: /delete session test session 2/i })

      // Tab through all interactive elements
      await user.tab()
      expect(createBtn).toHaveFocus()

      await user.tab()
      expect(selectBtn1).toHaveFocus()

      await user.tab()
      expect(deleteBtn1).toHaveFocus()

      await user.tab()
      expect(selectBtn2).toHaveFocus()

      await user.tab()
      expect(deleteBtn2).toHaveFocus()
    })

    it('activates session selection with Enter key', async () => {
      const user = userEvent.setup()
      const onSelectSession = vi.fn()
      render(<SessionList {...defaultProps} onSelectSession={onSelectSession} />)

      const selectBtn = screen.getByRole('button', { name: /select session test session 2/i })
      selectBtn.focus()

      await user.keyboard('{Enter}')
      expect(onSelectSession).toHaveBeenCalledWith('session_2')
    })

    it('activates session selection with Space key', async () => {
      const user = userEvent.setup()
      const onSelectSession = vi.fn()
      render(<SessionList {...defaultProps} onSelectSession={onSelectSession} />)

      const selectBtn = screen.getByRole('button', { name: /select session test session 2/i })
      selectBtn.focus()

      await user.keyboard(' ')
      expect(onSelectSession).toHaveBeenCalledWith('session_2')
    })

    it('activates delete with Enter key', async () => {
      const user = userEvent.setup()
      const onDeleteSession = vi.fn()
      render(<SessionList {...defaultProps} onDeleteSession={onDeleteSession} />)

      const deleteBtn = screen.getByRole('button', { name: /delete session test session 1/i })
      deleteBtn.focus()

      await user.keyboard('{Enter}')
      expect(onDeleteSession).toHaveBeenCalledWith('session_1')
    })

    it('activates delete with Space key', async () => {
      const user = userEvent.setup()
      const onDeleteSession = vi.fn()
      render(<SessionList {...defaultProps} onDeleteSession={onDeleteSession} />)

      const deleteBtn = screen.getByRole('button', { name: /delete session test session 1/i })
      deleteBtn.focus()

      await user.keyboard(' ')
      expect(onDeleteSession).toHaveBeenCalledWith('session_1')
    })

    it('activates create button with Enter key', async () => {
      const user = userEvent.setup()
      const onCreateSession = vi.fn()
      render(<SessionList {...defaultProps} onCreateSession={onCreateSession} />)

      const createBtn = screen.getByRole('button', { name: /create new session/i })
      createBtn.focus()

      await user.keyboard('{Enter}')
      expect(onCreateSession).toHaveBeenCalled()
    })
  })

  describe('accessibility - semantics', () => {
    it('uses semantic list structure', () => {
      render(<SessionList {...defaultProps} />)
      const list = screen.getByRole('list')
      expect(list).toBeInTheDocument()

      const items = within(list).getAllByRole('listitem')
      expect(items).toHaveLength(2)
    })

    it('provides accessible labels for session selection buttons', () => {
      render(<SessionList {...defaultProps} />)

      const selectBtn1 = screen.getByRole('button', { name: /select session test session 1/i })
      const selectBtn2 = screen.getByRole('button', { name: /select session test session 2/i })

      expect(selectBtn1).toHaveAttribute('aria-label', 'Select session Test Session 1')
      expect(selectBtn2).toHaveAttribute('aria-label', 'Select session Test Session 2')
    })

    it('provides accessible labels for delete buttons', () => {
      render(<SessionList {...defaultProps} />)

      const deleteBtn1 = screen.getByRole('button', { name: /delete session test session 1/i })
      const deleteBtn2 = screen.getByRole('button', { name: /delete session test session 2/i })

      expect(deleteBtn1).toHaveAttribute('aria-label', 'Delete session Test Session 1')
      expect(deleteBtn2).toHaveAttribute('aria-label', 'Delete session Test Session 2')
    })

    it('marks active session with visual class', () => {
      render(<SessionList {...defaultProps} activeSessionId="session_2" />)

      const items = screen.getAllByRole('listitem')
      expect(items[0]).not.toHaveClass('active')
      expect(items[1]).toHaveClass('active')
    })
  })

  describe('interactions', () => {
    it('calls onSelectSession when clicking session content', async () => {
      const user = userEvent.setup()
      const onSelectSession = vi.fn()
      render(<SessionList {...defaultProps} onSelectSession={onSelectSession} />)

      const selectBtn = screen.getByRole('button', { name: /select session test session 2/i })
      await user.click(selectBtn)

      expect(onSelectSession).toHaveBeenCalledWith('session_2')
    })

    it('calls onDeleteSession when clicking delete button', async () => {
      const user = userEvent.setup()
      const onDeleteSession = vi.fn()
      render(<SessionList {...defaultProps} onDeleteSession={onDeleteSession} />)

      const deleteBtn = screen.getByRole('button', { name: /delete session test session 1/i })
      await user.click(deleteBtn)

      expect(onDeleteSession).toHaveBeenCalledWith('session_1')
    })

    it('calls onCreateSession when clicking create button', async () => {
      const user = userEvent.setup()
      const onCreateSession = vi.fn()
      render(<SessionList {...defaultProps} onCreateSession={onCreateSession} />)

      const createBtn = screen.getByRole('button', { name: /create new session/i })
      await user.click(createBtn)

      expect(onCreateSession).toHaveBeenCalled()
    })
  })
})
