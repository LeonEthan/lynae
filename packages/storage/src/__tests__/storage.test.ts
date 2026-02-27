import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Storage } from '../index.js';

// Helper to create a temporary database path
function createTempDbPath(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'lynae-storage-test-'));
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

describe('Storage', () => {
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

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(storage.isInitialized()).toBe(true);
      expect(storage.isDatabaseReady()).toBe(true);
    });

    it('should not allow double initialization', async () => {
      await storage.initialize(); // Second call should be no-op
      expect(storage.isInitialized()).toBe(true);
    });

    it('should throw when accessing repositories before initialization', async () => {
      const uninitializedStorage = new Storage({ databasePath: dbPath });
      expect(() => uninitializedStorage.sessions).toThrow('Storage not initialized');
      expect(() => uninitializedStorage.messages).toThrow('Storage not initialized');
      expect(() => uninitializedStorage.toolExecutions).toThrow('Storage not initialized');
      expect(() => uninitializedStorage.approvals).toThrow('Storage not initialized');
      expect(() => uninitializedStorage.settings).toThrow('Storage not initialized');
      expect(() => uninitializedStorage.checkpoints).toThrow('Storage not initialized');
    });
  });

  describe('session persistence', () => {
    it('should persist sessions across restarts', async () => {
      // Create a session
      const sessionId = 'test-session-1';
      const session = await storage.sessions.create({
        id: sessionId,
        title: 'Test Session',
        workspacePath: '/test/workspace',
        model: 'claude-sonnet-4-6',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(session.id).toBe(sessionId);
      expect(session.title).toBe('Test Session');

      // Close storage
      await storage.close();

      // Reopen storage
      const newStorage = await Storage.create({ databasePath: dbPath });

      // Verify session is restored
      const restoredSession = await newStorage.sessions.findById(sessionId);
      expect(restoredSession).toBeDefined();
      expect(restoredSession?.title).toBe('Test Session');
      expect(restoredSession?.workspacePath).toBe('/test/workspace');

      await newStorage.close();
    });

    it('should persist messages across restarts', async () => {
      // Create a session and messages
      const sessionId = 'test-session-2';
      await storage.sessions.create({
        id: sessionId,
        title: 'Test Session with Messages',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.messages.create({
        id: 'msg-1',
        sessionId,
        role: 'user',
        content: 'Hello, AI!',
        createdAt: new Date(),
      });

      await storage.messages.create({
        id: 'msg-2',
        sessionId,
        role: 'assistant',
        content: 'Hello, human!',
        createdAt: new Date(),
      });

      // Close and reopen
      await storage.close();
      const newStorage = await Storage.create({ databasePath: dbPath });

      // Verify messages are restored
      const messages = await newStorage.messages.findBySessionId(sessionId);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');

      await newStorage.close();
    });
  });

  describe('migration idempotency', () => {
    it('should handle multiple consecutive initializations', async () => {
      // Close and reopen multiple times
      for (let i = 0; i < 3; i++) {
        await storage.close();
        storage = await Storage.create({ databasePath: dbPath });
        expect(storage.isDatabaseReady()).toBe(true);
      }
    });

    it('should preserve data across multiple migrations', async () => {
      // Create initial data
      await storage.sessions.create({
        id: 'persistent-session',
        title: 'Persistent Session',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Reinitialize multiple times
      for (let i = 0; i < 3; i++) {
        await storage.close();
        storage = await Storage.create({ databasePath: dbPath });
      }

      // Data should still be there
      const session = await storage.sessions.findById('persistent-session');
      expect(session).toBeDefined();
      expect(session?.title).toBe('Persistent Session');
    });
  });

  describe('repositories', () => {
    it('should expose all repositories', () => {
      expect(storage.sessions).toBeDefined();
      expect(storage.messages).toBeDefined();
      expect(storage.toolExecutions).toBeDefined();
      expect(storage.approvals).toBeDefined();
      expect(storage.settings).toBeDefined();
      expect(storage.checkpoints).toBeDefined();
    });
  });
});
