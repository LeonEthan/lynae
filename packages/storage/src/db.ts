// Database connection and migration management
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema/index.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DatabaseConfig {
  databasePath: string;
  migrationsFolder?: string;
  runMigrations?: boolean;
  /**
   * Enable WAL mode for better concurrency (default: true)
   */
  enableWAL?: boolean;
}

export interface DatabaseConnection {
  sqlite: Database.Database;
  db: ReturnType<typeof drizzle<typeof schema>>;
  close: () => void;
}

/**
 * Creates a database connection with better-sqlite3 and Drizzle ORM
 */
export function createConnection(config: DatabaseConfig): DatabaseConnection {
  // Ensure directory exists
  const dbDir = dirname(config.databasePath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  // Create SQLite connection
  const sqlite = new Database(config.databasePath);

  // Enable WAL mode for better concurrency (default: true)
  const enableWAL = config.enableWAL !== false;
  if (enableWAL) {
    sqlite.pragma('journal_mode = WAL');
  }

  // Enable foreign keys
  sqlite.pragma('foreign_keys = ON');

  // Create Drizzle ORM instance
  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    close: () => {
      sqlite.close();
    },
  };
}

/**
 * Default migrations folder relative to the package root
 * This resolves to packages/storage/drizzle regardless of where the process is run
 */
const DEFAULT_MIGRATIONS_FOLDER = join(__dirname, '..', 'drizzle');

/**
 * Runs migrations on the database
 * Uses drizzle-kit generated migrations
 */
export async function runMigrations(
  connection: DatabaseConnection,
  migrationsFolder?: string
): Promise<void> {
  const migrationsPath = migrationsFolder || DEFAULT_MIGRATIONS_FOLDER;

  // Check if migrations folder exists
  if (!existsSync(migrationsPath)) {
    // If no migrations folder, apply schema directly (development mode)
    console.log('No migrations folder found at', migrationsPath, '- applying schema directly');
    await applySchemaDirectly(connection);
    return;
  }

  try {
    migrate(connection.db, { migrationsFolder: migrationsPath });
    console.log('Migrations applied successfully from', migrationsPath);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

/**
 * Applies schema directly without migrations (useful for development/testing)
 * Creates tables if they don't exist (idempotent)
 */
async function applySchemaDirectly(connection: DatabaseConnection): Promise<void> {
  const { sqlite } = connection;

  // Sessions table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_path TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Messages table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      token_count INTEGER
    )
  `);

  // Tool executions table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tool_executions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      tool_name TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      execution_time_ms INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    )
  `);

  // Approvals table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      tool_execution_id TEXT NOT NULL REFERENCES tool_executions(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      reason TEXT,
      approved_by TEXT NOT NULL,
      policy_rule_id TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // Settings table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Checkpoints table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      git_commit_sha TEXT,
      file_system_state TEXT,
      message_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  // Create indexes for common queries
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_tool_executions_session_id ON tool_executions(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_executions_status ON tool_executions(status);
    CREATE INDEX IF NOT EXISTS idx_approvals_tool_execution_id ON approvals(tool_execution_id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_session_id ON checkpoints(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
  `);

  console.log('Schema applied directly (tables created if not exist)');
}

/**
 * Checks if the database is properly initialized
 */
export function isDatabaseInitialized(connection: DatabaseConnection): boolean {
  try {
    const tables = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?, ?, ?, ?, ?, ?)"
      )
      .all('sessions', 'messages', 'tool_executions', 'approvals', 'settings', 'checkpoints');
    return tables.length === 6;
  } catch {
    return false;
  }
}
