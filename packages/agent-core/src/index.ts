// Agent Core - Task state machine and session orchestration
// PR-05: Full state machine implementation with events, cancellation, and storage integration

// ============================================================================
// Types and Enums
// ============================================================================

export type TaskState =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Task {
  id: string;
  sessionId: string;
  state: TaskState;
  plan?: ExecutionPlan;
  currentStepIndex: number;
  context: AgentContext;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface ExecutionPlan {
  id: string;
  steps: PlanStep[];
  estimatedDuration?: number;
  parallelExecution: boolean;
  metadata?: Record<string, unknown>;
}

export interface PlanStep {
  id: string;
  description: string;
  toolName?: string;
  toolInput?: unknown;
  requiresApproval: boolean;
  dependencies: string[];
  status: StepStatus;
  order: number;
  executionTimeMs?: number;
  error?: string;
  output?: unknown;
}

export interface AgentContext {
  workspaceRoot: string;
  sessionId: string;
  abortController: AbortController;
  metadata: Map<string, unknown>;
}

// ============================================================================
// Valid State Transitions Matrix
// ============================================================================

const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  idle: ['planning', 'cancelled'],
  planning: ['awaiting_approval', 'executing', 'failed', 'cancelled'],
  awaiting_approval: ['executing', 'cancelled'],
  executing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

// ============================================================================
// Event System
// ============================================================================

export type TaskEventType =
  | 'task:created'
  | 'task:state_changed'
  | 'task:plan_created'
  | 'task:step_started'
  | 'task:step_completed'
  | 'task:step_failed'
  | 'task:approval_required'
  | 'task:cancelled'
  | 'task:completed'
  | 'task:error';

export interface TaskEvent {
  type: TaskEventType;
  taskId: string;
  sessionId: string;
  timestamp: number;
  data?: unknown;
}

export interface TaskStateChangedEvent extends TaskEvent {
  type: 'task:state_changed';
  data: {
    previousState: TaskState;
    newState: TaskState;
    reason?: string;
  };
}

export interface TaskStepEvent extends TaskEvent {
  type: 'task:step_started' | 'task:step_completed' | 'task:step_failed';
  data: {
    stepId: string;
    stepIndex: number;
    description: string;
    output?: unknown;
    error?: string;
    executionTimeMs?: number;
  };
}

export interface TaskPlanCreatedEvent extends TaskEvent {
  type: 'task:plan_created';
  data: {
    planId: string;
    stepCount: number;
    estimatedDuration?: number;
  };
}

export interface TaskApprovalRequiredEvent extends TaskEvent {
  type: 'task:approval_required';
  data: {
    stepId: string;
    description: string;
    toolName?: string;
    toolInput?: unknown;
  };
}

export type TaskEventHandler = (event: TaskEvent) => void;
export type TaskEventFilter = (event: TaskEvent) => boolean;

// ============================================================================
// Storage Integration Interface
// ============================================================================

export interface TaskStorage {
  createTask(task: Task): Promise<void>;
  updateTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | undefined>;
  getTasksBySession(sessionId: string): Promise<Task[]>;
  deleteTask(id: string): Promise<void>;
}

// ============================================================================
// State Transition Error
// ============================================================================

export class StateTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly fromState: TaskState,
    public readonly toState: TaskState
  ) {
    super(
      `Invalid state transition for task ${taskId}: ${fromState} -> ${toState}`
    );
    this.name = 'StateTransitionError';
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskCancelledError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} was cancelled`);
    this.name = 'TaskCancelledError';
  }
}

// ============================================================================
// Event Emitter
// ============================================================================

class TaskEventEmitter {
  private handlers: Map<TaskEventType, Set<TaskEventHandler>> = new Map();
  private globalHandlers: Set<TaskEventHandler> = new Set();

  on(eventType: TaskEventType, handler: TaskEventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  onAny(handler: TaskEventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  emit(event: TaskEvent): void {
    // Call type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      typeHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in event handler for ${event.type}:`, error);
        }
      });
    }

    // Call global handlers
    this.globalHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in global event handler:', error);
      }
    });
  }
}

// ============================================================================
// Task Engine
// ============================================================================

export interface TaskEngineOptions {
  storage?: TaskStorage;
  enablePersistence?: boolean;
}

export class TaskEngine {
  private tasks: Map<string, Task> = new Map();
  private eventEmitter = new TaskEventEmitter();
  private storage?: TaskStorage;
  private enablePersistence: boolean;

  constructor(options: TaskEngineOptions = {}) {
    this.storage = options.storage;
    this.enablePersistence = options.enablePersistence ?? false;
  }

  // ========================================================================
  // Task Lifecycle
  // ========================================================================

