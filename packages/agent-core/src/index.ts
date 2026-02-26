// Agent Core - Task state machine and session orchestration
// PR-05 will implement full state machine

export type TaskState =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Task {
  id: string;
  sessionId: string;
  state: TaskState;
  plan?: ExecutionPlan;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionPlan {
  steps: PlanStep[];
  estimatedDuration?: number;
}

export interface PlanStep {
  id: string;
  description: string;
  toolName?: string;
  toolInput?: unknown;
  requiresApproval: boolean;
  dependencies: string[];
}

export interface AgentContext {
  workspaceRoot: string;
  sessionId: string;
}

export class TaskEngine {
  private tasks: Map<string, Task> = new Map();

  createTask(sessionId: string): Task {
    const task: Task = {
      id: generateId(),
      sessionId,
      state: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  transitionState(taskId: string, newState: TaskState): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.state = newState;
      task.updatedAt = new Date();
    }
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}