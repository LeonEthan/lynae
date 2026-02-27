import { useState } from 'react'
import type { Session } from '../../../types'

interface ChatAreaProps {
  activeSession: Session | null
}

export function ChatArea({ activeSession }: ChatAreaProps) {
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !activeSession) return

    // Placeholder for sending message (will be implemented in PR-05+)
    console.log('Sending message in session', activeSession.id, ':', input)
    setInput('')
  }

  if (!activeSession) {
    return (
      <div className="chat-area">
        <div className="chat-empty">
          <h2>Welcome to Lynae</h2>
          <p>Select or create a session to start coding with AI.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-area">
      <div className="chat-header">
        <h2>{activeSession.name}</h2>
      </div>

      <div className="chat-messages">
        <div className="welcome-message">
          <p>Welcome to session "{activeSession.name}"!</p>
          <p className="hint">
            Type a message below to start interacting with the AI assistant.
          </p>
        </div>
      </div>

      <form className="chat-input-area" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="chat-input"
        />
        <button
          type="submit"
          className="send-btn"
          disabled={!input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  )
}