  createTask(sessionId: string, workspaceRoot: string): Task {
    const abortController = new AbortController();

    const task: Task = {
      id: generateId(),
      sessionId,
      state: 'idle',
      currentStepIndex: -1,
      context: {
        workspaceRoot,
        sessionId,
        abortController,
        metadata: new Map(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tasks.set(task.id, task);

    // Persist if storage is enabled
    if (this.enablePersistence && this.storage) {
      this.storage.createTask(task).catch((error) => {
        console.error('Failed to persist task:', error);
      });
    }

    // Emit event
    this.eventEmitter.emit({
      type: 'task:created',
      taskId: task.id,
      sessionId,
      timestamp: Date.now(),
      data: { workspaceRoot },
    });

    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getTasksBySession(sessionId: string): Task[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.sessionId === sessionId
    );
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  // ========================================================================
  // State Transitions
  // ========================================================================

  /**
   * Validate and execute a state transition
   */
  transitionState(
    taskId: string,
    newState: TaskState,
    reason?: string
  ): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const currentState = task.state;

    // Validate transition
    if (!this.isValidTransition(currentState, newState)) {
      throw new StateTransitionError(taskId, currentState, newState);
    }

    // Check if task has been cancelled
    if (task.context.abortController.signal.aborted && newState !== 'cancelled') {
      throw new TaskCancelledError(taskId);
    }

    // Update state
    task.state = newState;
    task.updatedAt = new Date();

    if (newState === 'completed' || newState === 'failed' || newState === 'cancelled') {
      task.completedAt = new Date();
    }

    // Persist if storage is enabled
    if (this.enablePersistence && this.storage) {
      this.storage.updateTask(task).catch((error) => {
        console.error('Failed to update task:', error);
      });
    }

    // Emit state change event
    this.eventEmitter.emit({
      type: 'task:state_changed',
      taskId,
      sessionId: task.sessionId,
      timestamp: Date.now(),
      data: {
        previousState: currentState,
        newState,
        reason,
      },
    } as TaskStateChangedEvent);

    // Emit completion event for terminal states
    if (newState === 'completed') {
      this.eventEmitter.emit({
        type: 'task:completed',
        taskId,
        sessionId: task.sessionId,
        timestamp: Date.now(),
        data: { completedAt: task.completedAt },
      });
    } else if (newState === 'cancelled') {
      this.eventEmitter.emit({
        type: 'task:cancelled',
        taskId,
        sessionId: task.sessionId,
        timestamp: Date.now(),
        data: { reason },
      });
    }

    return task;
  }

  /**
   * Check if a state transition is valid
   */
  isValidTransition(fromState: TaskState, toState: TaskState): boolean {
    if (fromState === toState) return true; // Allow staying in same state
    const validTransitions = VALID_TRANSITIONS[fromState];
    return validTransitions.includes(toState);
  }

  /**
   * Get valid next states for a given state
   */
  getValidNextStates(state: TaskState): TaskState[] {
    return [...VALID_TRANSITIONS[state]];
  }

  // ========================================================================
  // Plan Management
  // ========================================================================

  /**
   * Set the execution plan for a task
   */
  setPlan(taskId: string, steps: Omit<PlanStep, 'id' | 'status' | 'order'>[]): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const planSteps: PlanStep[] = steps.map((step, index) => ({
      ...step,
      id: generateStepId(taskId, index),
      status: 'pending',
      order: index,
    }));

    const plan: ExecutionPlan = {
      id: generateId(),
      steps: planSteps,
      parallelExecution: false, // Default to sequential
    };

    task.plan = plan;
    task.updatedAt = new Date();

    // Persist if storage is enabled
    if (this.enablePersistence && this.storage) {
      this.storage.updateTask(task).catch((error) => {
        console.error('Failed to update task with plan:', error);
      });
    }

    // Emit plan created event
    this.eventEmitter.emit({
      type: 'task:plan_created',
      taskId,
      sessionId: task.sessionId,
      timestamp: Date.now(),
      data: {
        planId: plan.id,
        stepCount: planSteps.length,
      },
    } as TaskPlanCreatedEvent);

    return task;
  }

  /**
   * Get the current step for a task
   */
  getCurrentStep(taskId: string): PlanStep | undefined {
    const task = this.tasks.get(taskId);
    if (!task?.plan) return undefined;

    if (task.currentStepIndex < 0 || task.currentStepIndex >= task.plan.steps.length) {
      return undefined;
    }

    return task.plan.steps[task.currentStepIndex];
  }

  /**
   * Get the next pending step that has all dependencies satisfied
   */
  getNextRunnableStep(taskId: string): PlanStep | undefined {
    const task = this.tasks.get(taskId);
    if (!task?.plan) return undefined;

    const completedStepIds = new Set(
      task.plan.steps
        .filter((s) => s.status === 'completed')
        .map((s) => s.id)
    );

    return task.plan.steps.find((step) => {
      if (step.status !== 'pending') return false;
      return step.dependencies.every((depId) => completedStepIds.has(depId));
    });
  }

  /**
   * Start executing a specific step
   */
  startStep(taskId: string, stepId: string): PlanStep {
    const task = this.tasks.get(taskId);
    if (!task?.plan) {
      throw new TaskNotFoundError(taskId);
    }

    const stepIndex = task.plan.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const step = task.plan.steps[stepIndex];
    step.status = 'running';
    task.currentStepIndex = stepIndex;
    task.updatedAt = new Date();

    // Emit step started event
    this.eventEmitter.emit({
      type: 'task:step_started',
      taskId,
      sessionId: task.sessionId,
      timestamp: Date.now(),
      data: {
        stepId,
        stepIndex,
        description: step.description,
      },
    } as TaskStepEvent);

    return step;
  }

  /**
   * Complete a step with output
   */
  completeStep(taskId: string, stepId: string, output?: unknown): PlanStep {
    const task = this.tasks.get(taskId);
    if (!task?.plan) {
      throw new TaskNotFoundError(taskId);
    }

    const step = task.plan.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    step.status = 'completed';
    step.output = output;
    step.executionTimeMs = Date.now() - task.updatedAt.getTime();
    task.updatedAt = new Date();

    // Emit step completed event
    this.eventEmitter.emit({
      type: 'task:step_completed',
      taskId,
      sessionId: task.sessionId,
      timestamp: Date.now(),
      data: {
        stepId,
        stepIndex: task.plan.steps.indexOf(step),
        description: step.description,
        output,
        executionTimeMs: step.executionTimeMs,
      },
    } as TaskStepEvent);

    return step;
  }

  /**
   * Mark a step as failed
   */
  failStep(taskId: string, stepId: string, error: string): PlanStep {
    const task = this.tasks.get(taskId);
    if (!task?.plan) {
      throw new TaskNotFoundError(taskId);
    }

    const step = task.plan.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    step.status = 'failed';
    step.error = error;
    step.executionTimeMs = Date.now() - task.updatedAt.getTime();
    task.error = error;
    task.updatedAt = new Date();

    // Emit step failed event
    this.eventEmitter.emit({
      type: 'task:step_failed',
      taskId,
      sessionId: task.sessionId,
      timestamp: Date.now(),
      data: {
        stepId,
        stepIndex: task.plan.steps.indexOf(step),
        description: step.description,
        error,
        executionTimeMs: step.executionTimeMs,
      },
    } as TaskStepEvent);

    // Also emit error event
    this.eventEmitter.emit({
      type: 'task:error',
      taskId,
      sessionId: task.sessionId,
      timestamp: Date.now(),
      data: { error, stepId },
    });

    return step;
  }

  // ========================================================================
  // Cancellation
  // ========================================================================

  /**
   * Cancel a task and abort any ongoing operations
   */
  cancelTask(taskId: string, reason?: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    // Abort the context
    task.context.abortController.abort(reason || 'Task cancelled');

    // Transition to cancelled state
    return this.transitionState(taskId, 'cancelled', reason);
  }

  /**
   * Check if a task is cancelled
   */
  isCancelled(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    return task.context.abortController.signal.aborted || task.state === 'cancelled';
  }

  /**
   * Throw if task is cancelled
   */
  checkCancelled(taskId: string): void {
    if (this.isCancelled(taskId)) {
      throw new TaskCancelledError(taskId);
    }
  }

  // ========================================================================
  // Event Subscription
  // ========================================================================

  /**
   * Subscribe to a specific event type
   */
  on(eventType: TaskEventType, handler: TaskEventHandler): () => void {
    return this.eventEmitter.on(eventType, handler);
  }

  /**
   * Subscribe to all events
   */
  onAny(handler: TaskEventHandler): () => void {
    return this.eventEmitter.onAny(handler);
  }

  // ========================================================================
  // Execution Flow Helpers
  // ========================================================================

  /**
   * Check if all steps are completed
   */
  areAllStepsCompleted(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task?.plan) return false;

    return task.plan.steps.every(
      (step) => step.status === 'completed' || step.status === 'skipped'
    );
  }

  /**
   * Check if any step has failed
   */
  hasFailedSteps(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task?.plan) return false;

    return task.plan.steps.some((step) => step.status === 'failed');
  }

  /**
   * Get execution progress
   */
  getProgress(taskId: string): { completed: number; total: number; percentage: number } {
    const task = this.tasks.get(taskId);
    if (!task?.plan) {
      return { completed: 0, total: 0, percentage: 0 };
    }

    const completed = task.plan.steps.filter(
      (s) => s.status === 'completed' || s.status === 'skipped'
    ).length;
    const total = task.plan.steps.length;

    return {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  // ========================================================================
  // Storage Integration
  // ========================================================================

  /**
   * Set storage adapter for persistence
   */
  setStorage(storage: TaskStorage): void {
    this.storage = storage;
  }

  /**
   * Enable/disable persistence
   */
  setPersistenceEnabled(enabled: boolean): void {
    this.enablePersistence = enabled;
  }

  /**
   * Load tasks from storage
   */
  async loadTasksFromStorage(): Promise<void> {
    if (!this.storage) {
      throw new Error('No storage adapter configured');
    }

    // This would be used to hydrate tasks from storage on startup
    // Implementation depends on specific storage needs
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function generateStepId(taskId: string, index: number): string {
  return `${taskId}-step-${index}`;
}

// ============================================================================
// Default Export
// ============================================================================

export default TaskEngine;
