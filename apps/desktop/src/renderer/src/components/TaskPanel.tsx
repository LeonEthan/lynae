interface Task {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

interface TaskPanelProps {
  tasks?: Task[]
}

export function TaskPanel({ tasks = [] }: TaskPanelProps) {
  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <h2>Tasks</h2>
      </div>

      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty-state">
            <p>No active tasks</p>
            <span className="hint">Tasks will appear here when you start working</span>
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className={`task-item ${task.status}`}>
              <div className={`task-status-indicator ${task.status}`} />
              <div className="task-name">{task.name}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
