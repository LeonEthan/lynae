import { useCallback, useEffect, useRef, useState } from 'react'
import type { Event, RuntimeEvent, RuntimeEventContent, Session } from '../../../types'

interface ChatAreaProps {
  activeSession: Session | null
}

type DisplayEvent = Event & { displayText?: string }

function renderEventContent(content: RuntimeEventContent | undefined): string {
  if (!content) return ''
  switch (content.type) {
    case 'text':
      return content.text
    case 'thinking':
      return `💭 ${content.text}`
    case 'code':
      return `\`\`\`${content.language}\n${content.code}\n\`\`\``
    case 'tool_call':
      return `🔧 Calling tool: ${content.toolName}`
    case 'tool_result':
      return content.error ? `❌ Error: ${content.error}` : `✅ Tool result received`
    default:
      return ''
  }
}

function isRuntimeEvent(event: Event): event is RuntimeEvent {
  return [
    'runtime:start',
    'runtime:thinking',
    'runtime:text',
    'runtime:code',
    'runtime:tool_call',
    'runtime:tool_result',
    'runtime:error',
    'runtime:complete',
  ].includes(event.type)
}

export function ChatArea({ activeSession }: ChatAreaProps) {
  const [input, setInput] = useState('')
  const [events, setEvents] = useState<DisplayEvent[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const streamingTextRef = useRef('')
  const sessionIdRef = useRef<string | null>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events, streamingText])

  // Keep refs in sync with state
  useEffect(() => {
    streamingTextRef.current = streamingText
  }, [streamingText])

  // Subscribe to event stream when session changes
  useEffect(() => {
    if (!activeSession) {
      setEvents([])
      setStreamingText('')
      streamingTextRef.current = ''
      setIsStreaming(false)
      sessionIdRef.current = null
      return
    }

    // Track the current session ID for race condition guard
    sessionIdRef.current = activeSession.id

    // Load existing events for this session
    loadSessionEvents(activeSession.id)

    // Subscribe to real-time events
    const unsubscribe = window.electronAPI.onEventStream((event) => {
      // Race condition guard: only process events for the current session
      if (event.sessionId === sessionIdRef.current) {
        handleIncomingEvent(event)
      }
    })

    unsubscribeRef.current = unsubscribe

    return () => {
      unsubscribe()
      unsubscribeRef.current = null
    }
  }, [activeSession?.id])

  const loadSessionEvents = async (sessionId: string) => {
    try {
      const result = await window.electronAPI.getEventsBySession(sessionId)
      // Race condition guard: only update if this is still the current session
      if (sessionId === sessionIdRef.current) {
        setEvents(result.events.map(e => ({ ...e, displayText: buildDisplayText(e) })))
      }
    } catch (error) {
      console.error('Failed to load events:', error)
    }
  }

  const handleIncomingEvent = useCallback((event: Event) => {
    if (isRuntimeEvent(event)) {
      const runtimeEvent = event as RuntimeEvent

      if (runtimeEvent.type === 'runtime:start') {
        setIsStreaming(true)
        setStreamingText('')
        streamingTextRef.current = ''
      } else if (runtimeEvent.type === 'runtime:text' && runtimeEvent.content?.type === 'text') {
        const textContent = runtimeEvent.content as { type: 'text'; text: string }
        streamingTextRef.current += textContent.text
        setStreamingText(streamingTextRef.current)
      } else if (runtimeEvent.type === 'runtime:complete') {
        setIsStreaming(false)
        // Use ref to get latest value, avoiding stale closure
        const finalText = streamingTextRef.current
        setStreamingText('')
        streamingTextRef.current = ''
        setEvents(prev => [...prev, { ...event, displayText: finalText }])
      } else if (runtimeEvent.type === 'runtime:thinking') {
        const thinkingText = renderEventContent(runtimeEvent.content)
        streamingTextRef.current += thinkingText
        setStreamingText(streamingTextRef.current)
      } else {
        setEvents(prev => [...prev, { ...event, displayText: renderEventContent(runtimeEvent.content) }])
      }
    } else {
      setEvents(prev => [...prev, { ...event, displayText: buildDisplayText(event) }])
    }
  }, [])

  const buildDisplayText = (event: Event): string => {
    if (isRuntimeEvent(event)) {
      return renderEventContent((event as RuntimeEvent).content)
    }
    return `[${event.type}]`
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !activeSession) return

    // Placeholder for sending message (will be implemented in PR-05+)
    console.log('Sending message in session', activeSession.id, ':', input)
    setInput('')
  }

  const simulateStreaming = async () => {
    if (!activeSession || isStreaming) return

    setIsStreaming(true)
    setStreamingText('')
    streamingTextRef.current = ''

    // Simulate streaming text word by word
    const message = "I can help you with that. Let me analyze the codebase structure and provide insights."
    const words = message.split(' ')

    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      const chunk = (i > 0 ? ' ' : '') + words[i]
      streamingTextRef.current += chunk
      setStreamingText(streamingTextRef.current)
    }

    await new Promise(resolve => setTimeout(resolve, 300))
    setEvents(prev => [...prev, {
      id: `sim_${Date.now()}`,
      type: 'runtime:text',
      sessionId: activeSession.id,
      timestamp: Date.now(),
      sequence: Date.now(),
      displayText: streamingTextRef.current,
      content: { type: 'text', text: streamingTextRef.current },
      isComplete: true,
    } as DisplayEvent])

    setIsStreaming(false)
    setStreamingText('')
    streamingTextRef.current = ''
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
        <button
          className="simulate-btn"
          onClick={simulateStreaming}
          disabled={isStreaming}
        >
          {isStreaming ? 'Streaming...' : 'Simulate Stream'}
        </button>
      </div>

      <div className="chat-messages">
        {events.length === 0 && !streamingText && (
          <div className="welcome-message">
            <p>Welcome to session "{activeSession.name}"!</p>
            <p className="hint">
              Type a message below to start interacting with the AI assistant.
              <br />
              Or click "Simulate Stream" to test event streaming.
            </p>
          </div>
        )}

        {events.map((event, index) => (
          <div key={event.id} className={`message ${event.type.startsWith('runtime:') ? 'assistant' : 'system'}`}>
            {event.type.startsWith('runtime:thinking') && (
              <div className="thinking-indicator">💭 Thinking...</div>
            )}
            {event.type.startsWith('runtime:tool_call') && (
              <div className="tool-call">🔧 Using tool...</div>
            )}
            {event.displayText && <div className="message-content">{event.displayText}</div>}
          </div>
        ))}

        {streamingText && (
          <div className="message assistant streaming">
            <div className="message-content">{streamingText}</div>
            <span className="cursor">▊</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="chat-input"
          disabled={isStreaming}
        />
        <button
          type="submit"
          className="send-btn"
          disabled={!input.trim() || isStreaming}
        >
          Send
        </button>
      </form>
    </div>
  )
}
