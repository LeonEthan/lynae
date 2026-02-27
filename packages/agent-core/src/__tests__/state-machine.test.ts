import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TaskEngine,
  TaskState,
  TaskStorage,
  Task,
  SerializableTask,
  StateTransitionError,
  TaskNotFoundError,
  TaskCancelledError,
} from '../index.js';

// Mock storage for testing - uses SerializableTask (no runtime context)
// Uses deep cloning to ensure strict persistence verification (no aliasing)
class MockStorage implements TaskStorage {
  private tasks = new Map<string, SerializableTask>();

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  async createTask(task: SerializableTask): Promise<void> {
    // Deep clone to prevent aliasing between engine and storage
    this.tasks.set(task.id, this.deepClone(task));
  }

  async updateTask(task: SerializableTask): Promise<void> {
    // Deep clone to prevent aliasing between engine and storage
    this.tasks.set(task.id, this.deepClone(task));
  }

  async getTask(id: string): Promise<SerializableTask | undefined> {
    const task = this.tasks.get(id);
    // Return a clone to prevent external mutation of stored data
    return task ? this.deepClone(task) : undefined;
  }

  async getTasksBySession(sessionId: string): Promise<SerializableTask[]> {
    return Array.from(this.tasks.values())
      .filter((t) => t.sessionId === sessionId)
      // Return clones to prevent external mutation of stored data
      .map((t) => this.deepClone(t));
  }

  async deleteTask(id: string): Promise<void> {
    this.tasks.delete(id);
  }
}

