import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Lynae</h1>
        <p>Desktop AI Coding Workbench</p>
      </header>
      <main className="app-main">
        <div className="sidebar">
          <h2>Sessions</h2>
          <p>No sessions yet</p>
        </div>
        <div className="chat-area">
          <h2>Chat</h2>
          <p>Welcome to Lynae! Start a new session to begin coding with AI.</p>
        </div>
        <div className="task-panel">
          <h2>Tasks</h2>
          <p>No active tasks</p>
        </div>
      </main>
    </div>
  )
}

export default App
