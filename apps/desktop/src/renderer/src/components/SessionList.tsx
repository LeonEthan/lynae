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
          aria-label="Create new session"
        >
          +
        </button>
      </div>

      <ul className="session-items">
        {sessions.length === 0 ? (
          <li className="empty-state">No sessions yet</li>
        ) : (
          sessions.map((session) => (
            <li
              key={session.id}
              className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
            >
              <button
                className="session-content"
                onClick={() => onSelectSession(session.id)}
                aria-label={`Select session ${session.name}`}
              >
                <div className="session-info">
                  <div className="session-name">{session.name}</div>
                  <div className="session-time">
                    {new Date(session.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              </button>
              <button
                className="delete-btn"
                onClick={() => onDeleteSession(session.id)}
                title="Delete session"
                aria-label={`Delete session ${session.name}`}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