describe('TaskEngine', () => {
  let engine: TaskEngine;
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
    engine = new TaskEngine({ storage, enablePersistence: true });
  });

  describe('Task Creation', () => {
    it('should create a task with idle state', () => {
      const task = engine.createTask('session-1', '/workspace');

      expect(task.id).toBeDefined();
      expect(task.sessionId).toBe('session-1');
      expect(task.state).toBe('idle');
      expect(task.context.workspaceRoot).toBe('/workspace');
      expect(task.currentStepIndex).toBe(-1);
    });

    it('should emit task:created event', () => {
      const handler = vi.fn();
      engine.on('task:created', handler);

      const task = engine.createTask('session-1', '/workspace');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toMatchObject({
        type: 'task:created',
        taskId: task.id,
        sessionId: 'session-1',
      });
    });

    it('should get task by id', () => {
      const task = engine.createTask('session-1', '/workspace');
      const retrieved = engine.getTask(task.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(task.id);
    });

    it('should get tasks by session', () => {
      engine.createTask('session-1', '/workspace1');
      engine.createTask('session-1', '/workspace2');
      engine.createTask('session-2', '/workspace3');

      const session1Tasks = engine.getTasksBySession('session-1');
      expect(session1Tasks).toHaveLength(2);

      const session2Tasks = engine.getTasksBySession('session-2');
      expect(session2Tasks).toHaveLength(1);
    });

    it('should get all tasks', () => {
      engine.createTask('session-1', '/workspace1');
      engine.createTask('session-2', '/workspace2');
      engine.createTask('session-3', '/workspace3');

      const allTasks = engine.getAllTasks();
      expect(allTasks).toHaveLength(3);
    });

    it('should delete a task', async () => {
      const task = engine.createTask('session-1', '/workspace');
      expect(engine.getTask(task.id)).toBeDefined();

      await engine.deleteTask(task.id);
      expect(engine.getTask(task.id)).toBeUndefined();
    });

    it('should throw when deleting non-existent task', async () => {
      await expect(engine.deleteTask('non-existent')).rejects.toThrow(
        TaskNotFoundError
      );
    });

    it('should allow setting storage after initialization', () => {
      const newEngine = new TaskEngine({ enablePersistence: false });
      newEngine.createTask('session-1', '/workspace');

      // Enable persistence by setting storage
      newEngine.setStorage(storage);
      newEngine.setPersistenceEnabled(true);

      // Should now persist changes
      const task = newEngine.createTask('session-1', '/workspace');
      expect(newEngine.getTask(task.id)).toBeDefined();
    });
  });

  describe('Valid State Transitions', () => {
    it('should allow idle -> planning transition', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');

      expect(engine.getTask(task.id)?.state).toBe('planning');
    });

    it('should allow planning -> awaiting_approval transition', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'awaiting_approval');

      expect(engine.getTask(task.id)?.state).toBe('awaiting_approval');
    });

    it('should allow planning -> executing transition', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'executing');

      expect(engine.getTask(task.id)?.state).toBe('executing');
    });

    it('should allow awaiting_approval -> executing transition', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'awaiting_approval');
      engine.transitionState(task.id, 'executing');

      expect(engine.getTask(task.id)?.state).toBe('executing');
    });

    it('should allow executing -> completed transition', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'executing');
      engine.transitionState(task.id, 'completed');

      expect(engine.getTask(task.id)?.state).toBe('completed');
    });

    it('should allow executing -> failed transition', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'executing');
      engine.transitionState(task.id, 'failed');

      expect(engine.getTask(task.id)?.state).toBe('failed');
    });

    it('should allow planning -> failed transition', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'failed');

      expect(engine.getTask(task.id)?.state).toBe('failed');
    });

    it('should allow any non-terminal state -> cancelled transition', () => {
      const task = engine.createTask('session-1', '/workspace');

      // idle -> cancelled
      engine.transitionState(task.id, 'cancelled');
      expect(engine.getTask(task.id)?.state).toBe('cancelled');

      // Reset
      const task2 = engine.createTask('session-1', '/workspace');
      engine.transitionState(task2.id, 'planning');
      engine.transitionState(task2.id, 'cancelled');
      expect(engine.getTask(task2.id)?.state).toBe('cancelled');
    });

    it('should allow staying in the same state', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'planning'); // Same state

      expect(engine.getTask(task.id)?.state).toBe('planning');
    });
  });

  describe('Invalid State Transitions', () => {
    it('should throw on invalid transition: idle -> executing', () => {
      const task = engine.createTask('session-1', '/workspace');

      expect(() => engine.transitionState(task.id, 'executing')).toThrow(
        StateTransitionError
      );
    });

    it('should throw on invalid transition: idle -> completed', () => {
      const task = engine.createTask('session-1', '/workspace');

      expect(() => engine.transitionState(task.id, 'completed')).toThrow(
        StateTransitionError
      );
    });

    it('should throw on invalid transition: completed -> planning', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'executing');
      engine.transitionState(task.id, 'completed');

      expect(() => engine.transitionState(task.id, 'planning')).toThrow(
        StateTransitionError
      );
    });

    it('should throw on invalid transition: failed -> executing', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'failed');

      expect(() => engine.transitionState(task.id, 'executing')).toThrow(
        StateTransitionError
      );
    });

    it('should throw on invalid transition: cancelled -> any', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'cancelled');

      expect(() => engine.transitionState(task.id, 'planning')).toThrow(
        StateTransitionError
      );
    });

    it('should throw on non-existent task', () => {
      expect(() => engine.transitionState('non-existent', 'planning')).toThrow(
        TaskNotFoundError
      );
    });
  });

  describe('Transition Validation', () => {
    it('should correctly validate valid transitions', () => {
      expect(engine.isValidTransition('idle', 'planning')).toBe(true);
      expect(engine.isValidTransition('idle', 'cancelled')).toBe(true);
      expect(engine.isValidTransition('planning', 'executing')).toBe(true);
      expect(engine.isValidTransition('planning', 'awaiting_approval')).toBe(true);
      expect(engine.isValidTransition('executing', 'completed')).toBe(true);
      expect(engine.isValidTransition('executing', 'failed')).toBe(true);
    });

    it('should correctly invalidate invalid transitions', () => {
      expect(engine.isValidTransition('idle', 'executing')).toBe(false);
      expect(engine.isValidTransition('idle', 'completed')).toBe(false);
      expect(engine.isValidTransition('completed', 'planning')).toBe(false);
      expect(engine.isValidTransition('failed', 'executing')).toBe(false);
      expect(engine.isValidTransition('cancelled', 'planning')).toBe(false);
    });

    it('should get valid next states', () => {
      const idleNext = engine.getValidNextStates('idle');
      expect(idleNext).toContain('planning');
      expect(idleNext).toContain('cancelled');

      const completedNext = engine.getValidNextStates('completed');
      expect(completedNext).toHaveLength(0);
    });
  });

  describe('Event Emission', () => {
    it('should emit state_changed event on transition', () => {
      const handler = vi.fn();
      engine.on('task:state_changed', handler);

      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toMatchObject({
        type: 'task:state_changed',
        data: {
          previousState: 'idle',
          newState: 'planning',
        },
      });
    });

    it('should emit completed event when transitioning to completed', () => {
      const stateHandler = vi.fn();
      const completedHandler = vi.fn();

      engine.on('task:state_changed', stateHandler);
      engine.on('task:completed', completedHandler);

      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'executing');
      engine.transitionState(task.id, 'completed');

      expect(stateHandler).toHaveBeenCalledTimes(3);
      expect(completedHandler).toHaveBeenCalledOnce();
    });

    it('should emit cancelled event when transitioning to cancelled', () => {
      const cancelledHandler = vi.fn();
      engine.on('task:cancelled', cancelledHandler);

      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'cancelled');

      expect(cancelledHandler).toHaveBeenCalledOnce();
    });

    it('should support global event subscription', () => {
      const handler = vi.fn();
      engine.onAny(handler);

      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');

      // Should receive both created and state_changed events
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls[0][0].type).toBe('task:created');
      expect(handler.mock.calls[1][0].type).toBe('task:state_changed');
    });

    it('should allow unsubscribing from events', () => {
      const handler = vi.fn();
      const unsubscribe = engine.on('task:state_changed', handler);

      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');

      expect(handler).toHaveBeenCalledOnce();

      // Unsubscribe
      unsubscribe();

      // Next transition should not call handler
      engine.transitionState(task.id, 'executing');
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('Plan Management', () => {
    it('should set a plan with steps', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');

      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: true, dependencies: [] },
      ]);

      const updatedTask = engine.getTask(task.id);
      expect(updatedTask?.plan).toBeDefined();
      expect(updatedTask?.plan?.steps).toHaveLength(2);
      expect(updatedTask?.plan?.steps[0].status).toBe('pending');
    });

    it('should emit plan_created event', () => {
      const handler = vi.fn();
      engine.on('task:plan_created', handler);

      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: false, dependencies: [] },
      ]);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].data.stepCount).toBe(2);
    });

    it('should get current step', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: false, dependencies: [] },
      ]);

      // No current step initially
      expect(engine.getCurrentStep(task.id)).toBeUndefined();

      // Start first step
      const stepId = task.plan!.steps[0].id;
      engine.startStep(task.id, stepId);

      const currentStep = engine.getCurrentStep(task.id);
      expect(currentStep?.description).toBe('Step 1');
    });

    it('should get next runnable step', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: false, dependencies: [] },
      ]);

      const nextStep = engine.getNextRunnableStep(task.id);
      expect(nextStep?.description).toBe('Step 1');
    });

    it('should consider dependencies when getting runnable steps', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: false, dependencies: [] },
      ]);

      // Get step IDs after plan creation
      const step1Id = task.plan!.steps[0].id;
      const step2Id = task.plan!.steps[1].id;

      // Manually set dependency for step 2 to depend on step 1
      task.plan!.steps[1].dependencies = [step1Id];

      // Step 1 is first runnable (Step 2 depends on Step 1)
      const step1 = engine.getNextRunnableStep(task.id);
      expect(step1?.description).toBe('Step 1');

      // Complete Step 1
      engine.startStep(task.id, step1Id);
      engine.completeStep(task.id, step1Id);

      // Now Step 2 should be runnable
      const step2 = engine.getNextRunnableStep(task.id);
      expect(step2?.description).toBe('Step 2');
    });

    it('should track step progress', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: false, dependencies: [] },
        { description: 'Step 3', requiresApproval: false, dependencies: [] },
      ]);

      // Initial progress
      expect(engine.getProgress(task.id)).toEqual({
        completed: 0,
        total: 3,
        percentage: 0,
      });

      // Complete first step
      const stepId = task.plan!.steps[0].id;
      engine.startStep(task.id, stepId);
      engine.completeStep(task.id, stepId);

      expect(engine.getProgress(task.id)).toEqual({
        completed: 1,
        total: 3,
        percentage: 33,
      });
    });

    it('should emit step events', () => {
      const startedHandler = vi.fn();
      const completedHandler = vi.fn();

      engine.on('task:step_started', startedHandler);
      engine.on('task:step_completed', completedHandler);

      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;
      engine.startStep(task.id, stepId);
      engine.completeStep(task.id, stepId, { result: 'success' });

      expect(startedHandler).toHaveBeenCalledOnce();
      expect(completedHandler).toHaveBeenCalledOnce();
      expect(completedHandler.mock.calls[0][0].data.output).toEqual({
        result: 'success',
      });
    });

    it('should emit step_failed event', () => {
      const failedHandler = vi.fn();
      engine.on('task:step_failed', failedHandler);

      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;
      engine.startStep(task.id, stepId);
      engine.failStep(task.id, stepId, 'Something went wrong');

      expect(failedHandler).toHaveBeenCalledOnce();
      expect(failedHandler.mock.calls[0][0].data.error).toBe(
        'Something went wrong'
      );
    });

    it('should skip a step and emit event', () => {
      const skippedHandler = vi.fn();
      engine.on('task:step_skipped', skippedHandler);

      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: false, dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;
      engine.skipStep(task.id, stepId, 'User chose to skip');

      const updatedTask = engine.getTask(task.id);
      expect(updatedTask?.plan?.steps[0].status).toBe('skipped');

      expect(skippedHandler).toHaveBeenCalledOnce();
      expect(skippedHandler.mock.calls[0][0]).toMatchObject({
        type: 'task:step_skipped',
        data: {
          stepId,
          description: 'Step 1',
          reason: 'User chose to skip',
        },
      });
    });

    it('should count skipped steps as completed in progress', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: false, dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;
      engine.skipStep(task.id, stepId);

      const progress = engine.getProgress(task.id);
      expect(progress.completed).toBe(1);
      expect(progress.percentage).toBe(50);
      expect(engine.areAllStepsCompleted(task.id)).toBe(false);
    });

    it('should track accurate execution time for steps', async () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;
      engine.startStep(task.id, stepId);

      // Wait a bit to ensure measurable execution time
      await new Promise((resolve) => setTimeout(resolve, 50));

      engine.completeStep(task.id, stepId, { result: 'success' });

      const step = task.plan!.steps[0];
      expect(step.executionTimeMs).toBeDefined();
      expect(step.executionTimeMs).toBeGreaterThanOrEqual(50);
      expect(step.startedAt).toBeDefined();
    });

    it('should track execution time for failed steps', async () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;
      engine.startStep(task.id, stepId);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 30));

      engine.failStep(task.id, stepId, 'Error occurred');

      const step = task.plan!.steps[0];
      expect(step.executionTimeMs).toBeDefined();
      expect(step.executionTimeMs).toBeGreaterThanOrEqual(30);
    });
  });

  describe('Cancellation', () => {
    it('should cancel a task', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');

      engine.cancelTask(task.id, 'User requested cancellation');

      const cancelledTask = engine.getTask(task.id);
      expect(cancelledTask?.state).toBe('cancelled');
      expect(
        cancelledTask?.context.abortController.signal.aborted
      ).toBe(true);
    });

    it('should throw when transitioning cancelled task', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.cancelTask(task.id);

      // After cancellation, any transition attempt throws TaskCancelledError
      expect(() => engine.transitionState(task.id, 'executing')).toThrow(
        TaskCancelledError
      );
    });

    it('should detect cancelled state', () => {
      const task = engine.createTask('session-1', '/workspace');
      expect(engine.isCancelled(task.id)).toBe(false);

      engine.cancelTask(task.id);
      expect(engine.isCancelled(task.id)).toBe(true);
    });

    it('should throw TaskCancelledError when checkCancelled is called on cancelled task', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.cancelTask(task.id);

      expect(() => engine.checkCancelled(task.id)).toThrow(TaskCancelledError);
    });

    it('should check cancellation before validating transition (fail fast)', () => {
      // Create and cancel a task directly
      const task = engine.createTask('session-1', '/workspace');
      engine.cancelTask(task.id);

      // Attempt an invalid transition (cancelled -> executing)
      // Should throw TaskCancelledError, NOT StateTransitionError
      // because cancellation check happens first
      expect(() => engine.transitionState(task.id, 'executing')).toThrow(
        TaskCancelledError
      );
    });
  });

  describe('Storage Integration', () => {
    it('should persist task on creation', async () => {
      const task = engine.createTask('session-1', '/workspace');

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 10));

      const persisted = await storage.getTask(task.id);
      expect(persisted).toBeDefined();
      expect(persisted?.id).toBe(task.id);
    });

    it('should persist task on state transition', async () => {
      const task = engine.createTask('session-1', '/workspace');

      // Wait for creation persistence
      await new Promise((resolve) => setTimeout(resolve, 10));

      engine.transitionState(task.id, 'planning');

      // Wait for update persistence
      await new Promise((resolve) => setTimeout(resolve, 10));

      const persisted = await storage.getTask(task.id);
      expect(persisted?.state).toBe('planning');
    });

    it('should work without storage when persistence is disabled', () => {
      const engineWithoutStorage = new TaskEngine({ enablePersistence: false });

      const task = engineWithoutStorage.createTask('session-1', '/workspace');
      engineWithoutStorage.transitionState(task.id, 'planning');

      expect(engineWithoutStorage.getTask(task.id)?.state).toBe('planning');
    });

    it('should call onPersistenceError callback when persistence fails', async () => {
      const persistenceErrorHandler = vi.fn();
      const failingStorage: TaskStorage = {
        async createTask() { throw new Error('DB connection failed'); },
        async updateTask() { throw new Error('DB connection failed'); },
        async getTask() { return undefined; },
        async getTasksBySession() { return []; },
        async deleteTask() {},
      };

      const engineWithFailingStorage = new TaskEngine({
        storage: failingStorage,
        enablePersistence: true,
        onPersistenceError: persistenceErrorHandler,
      });

      const task = engineWithFailingStorage.createTask('session-1', '/workspace');

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(persistenceErrorHandler).toHaveBeenCalledOnce();
      expect(persistenceErrorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(persistenceErrorHandler.mock.calls[0][0].message).toBe('DB connection failed');
      expect(persistenceErrorHandler.mock.calls[0][1]).toBe('create');
      expect(persistenceErrorHandler.mock.calls[0][2].id).toBe(task.id);
    });

    it('should call onPersistenceError for update operations', async () => {
      const persistenceErrorHandler = vi.fn();
      let shouldFail = false;
      const mockStorage: TaskStorage = {
        async createTask() {},
        async updateTask() {
          if (shouldFail) throw new Error('Update failed');
        },
        async getTask() { return undefined; },
        async getTasksBySession() { return []; },
        async deleteTask() {},
      };

      const engineWithMockStorage = new TaskEngine({
        storage: mockStorage,
        enablePersistence: true,
        onPersistenceError: persistenceErrorHandler,
      });

      const task = engineWithMockStorage.createTask('session-1', '/workspace');
      await new Promise((resolve) => setTimeout(resolve, 10));

      shouldFail = true;
      engineWithMockStorage.transitionState(task.id, 'planning');
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(persistenceErrorHandler).toHaveBeenCalledTimes(1);
      expect(persistenceErrorHandler.mock.calls[0][1]).toBe('update');
    });
  });

  describe('Execution Flow Integration', () => {
    it('should complete full execution flow', () => {
      const task = engine.createTask('session-1', '/workspace');

      // Create plan
      engine.transitionState(task.id, 'planning');
      engine.setPlan(task.id, [
        { description: 'Read file', requiresApproval: false, dependencies: [] },
        { description: 'Write file', requiresApproval: false, dependencies: [] },
      ]);

      // Execute
      engine.transitionState(task.id, 'executing');

      // Complete all steps
      const step1 = engine.getNextRunnableStep(task.id)!;
      engine.startStep(task.id, step1.id);
      engine.completeStep(task.id, step1.id, { content: 'file contents' });

      const step2 = engine.getNextRunnableStep(task.id)!;
      engine.startStep(task.id, step2.id);
      engine.completeStep(task.id, step2.id);

      // All steps completed
      expect(engine.areAllStepsCompleted(task.id)).toBe(true);

      // Complete task
      engine.transitionState(task.id, 'completed');
      expect(engine.getTask(task.id)?.state).toBe('completed');
    });

    it('should detect failed steps', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
        { description: 'Step 2', requiresApproval: false, dependencies: [] },
      ]);

      const step1 = task.plan!.steps[0];
      engine.startStep(task.id, step1.id);
      engine.failStep(task.id, step1.id, 'Error');

      expect(engine.hasFailedSteps(task.id)).toBe(true);
    });

    it('should track completion timestamp', () => {
      const task = engine.createTask('session-1', '/workspace');

      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'executing');
      engine.transitionState(task.id, 'completed');

      const completedTask = engine.getTask(task.id);
      expect(completedTask?.completedAt).toBeDefined();
      expect(completedTask?.completedAt!.getTime()).toBeGreaterThanOrEqual(
        completedTask!.createdAt.getTime()
      );
    });
  });

  describe('Serializable Task (P1: Non-serializable fields)', () => {
    it('should persist tasks without AbortController or Map', async () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
      ]);

      // Wait for persistence
      await new Promise((resolve) => setTimeout(resolve, 10));

      const persisted = await storage.getTask(task.id);
      expect(persisted).toBeDefined();
      // Verify serializable fields
      expect(persisted?.id).toBe(task.id);
      expect(persisted?.workspaceRoot).toBe('/workspace');
      // Verify runtime fields are NOT in persisted data
      expect(persisted).not.toHaveProperty('context');
      expect(persisted).not.toHaveProperty('abortController');
      expect(persisted).not.toHaveProperty('metadata');
    });

    it('should persist step changes to storage', async () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stepId = task.plan!.steps[0].id;
      engine.startStep(task.id, stepId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify step status persisted
      const persistedAfterStart = await storage.getTask(task.id);
      expect(persistedAfterStart?.plan?.steps[0].status).toBe('running');
      expect(persistedAfterStart?.plan?.steps[0].startedAt).toBeDefined();

      engine.completeStep(task.id, stepId, { result: 'success' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify completion persisted
      const persistedAfterComplete = await storage.getTask(task.id);
      expect(persistedAfterComplete?.plan?.steps[0].status).toBe('completed');
      expect(persistedAfterComplete?.plan?.steps[0].output).toEqual({ result: 'success' });
    });
  });

  describe('State Machine Guards (P2: Terminal state bypass)', () => {
    it('should prevent setPlan on completed task', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'executing');
      engine.transitionState(task.id, 'completed');

      expect(() => engine.setPlan(task.id, [
        { description: 'New step', requiresApproval: false, dependencies: [] },
      ])).toThrow('Cannot set plan: task is in terminal state');
    });

    it('should prevent setPlan on failed task', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'failed');

      expect(() => engine.setPlan(task.id, [
        { description: 'New step', requiresApproval: false, dependencies: [] },
      ])).toThrow('Cannot set plan: task is in terminal state');
    });

    it('should prevent setPlan on cancelled task', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.cancelTask(task.id);

      expect(() => engine.setPlan(task.id, [
        { description: 'New step', requiresApproval: false, dependencies: [] },
      ])).toThrow(TaskCancelledError);
    });

    it('should prevent step mutations on terminal tasks', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
      ]);
      const stepId = task.plan!.steps[0].id;

      engine.transitionState(task.id, 'planning');
      engine.transitionState(task.id, 'executing');
      engine.transitionState(task.id, 'completed');

      expect(() => engine.startStep(task.id, stepId)).toThrow('Cannot start step: task is in terminal state');
      expect(() => engine.completeStep(task.id, stepId)).toThrow('Cannot complete step: task is in terminal state');
      expect(() => engine.failStep(task.id, stepId, 'error')).toThrow('Cannot fail step: task is in terminal state');
      expect(() => engine.skipStep(task.id, stepId)).toThrow('Cannot skip step: task is in terminal state');
    });

    it('should prevent step mutations on cancelled task', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Step 1', requiresApproval: false, dependencies: [] },
      ]);
      const stepId = task.plan!.steps[0].id;
      engine.startStep(task.id, stepId);

      engine.cancelTask(task.id);

      expect(() => engine.completeStep(task.id, stepId)).toThrow(TaskCancelledError);
    });
  });

  describe('Approval Flow Enforcement (P2)', () => {
    it('should not return steps requiring approval from getNextRunnableStep', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Approved step', requiresApproval: false, dependencies: [] },
        { description: 'Needs approval', requiresApproval: true, dependencies: [] },
      ]);

      // getNextRunnableStep should skip the step requiring approval
      const next = engine.getNextRunnableStep(task.id);
      expect(next?.description).toBe('Approved step');
    });

    it('should return steps awaiting approval from getNextStepAwaitingApproval', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Approved step', requiresApproval: false, dependencies: [] },
        { description: 'Needs approval', requiresApproval: true, dependencies: [] },
      ]);

      const awaiting = engine.getNextStepAwaitingApproval(task.id);
      expect(awaiting?.description).toBe('Needs approval');
    });

    it('should emit approval_required event and throw when starting step that requires approval', () => {
      const approvalHandler = vi.fn();
      engine.on('task:approval_required', approvalHandler);

      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Dangerous action', requiresApproval: true, toolName: 'file:delete', dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;

      expect(() => engine.startStep(task.id, stepId)).toThrow('requires approval before execution');
      expect(approvalHandler).toHaveBeenCalledOnce();
      expect(approvalHandler.mock.calls[0][0]).toMatchObject({
        type: 'task:approval_required',
        data: {
          stepId,
          description: 'Dangerous action',
          toolName: 'file:delete',
        },
      });
    });

    it('should allow step execution after approval', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Needs approval', requiresApproval: true, dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;

      // Approve the step
      engine.approveStep(task.id, stepId);

      // Now step can be started
      const step = engine.startStep(task.id, stepId);
      expect(step.status).toBe('running');
      expect(step.requiresApproval).toBe(false); // Approval flag cleared
    });

    it('should throw when approving step that does not require approval', () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'No approval needed', requiresApproval: false, dependencies: [] },
      ]);

      const stepId = task.plan!.steps[0].id;
      expect(() => engine.approveStep(task.id, stepId)).toThrow('does not require approval');
    });

    it('should persist approval changes', async () => {
      const task = engine.createTask('session-1', '/workspace');
      engine.setPlan(task.id, [
        { description: 'Needs approval', requiresApproval: true, dependencies: [] },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stepId = task.plan!.steps[0].id;
      engine.approveStep(task.id, stepId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const persisted = await storage.getTask(task.id);
      expect(persisted?.plan?.steps[0].requiresApproval).toBe(false);
    });
  });
});
