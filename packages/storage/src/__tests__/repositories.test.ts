import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Storage } from '../index.js';

// Helper to create a temporary database path
function createTempDbPath(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'lynae-repo-test-'));
  return join(tmpDir, 'test.db');
}

// Helper to clean up temp directory
function cleanupTempDir(dbPath: string) {
  const tmpDir = dbPath.replace('/test.db', '');
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Repositories', () => {
  let storage: Storage;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    storage = await Storage.create({ databasePath: dbPath });
  });

  afterEach(async () => {
    await storage.close();
    cleanupTempDir(dbPath);
  });

  describe('SessionRepository', () => {
    it('should create and find a session', async () => {
      const now = new Date();
      const session = await storage.sessions.create({
        id: 'session-1',
        title: 'Test Session',
        workspacePath: '/workspace',
        model: 'claude-sonnet-4-6',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      expect(session.id).toBe('session-1');
      expect(session.title).toBe('Test Session');

      const found = await storage.sessions.findById('session-1');
      expect(found).toBeDefined();
      expect(found?.title).toBe('Test Session');
    });

    it('should find all sessions with filters', async () => {
      const now = new Date();

      await storage.sessions.create({
        id: 'session-active',
        title: 'Active Session',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await storage.sessions.create({
        id: 'session-archived',
        title: 'Archived Session',
        status: 'archived',
        createdAt: now,
        updatedAt: now,
      });

      const allSessions = await storage.sessions.findAll();
      expect(allSessions).toHaveLength(2);

      const activeSessions = await storage.sessions.findAll({ status: 'active' });
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe('session-active');
    });

    it('should update a session', async () => {
      const now = new Date();

      await storage.sessions.create({
        id: 'session-update',
        title: 'Original Title',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      const updated = await storage.sessions.update('session-update', {
        title: 'Updated Title',
      });

      expect(updated?.title).toBe('Updated Title');
      expect(updated?.status).toBe('active'); // Unchanged
    });

    it('should archive a session', async () => {
      const now = new Date();

      await storage.sessions.create({
        id: 'session-archive',
        title: 'To Be Archived',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      const archived = await storage.sessions.archive('session-archive');
      expect(archived?.status).toBe('archived');

      const found = await storage.sessions.findById('session-archive');
      expect(found?.status).toBe('archived');
    });

    it('should delete a session', async () => {
      const now = new Date();

      await storage.sessions.create({
        id: 'session-delete',
        title: 'To Be Deleted',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      const deleted = await storage.sessions.delete('session-delete');
      expect(deleted).toBe(true);

      const found = await storage.sessions.findById('session-delete');
      expect(found).toBeUndefined();
    });

    it('should find recent sessions', async () => {
      const now = new Date();

      // Create multiple sessions
      for (let i = 0; i < 5; i++) {
        await storage.sessions.create({
          id: `session-recent-${i}`,
          title: `Session ${i}`,
          status: 'active',
          createdAt: new Date(now.getTime() - i * 1000),
          updatedAt: new Date(now.getTime() - i * 1000),
        });
      }

      // Archive one
      await storage.sessions.archive('session-recent-3');

      const recent = await storage.sessions.findRecent(3);
      expect(recent).toHaveLength(3);
      // Should only return active sessions
      expect(recent.some((s) => s.id === 'session-recent-3')).toBe(false);
    });
  });

  describe('MessageRepository', () => {
    beforeEach(async () => {
      // Create a session for messages
      await storage.sessions.create({
        id: 'test-session',
        title: 'Test Session',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should create and find messages', async () => {
      const message = await storage.messages.create({
        id: 'msg-1',
        sessionId: 'test-session',
        role: 'user',
        content: 'Hello!',
        createdAt: new Date(),
      });

      expect(message.id).toBe('msg-1');
      expect(message.content).toBe('Hello!');

      const found = await storage.messages.findById('msg-1');
      expect(found?.content).toBe('Hello!');
    });

    it('should find messages by session', async () => {
      await storage.messages.create({
        id: 'msg-1',
        sessionId: 'test-session',
        role: 'user',
        content: 'Message 1',
        createdAt: new Date(),
      });

      await storage.messages.create({
        id: 'msg-2',
        sessionId: 'test-session',
        role: 'assistant',
        content: 'Message 2',
        createdAt: new Date(),
      });

      const messages = await storage.messages.findBySessionId('test-session');
      expect(messages).toHaveLength(2);
    });

    it('should create batch messages', async () => {
      const messages = await storage.messages.createBatch([
        {
          id: 'batch-1',
          sessionId: 'test-session',
          role: 'user',
          content: 'Batch 1',
          createdAt: new Date(),
        },
        {
          id: 'batch-2',
          sessionId: 'test-session',
          role: 'assistant',
          content: 'Batch 2',
          createdAt: new Date(),
        },
      ]);

      expect(messages).toHaveLength(2);

      const count = await storage.messages.countBySessionId('test-session');
      expect(count).toBe(2);
    });

    it('should delete messages by session', async () => {
      await storage.messages.create({
        id: 'msg-delete-1',
        sessionId: 'test-session',
        role: 'user',
        content: 'To be deleted',
        createdAt: new Date(),
      });

      const deleted = await storage.messages.deleteBySessionId('test-session');
      expect(deleted).toBe(1);

      const messages = await storage.messages.findBySessionId('test-session');
      expect(messages).toHaveLength(0);
    });
  });

  describe('ToolExecutionRepository', () => {
    beforeEach(async () => {
      await storage.sessions.create({
        id: 'test-session',
        title: 'Test Session',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should create and update tool execution status', async () => {
      const now = new Date();

      const execution = await storage.toolExecutions.create({
        id: 'exec-1',
        sessionId: 'test-session',
        toolName: 'read_file',
        input: { file_path: '/test.txt' },
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });

      expect(execution.status).toBe('pending');

      // Update to running
      const running = await storage.toolExecutions.updateStatus('exec-1', 'running');
      expect(running?.status).toBe('running');
      expect(running?.startedAt).toBeDefined();

      // Update to completed
      const completed = await storage.toolExecutions.updateStatus('exec-1', 'completed', {
        output: { content: 'file contents' },
      });
      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeDefined();
      expect(completed?.executionTimeMs).toBeDefined();
    });

    it('should find tool executions by status', async () => {
      const now = new Date();

      await storage.toolExecutions.create({
        id: 'exec-pending',
        sessionId: 'test-session',
        toolName: 'read_file',
        input: {},
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });

      await storage.toolExecutions.create({
        id: 'exec-completed',
        sessionId: 'test-session',
        toolName: 'write_file',
        input: {},
        status: 'completed',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      });

      const pending = await storage.toolExecutions.findAll({ status: 'pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('exec-pending');
    });

    it('should get stats by tool name', async () => {
      const now = new Date();

      for (let i = 0; i < 3; i++) {
        await storage.toolExecutions.create({
          id: `exec-read-${i}`,
          sessionId: 'test-session',
          toolName: 'read_file',
          input: {},
          status: 'completed',
          createdAt: now,
          updatedAt: now,
          completedAt: now,
          executionTimeMs: 100 + i * 50,
        });
      }

      await storage.toolExecutions.create({
        id: 'exec-write',
        sessionId: 'test-session',
        toolName: 'write_file',
        input: {},
        status: 'completed',
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        executionTimeMs: 200,
      });

      const stats = await storage.toolExecutions.getStatsByToolName('test-session');
      expect(stats).toHaveLength(2);

      const readStats = stats.find((s) => s.toolName === 'read_file');
      expect(readStats?.count).toBe(3);
      expect(readStats?.avgExecutionTime).toBeCloseTo(150, 0);
    });
  });

  describe('ApprovalRepository', () => {
    beforeEach(async () => {
      await storage.sessions.create({
        id: 'test-session',
        title: 'Test Session',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.toolExecutions.create({
        id: 'test-exec',
        sessionId: 'test-session',
        toolName: 'write_file',
        input: {},
        status: 'awaiting_approval',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should create and find approvals', async () => {
      const approval = await storage.approvals.create({
        id: 'approval-1',
        toolExecutionId: 'test-exec',
        decision: 'approved',
        approvedBy: 'user',
        reason: 'Looks good',
        createdAt: new Date(),
      });

      expect(approval.decision).toBe('approved');

      const found = await storage.approvals.findByToolExecutionId('test-exec');
      expect(found).toHaveLength(1);
      expect(found[0].approvedBy).toBe('user');
    });

    it('should find latest approval', async () => {
      const now = new Date();

      await storage.approvals.create({
        id: 'approval-1',
        toolExecutionId: 'test-exec',
        decision: 'rejected',
        approvedBy: 'policy',
        createdAt: new Date(now.getTime() - 1000),
      });

      await storage.approvals.create({
        id: 'approval-2',
        toolExecutionId: 'test-exec',
        decision: 'approved',
        approvedBy: 'user',
        createdAt: now,
      });

      const latest = await storage.approvals.findLatestByToolExecutionId('test-exec');
      expect(latest?.decision).toBe('approved');
      expect(latest?.id).toBe('approval-2');
    });
  });

  describe('SettingsRepository', () => {
    it('should set and get settings', async () => {
      await storage.settings.set('theme', 'dark');

      const theme = await storage.settings.get('theme');
      expect(theme).toBe('dark');
    });

    it('should return default value for missing settings', async () => {
      const value = await storage.settings.get('missing-key', 'default');
      expect(value).toBe('default');
    });

    it('should set multiple settings', async () => {
      await storage.settings.setMultiple({
        theme: 'light',
        fontSize: 14,
        autoSave: true,
      });

      const theme = await storage.settings.get('theme');
      const fontSize = await storage.settings.get('fontSize');

      expect(theme).toBe('light');
      expect(fontSize).toBe(14);
    });

    it('should get all settings', async () => {
      await storage.settings.set('key1', 'value1');
      await storage.settings.set('key2', 'value2');

      const all = await storage.settings.getAll();
      expect(all.key1).toBe('value1');
      expect(all.key2).toBe('value2');
    });

    it('should check if setting exists', async () => {
      await storage.settings.set('existing', 'value');

      expect(await storage.settings.has('existing')).toBe(true);
      expect(await storage.settings.has('non-existing')).toBe(false);
    });

    it('should delete settings', async () => {
      await storage.settings.set('to-delete', 'value');
      expect(await storage.settings.has('to-delete')).toBe(true);

      await storage.settings.delete('to-delete');
      expect(await storage.settings.has('to-delete')).toBe(false);
    });
  });

  describe('CheckpointRepository', () => {
    beforeEach(async () => {
      await storage.sessions.create({
        id: 'test-session',
        title: 'Test Session',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should create and find checkpoints', async () => {
      const checkpoint = await storage.checkpoints.create({
        id: 'checkpoint-1',
        sessionId: 'test-session',
        name: 'Initial state',
        description: 'Before making changes',
        gitCommitSha: 'abc123',
        messageCount: 5,
        createdAt: new Date(),
      });

      expect(checkpoint.name).toBe('Initial state');

      const found = await storage.checkpoints.findById('checkpoint-1');
      expect(found?.gitCommitSha).toBe('abc123');
    });

    it('should find checkpoints by session', async () => {
      const now = new Date();

      for (let i = 0; i < 3; i++) {
        await storage.checkpoints.create({
          id: `checkpoint-${i}`,
          sessionId: 'test-session',
          name: `Checkpoint ${i}`,
          messageCount: i + 1,
          createdAt: new Date(now.getTime() - i * 1000),
        });
      }

      const checkpoints = await storage.checkpoints.findBySessionId('test-session');
      expect(checkpoints).toHaveLength(3);
      // Should be ordered by createdAt desc
      expect(checkpoints[0].name).toBe('Checkpoint 0');
    });

    it('should find latest checkpoint', async () => {
      const now = new Date();

      await storage.checkpoints.create({
        id: 'checkpoint-old',
        sessionId: 'test-session',
        name: 'Old',
        messageCount: 1,
        createdAt: new Date(now.getTime() - 1000),
      });

      await storage.checkpoints.create({
        id: 'checkpoint-new',
        sessionId: 'test-session',
        name: 'New',
        messageCount: 2,
        createdAt: now,
      });

      const latest = await storage.checkpoints.findLatestBySessionId('test-session');
      expect(latest?.name).toBe('New');
    });
  });

  describe('Cascade delete', () => {
    it('should cascade delete messages when session is deleted', async () => {
      await storage.sessions.create({
        id: 'cascade-session',
        title: 'Cascade Test',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.messages.create({
        id: 'cascade-msg',
        sessionId: 'cascade-session',
        role: 'user',
        content: 'Test',
        createdAt: new Date(),
      });

      // Delete session directly via SQL to trigger cascade
      const connection = storage.getConnection();
      connection.sqlite.exec("DELETE FROM sessions WHERE id = 'cascade-session'");

      const messages = await storage.messages.findBySessionId('cascade-session');
      expect(messages).toHaveLength(0);
    });
  });

  describe('Regression tests', () => {
    describe('findPending with OR logic', () => {
      beforeEach(async () => {
        await storage.sessions.create({
          id: 'test-session',
          title: 'Test Session',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      it('should find both pending and awaiting_approval executions', async () => {
        const now = new Date();

        await storage.toolExecutions.create({
          id: 'exec-pending',
          sessionId: 'test-session',
          toolName: 'read_file',
          input: {},
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        });

        await storage.toolExecutions.create({
          id: 'exec-awaiting',
          sessionId: 'test-session',
          toolName: 'write_file',
          input: {},
          status: 'awaiting_approval',
          createdAt: now,
          updatedAt: now,
        });

        await storage.toolExecutions.create({
          id: 'exec-completed',
          sessionId: 'test-session',
          toolName: 'delete_file',
          input: {},
          status: 'completed',
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        });

        const pending = await storage.toolExecutions.findPending();
        expect(pending).toHaveLength(2);
        expect(pending.map(e => e.id).sort()).toEqual(['exec-awaiting', 'exec-pending']);
      });
    });

    describe('deleteOlderThan with date filtering', () => {
      beforeEach(async () => {
        await storage.sessions.create({
          id: 'test-session',
          title: 'Test Session',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      it('should only delete checkpoints older than the specified date', async () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

        // Create checkpoints at different times
        await storage.checkpoints.create({
          id: 'checkpoint-recent',
          sessionId: 'test-session',
          name: 'Recent',
          messageCount: 1,
          createdAt: oneHourAgo,
        });

        await storage.checkpoints.create({
          id: 'checkpoint-middle',
          sessionId: 'test-session',
          name: 'Middle',
          messageCount: 2,
          createdAt: twoHoursAgo,
        });

        await storage.checkpoints.create({
          id: 'checkpoint-old',
          sessionId: 'test-session',
          name: 'Old',
          messageCount: 3,
          createdAt: threeHoursAgo,
        });

        // Delete checkpoints older than 2.5 hours ago
        const cutoff = new Date(now.getTime() - 2.5 * 60 * 60 * 1000);
        const deleted = await storage.checkpoints.deleteOlderThan('test-session', cutoff);
        expect(deleted).toBe(1);

        // Verify only the old checkpoint was deleted
        const remaining = await storage.checkpoints.findBySessionId('test-session');
        expect(remaining).toHaveLength(2);
        expect(remaining.map(c => c.id).sort()).toEqual(['checkpoint-middle', 'checkpoint-recent']);
      });
    });

    describe('message pagination with cursor', () => {
      beforeEach(async () => {
        await storage.sessions.create({
          id: 'test-session',
          title: 'Test Session',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      it('should paginate correctly using cursor', async () => {
        const now = new Date();

        // Create 10 messages with different timestamps
        for (let i = 0; i < 10; i++) {
          await storage.messages.create({
            id: `msg-${i}`,
            sessionId: 'test-session',
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`,
            createdAt: new Date(now.getTime() - i * 1000), // Each 1 second apart
          });
        }

        // First page: get 3 most recent messages
        const page1 = await storage.messages.findBySessionIdPaginated('test-session', undefined, 3);
        expect(page1.messages).toHaveLength(3);
        expect(page1.hasMore).toBe(true);
        // Returned in ascending order, so most recent is last
        expect(page1.messages[2].content).toBe('Message 0');

        // Second page: use cursor from oldest message of page 1
        const cursor = page1.messages[0].createdAt;
        const page2 = await storage.messages.findBySessionIdPaginated('test-session', cursor, 3);
        expect(page2.messages).toHaveLength(3);
        expect(page2.hasMore).toBe(true);
      });
    });
  });
});
