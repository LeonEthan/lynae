// Storage package - SQLite + Drizzle ORM
// PR-04: Full storage implementation with repositories and migrations

import {
  createConnection,
  DatabaseConfig,
  DatabaseConnection,
  runMigrations,
  isDatabaseInitialized,
} from './db.js';
import {
  createSessionRepository,
  createMessageRepository,
  createToolExecutionRepository,
  createApprovalRepository,
  createSettingsRepository,
  createCheckpointRepository,
  type SessionRepository,
  type MessageRepository,
  type ToolExecutionRepository,
  type ApprovalRepository,
  type SettingsRepository,
  type CheckpointRepository,
} from './repositories/index.js';

export interface StorageConfig extends DatabaseConfig {
  autoInitialize?: boolean;
  enableWAL?: boolean;
}

export class Storage {
  private config: StorageConfig;
  private connection: DatabaseConnection | null = null;
  private _sessions: SessionRepository | null = null;
  private _messages: MessageRepository | null = null;
  private _toolExecutions: ToolExecutionRepository | null = null;
  private _approvals: ApprovalRepository | null = null;
  private _settings: SettingsRepository | null = null;
  private _checkpoints: CheckpointRepository | null = null;
  private initialized = false;

  constructor(config: StorageConfig) {
    this.config = {
      autoInitialize: true,
      enableWAL: true,
      ...config,
    };
  }

  /**
   * Initialize the storage layer
   * - Creates database connection
   * - Runs migrations
   * - Initializes repositories
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create database connection
    this.connection = createConnection({
      databasePath: this.config.databasePath,
      migrationsFolder: this.config.migrationsFolder,
      runMigrations: this.config.runMigrations,
    });

    // Run migrations
    await runMigrations(this.connection, this.config.migrationsFolder);

    // Initialize repositories
    this._sessions = createSessionRepository(this.connection);
    this._messages = createMessageRepository(this.connection);
    this._toolExecutions = createToolExecutionRepository(this.connection);
    this._approvals = createApprovalRepository(this.connection);
    this._settings = createSettingsRepository(this.connection);
    this._checkpoints = createCheckpointRepository(this.connection);

    this.initialized = true;
  }

  /**
   * Check if storage is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if database has been properly set up
   */
  isDatabaseReady(): boolean {
    if (!this.connection) {
      return false;
    }
    return isDatabaseInitialized(this.connection);
  }

  /**
   * Get the database connection (for advanced use)
   */
  getConnection(): DatabaseConnection {
    if (!this.connection) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this.connection;
  }

  /**
   * Session repository
   */
  get sessions(): SessionRepository {
    if (!this._sessions) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this._sessions;
  }

  /**
   * Message repository
   */
  get messages(): MessageRepository {
    if (!this._messages) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this._messages;
  }

  /**
   * Tool execution repository
   */
  get toolExecutions(): ToolExecutionRepository {
    if (!this._toolExecutions) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this._toolExecutions;
  }

  /**
   * Approval repository
   */
  get approvals(): ApprovalRepository {
    if (!this._approvals) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this._approvals;
  }

  /**
   * Settings repository
   */
  get settings(): SettingsRepository {
    if (!this._settings) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this._settings;
  }

  /**
   * Checkpoint repository
   */
  get checkpoints(): CheckpointRepository {
    if (!this._checkpoints) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
    return this._checkpoints;
  }

  /**
   * Close the storage connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
      this._sessions = null;
      this._messages = null;
      this._toolExecutions = null;
      this._approvals = null;
      this._settings = null;
      this._checkpoints = null;
      this.initialized = false;
    }
  }

  /**
   * Create a new storage instance with auto-initialization
   */
  static async create(config: StorageConfig): Promise<Storage> {
    const storage = new Storage(config);
    if (config.autoInitialize !== false) {
      await storage.initialize();
    }
    return storage;
  }
}

// Re-export types
export * from './schema/index.js';
export * from './db.js';
export * from './repositories/index.js';

// Default export
export default Storage;
