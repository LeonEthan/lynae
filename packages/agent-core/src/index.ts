// Agent Core - Task state machine and session orchestration
// PR-05: Full state machine implementation with events, cancellation, and storage integration

// ============================================================================
// Types and Enums
// ============================================================================

/**
 * Represents the current state of a task in the state machine.
 * Transitions follow: idle -> planning -> (awaiting_approval) -> executing -> completed/failed
 * cancelled can be reached from any non-terminal state.
 */
export type TaskState =
  | 'idle'       // Task created, not yet started
  | 'planning'   // AI is creating execution plan
  | 'awaiting_approval' // Plan created, waiting for user approval
  | 'executing'  // Plan approved, executing steps
  | 'completed'  // All steps completed successfully
  | 'failed'     // Execution failed (terminal state)
  | 'cancelled'; // Task was cancelled (terminal state)

/**
 * Status of an individual plan step.
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Represents a task managed by the TaskEngine.
 * This combines serializable data with runtime context.
 */
export interface Task extends SerializableTask {
  /** Runtime context for this task (not persisted) */
  context: AgentContext;
}

/**
 * An execution plan containing a sequence of steps to complete a task.
 */
export interface ExecutionPlan {
  /** Unique identifier for this plan */
  id: string;
  /** Steps in execution order */
  steps: PlanStep[];
  /** Estimated duration in milliseconds (optional) */
  estimatedDuration?: number;
  /** Whether steps can be executed in parallel (future feature) */
  parallelExecution: boolean;
  /** Additional plan metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A single step in an execution plan.
 */
export interface PlanStep {
  /** Unique identifier for this step */
  id: string;
  /** Human-readable description of what this step does */
  description: string;
  /** Name of the tool to execute (if any) */
  toolName?: string;
  /** Input parameters for the tool */
  toolInput?: unknown;
  /** Whether this step requires user approval before execution */
  requiresApproval: boolean;
  /** IDs of steps that must complete before this step can run */
  dependencies: string[];
  /** Current execution status */
  status: StepStatus;
  /** Position in the plan sequence */
  order: number;
  /** When step execution started */
  startedAt?: Date;
  /** Execution time in milliseconds */
  executionTimeMs?: number;
  /** Error message if step failed */
  error?: string;
  /** Output data from successful execution */
  output?: unknown;
}

/**
 * Serializable task data that can be persisted to storage.
 * This excludes runtime-only fields like AbortController.
 */
export interface SerializableTask {
  id: string;
  sessionId: string;
  state: TaskState;
  plan?: ExecutionPlan;
  currentStepIndex: number;
  workspaceRoot: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * Runtime context passed to tasks during execution.
 * This is NOT persisted - it's recreated when tasks are loaded from storage.
 */
export interface AgentContext {
  /** Root directory for file operations (security boundary) */
  workspaceRoot: string;
  /** Session ID for correlation */
  sessionId: string;
  /** AbortController for cancellation support */
  abortController: AbortController;
  /** Additional runtime metadata (not persisted) */
  metadata: Map<string, unknown>;
}

/**
 * Internal task representation combining serializable data with runtime context.
 */
interface InternalTask extends SerializableTask {
  context: AgentContext;
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
  | 'task:step_skipped'
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
  type: 'task:step_started' | 'task:step_completed' | 'task:step_failed' | 'task:step_skipped';
  data: {
    stepId: string;
    stepIndex: number;
    description: string;
    output?: unknown;
    error?: string;
    reason?: string;
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
export type PersistenceErrorHandler = (error: Error, operation: 'create' | 'update', task: SerializableTask) => void;

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Extract serializable data from a Task, excluding runtime context.
 */
function toSerializableTask(task: InternalTask): SerializableTask {
  const { context, ...serializable } = task;
  return serializable;
}

/**
 * Rehydrate a serializable task into a full Task with runtime context.
 */
function fromSerializableTask(serializable: SerializableTask): InternalTask {
  return {
    ...serializable,
    context: {
      workspaceRoot: serializable.workspaceRoot,
      sessionId: serializable.sessionId,
      abortController: new AbortController(),
      metadata: new Map(),
    },
  };
}

// ============================================================================
// Storage Integration Interface
// ============================================================================

/**
 * Interface for task persistence. Implementations handle storage backend details.
 * Note: Only SerializableTask data is persisted. Runtime context (AbortController, etc.) is recreated on load.
 */
export interface TaskStorage {
  /** Persist a new task */
  createTask(task: SerializableTask): Promise<void>;
  /** Update an existing task */
  updateTask(task: SerializableTask): Promise<void>;
  /** Retrieve a task by ID */
  getTask(id: string): Promise<SerializableTask | undefined>;
  /** Retrieve all tasks for a session */
  getTasksBySession(sessionId: string): Promise<SerializableTask[]>;
  /** Delete a task */
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
  /** Callback for persistence errors. If not provided, errors are logged to console. */
  onPersistenceError?: PersistenceErrorHandler;
}

export class TaskEngine {
  private tasks: Map<string, InternalTask> = new Map();
  private eventEmitter = new TaskEventEmitter();
  private storage?: TaskStorage;
  private enablePersistence: boolean;
  private onPersistenceError?: PersistenceErrorHandler;

  constructor(options: TaskEngineOptions = {}) {
    this.storage = options.storage;
    this.enablePersistence = options.enablePersistence ?? false;
    this.onPersistenceError = options.onPersistenceError;
  }

  /**
   * Helper to persist task if enabled
   */
  private persistTask(task: InternalTask, operation: 'create' | 'update'): void {
    if (!this.enablePersistence || !this.storage) return;

    const serializable = toSerializableTask(task);
    this.storage[operation === 'create' ? 'createTask' : 'updateTask'](serializable).catch((error) => {
      if (this.onPersistenceError) {
        this.onPersistenceError(error instanceof Error ? error : new Error(String(error)), operation, serializable);
      } else {
        console.error(`Failed to ${operation} task:`, error);
      }
    });
  }

  /**
   * Check if task is in a terminal state (completed, failed, cancelled)
   */
  private isTerminalState(state: TaskState): boolean {
    return state === 'completed' || state === 'failed' || state === 'cancelled';
  }

  /**
   * Guard to prevent mutations on terminal or cancelled tasks
   */
  private guardMutable(task: InternalTask, operation: string): void {
    // Check cancellation first (more specific error)
    if (task.context.abortController.signal.aborted) {
      throw new TaskCancelledError(task.id);
    }
    // Then check terminal state
    if (this.isTerminalState(task.state)) {
      throw new Error(`Cannot ${operation}: task is in terminal state '${task.state}'`);
    }
  }

  // ========================================================================
  // Task Lifecycle
  // ========================================================================

  createTask(sessionId: string, workspaceRoot: string): Task {
    const abortController = new AbortController();

    const task: InternalTask = {
      id: generateId(),
      sessionId,
      state: 'idle',
      currentStepIndex: -1,
      workspaceRoot,
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
    this.persistTask(task, 'create');

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

  /**
   * Delete a task from memory and storage
   */
  async deleteTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    // Delete from storage if persistence is enabled
    if (this.enablePersistence && this.storage) {
      try {
        await this.storage.deleteTask(taskId);
      } catch (error) {
        const serializable = toSerializableTask(task);
        if (this.onPersistenceError) {
          this.onPersistenceError(error instanceof Error ? error : new Error(String(error)), 'update', serializable);
        } else {
          console.error('Failed to delete task from storage:', error);
        }
        throw error;
      }
    }

    // Delete from memory
    this.tasks.delete(taskId);
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

    // Check if task has been cancelled (fail fast)
    if (task.context.abortController.signal.aborted && newState !== 'cancelled') {
      throw new TaskCancelledError(taskId);
    }

    // Validate transition
    if (!this.isValidTransition(currentState, newState)) {
      throw new StateTransitionError(taskId, currentState, newState);
    }

    // Update state
    task.state = newState;
    task.updatedAt = new Date();

    if (newState === 'completed' || newState === 'failed' || newState === 'cancelled') {
      task.completedAt = new Date();
    }

    // Persist if storage is enabled
    this.persistTask(task, 'update');

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

    // Guard against mutations on terminal/cancelled tasks
    this.guardMutable(task, 'set plan');

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
    this.persistTask(task, 'update');

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
   * Get the next pending step that has all dependencies satisfied.
   * Excludes steps that require approval (use getNextStepAwaitingApproval for those).
   */
  getNextRunnableStep(taskId: string): PlanStep | undefined {
    const task = this.tasks.get(taskId);
    if (!task?.plan) return undefined;

    const completedStepIds = new Set(
      task.plan.steps
        .filter((s) => s.status === 'completed' || s.status === 'skipped')
        .map((s) => s.id)
    );

    return task.plan.steps.find((step) => {
      if (step.status !== 'pending') return false;
      // Skip steps that require approval - they need explicit approval
      if (step.requiresApproval) return false;
      return step.dependencies.every((depId) => completedStepIds.has(depId));
    });
  }

  /**
   * Get the next step that requires approval and is ready to run (dependencies satisfied).
   * Returns undefined if no such step exists.
   */
  getNextStepAwaitingApproval(taskId: string): PlanStep | undefined {
    const task = this.tasks.get(taskId);
    if (!task?.plan) return undefined;

    const completedStepIds = new Set(
      task.plan.steps
        .filter((s) => s.status === 'completed' || s.status === 'skipped')
        .map((s) => s.id)
    );

    return task.plan.steps.find((step) => {
      if (step.status !== 'pending') return false;
      if (!step.requiresApproval) return false;
      return step.dependencies.every((depId) => completedStepIds.has(depId));
    });
  }

  /**
   * Approve a step for execution (required when step.requiresApproval is true)
   */
  approveStep(taskId: string, stepId: string): PlanStep {
    const task = this.tasks.get(taskId);
    if (!task?.plan) {
      throw new TaskNotFoundError(taskId);
    }

    // Guard against mutations on terminal/cancelled tasks
    this.guardMutable(task, 'approve step');

    const step = task.plan.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    if (!step.requiresApproval) {
      throw new Error(`Step ${stepId} does not require approval`);
    }

    // Mark step as approved by clearing the requiresApproval flag
    // The step will now be returned by getNextRunnableStep
    step.requiresApproval = false;
    task.updatedAt = new Date();

    // Persist the approval
    this.persistTask(task, 'update');

    return step;
  }

  /**
   * Start executing a specific step
   */
  startStep(taskId: string, stepId: string): PlanStep {
    const task = this.tasks.get(taskId);
    if (!task?.plan) {
      throw new TaskNotFoundError(taskId);
    }

    // Guard against mutations on terminal/cancelled tasks
    this.guardMutable(task, 'start step');

    const stepIndex = task.plan.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const step = task.plan.steps[stepIndex];

    // Enforce approval requirement
    if (step.requiresApproval) {
      // Emit approval required event
      this.eventEmitter.emit({
        type: 'task:approval_required',
        taskId,
        sessionId: task.sessionId,
        timestamp: Date.now(),
        data: {
          stepId,
          description: step.description,
          toolName: step.toolName,
          toolInput: step.toolInput,
        },
      } as TaskApprovalRequiredEvent);

      throw new Error(`Step ${stepId} requires approval before execution. Call approveStep() first or listen for task:approval_required event.`);
    }

    step.status = 'running';
    step.startedAt = new Date();
    task.currentStepIndex = stepIndex;
    task.updatedAt = new Date();

    // Persist step change
    this.persistTask(task, 'update');

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

    // Guard against mutations on terminal/cancelled tasks
    this.guardMutable(task, 'complete step');

    const step = task.plan.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    step.status = 'completed';
    step.output = output;
    step.executionTimeMs = step.startedAt ? Date.now() - step.startedAt.getTime() : undefined;
    task.updatedAt = new Date();

    // Persist step change
    this.persistTask(task, 'update');

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

    // Guard against mutations on terminal/cancelled tasks
    this.guardMutable(task, 'fail step');

    const step = task.plan.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    step.status = 'failed';
    step.error = error;
    step.executionTimeMs = step.startedAt ? Date.now() - step.startedAt.getTime() : undefined;
    task.error = error;
    task.updatedAt = new Date();

    // Persist step change
    this.persistTask(task, 'update');

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

  /**
   * Skip a step (mark as skipped without executing)
   */
  skipStep(taskId: string, stepId: string, reason?: string): PlanStep {
    const task = this.tasks.get(taskId);
    if (!task?.plan) {
      throw new TaskNotFoundError(taskId);
    }

    // Guard against mutations on terminal/cancelled tasks
    this.guardMutable(task, 'skip step');

    const step = task.plan.steps.find((s) => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    step.status = 'skipped';
    task.updatedAt = new Date();

    // Persist step change
    this.persistTask(task, 'update');

    // Emit step skipped event
    this.eventEmitter.emit({
      type: 'task:step_skipped',
      taskId,
      sessionId: task.sessionId,
      timestamp: Date.now(),
      data: {
        stepId,
        stepIndex: task.plan.steps.indexOf(step),
        description: step.description,
        reason,
      },
    } as TaskStepEvent);

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
