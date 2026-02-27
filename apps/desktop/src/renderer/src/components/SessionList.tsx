import type { Session } from '../../../types'

interface SessionListProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SessionListProps) {
  return (
    <div className="session-list">
      <div className="session-list-header">
        <h2>Sessions</h2>
        <button
          className="new-session-btn"
          onClick={onCreateSession}
          title="Create new session"
        >
          +
        </button>
      </div>

      <div className="session-items">
        {sessions.length === 0 ? (
          <div className="empty-state">No sessions yet</div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => onSelectSession(session.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectSession(session.id)
                }
              }}
              aria-pressed={session.id === activeSessionId}
            >
              <div className="session-info">
                <div className="session-name">{session.name}</div>
                <div className="session-time">
                  {new Date(session.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                className="delete-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteSession(session.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                  }
                }}
                title="Delete session"
                aria-label={`Delete session ${session.name}`}
              >
                ×
              </button>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
