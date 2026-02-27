import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { SessionList } from './components/SessionList'
import { ChatArea } from './components/ChatArea'
import { TaskPanel } from './components/TaskPanel'
import type { Session } from '../../types'

function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load sessions on mount
  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = async () => {
    try {
      const response = await window.electronAPI.getSessions()
      setSessions(response.sessions)
      setActiveSessionId(response.activeSessionId)
    } catch (error) {
      console.error('Failed to load sessions:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateSession = useCallback(async () => {
    try {
      const newSession = await window.electronAPI.createSession()
      setSessions((prev) => [newSession, ...prev])
      setActiveSessionId(newSession.id)
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }, [])

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      await window.electronAPI.switchSession(sessionId)
      setActiveSessionId(sessionId)
    } catch (error) {
      console.error('Failed to switch session:', error)
    }
  }, [])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await window.electronAPI.deleteSession(sessionId)
      const response = await window.electronAPI.getSessions()
      setSessions(response.sessions)
      setActiveSessionId(response.activeSessionId)
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }, [])

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null

  if (isLoading) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    )
  }

  return (
    <div className="app">
      <main className="app-main">
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
        />
        <ChatArea activeSession={activeSession} />
        <TaskPanel />
      </main>
    </div>
  )
}

export default App
