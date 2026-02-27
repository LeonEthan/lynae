// Tests for drizzle-kit migration application (not fallback schema)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { Storage } from '../index.js';

// Helper to create a temporary directory
function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lynae-migration-test-'));
}

// Helper to clean up temp directory
function cleanupTempDir(dirPath: string) {
  try {
    rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Helper to create a drizzle migration folder with a migration file
function createMigrationsFolder(baseDir: string): string {
  const migrationsDir = join(baseDir, 'drizzle');
  mkdirSync(migrationsDir, { recursive: true });

  // Create a drizzle-style migration file
  // Drizzle migrations split statements with special markers or newlines
  // Each statement should be on its own line for the migrator to handle properly
  const migrationFile = join(migrationsDir, '0000_initial.sql');
  writeFileSync(
    migrationFile,
    `CREATE TABLE IF NOT EXISTS "test_migration_marker" (
	"id"	text PRIMARY KEY NOT NULL,
	"applied_at"	integer NOT NULL
);
--> statement-breakpoint
INSERT INTO "test_migration_marker" ("id", "applied_at") VALUES ('test', 1);
`
  );

  // Create the drizzle journal file (required for migrate() to find migrations)
  const journalFile = join(migrationsDir, 'meta', '_journal.json');
  mkdirSync(join(migrationsDir, 'meta'), { recursive: true });
  writeFileSync(
    journalFile,
    JSON.stringify({
      version: '6',
      dialect: 'sqlite',
      entries: [
        {
          idx: 0,
          version: '0',
          when: Date.now(),
          tag: '0000_initial',
          breakpoints: true, // Enable statement breakpoints
        },
      ],
    })
  );

  return migrationsDir;
}

describe('Migrations', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = createTempDir();
    dbPath = join(tempDir, 'test.db');
  });

  afterEach(async () => {
    cleanupTempDir(tempDir);
  });

  describe('with drizzle migrations folder', () => {
    it('should apply migrations when migrations folder exists', async () => {
      const migrationsDir = createMigrationsFolder(tempDir);

      // Verify the migration file exists
      const migrationFile = join(migrationsDir, '0000_initial.sql');
      expect(existsSync(migrationFile)).toBe(true);

      // Create storage with the migrations folder
      const storage = await Storage.create({
        databasePath: dbPath,
        migrationsFolder: migrationsDir,
      });

      // Verify storage is initialized
      expect(storage.isInitialized()).toBe(true);

      // Note: isDatabaseReady() checks for core schema tables which may not exist
      // when only custom migrations are applied. We verify the migration ran instead.

      // Verify the migration was applied by checking for our marker table
      const connection = storage.getConnection();
      const marker = connection.sqlite
        .prepare("SELECT id FROM test_migration_marker WHERE id = 'test'")
        .get();
      expect(marker).toBeDefined();

      await storage.close();
    });

    it('should apply only migrations when migrations folder exists (no fallback)', async () => {
      const migrationsDir = createMigrationsFolder(tempDir);

      const storage = await Storage.create({
        databasePath: dbPath,
        migrationsFolder: migrationsDir,
      });

      // When using drizzle migrations, only those migrations are applied
      // The fallback schema is NOT applied
      const connection = storage.getConnection();

      // Custom migration table should exist
      const customTable = connection.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'test_migration_marker'")
        .get();
      expect(customTable).toBeDefined();

      // Core schema tables should NOT exist (they weren't in our migration)
      const sessionsTable = connection.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'sessions'")
        .get();
      expect(sessionsTable).toBeUndefined();

      await storage.close();
    });

    it('should handle runMigrations=false to skip migrations', async () => {
      const migrationsDir = createMigrationsFolder(tempDir);

      // Create storage with migrations disabled
      const storage = await Storage.create({
        databasePath: dbPath,
        migrationsFolder: migrationsDir,
        runMigrations: false,
      });

      expect(storage.isInitialized()).toBe(true);

      // The custom migration marker should NOT exist because migrations were skipped
      const connection = storage.getConnection();
      const marker = connection.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'test_migration_marker'")
        .get();
      expect(marker).toBeUndefined();

      await storage.close();
    });
  });

  describe('migration path resolution', () => {
    it('should resolve default migrations path to packages/storage/drizzle', async () => {
      // This test verifies the default path is correct by:
      // 1. Creating a migrations folder at packages/storage/drizzle
      // 2. Verifying migrations are applied from that location

      // The default path is relative to src/db.ts location:
      // __dirname = packages/storage/src
      // join(__dirname, '..', 'drizzle') = packages/storage/drizzle
      const defaultMigrationsDir = join(process.cwd(), 'drizzle');

      // Clean up any existing drizzle folder from previous test runs
      try {
        rmSync(defaultMigrationsDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }

      // Create migrations folder at the default location
      mkdirSync(defaultMigrationsDir, { recursive: true });

      // Create a marker migration file (drizzle-kit format with statement-breakpoint)
      // Include core schema tables so other tests don't break
      const markerFile = join(defaultMigrationsDir, '0000_test_marker.sql');
      writeFileSync(
        markerFile,
        `CREATE TABLE IF NOT EXISTS "default_path_test_marker" (
	"id"	text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id"	text PRIMARY KEY NOT NULL,
	"title"	text NOT NULL,
	"workspace_path"	text,
	"model"	text,
	"status"	text DEFAULT 'active' NOT NULL,
	"created_at"	integer NOT NULL,
	"updated_at"	integer NOT NULL
);
--> statement-breakpoint
INSERT INTO "default_path_test_marker" ("id") VALUES ('from-default-path');
`
      );

      // Create journal file
      const metaDir = join(defaultMigrationsDir, 'meta');
      mkdirSync(metaDir, { recursive: true });
      writeFileSync(
        join(metaDir, '_journal.json'),
        JSON.stringify({
          version: '6',
          dialect: 'sqlite',
          entries: [
            {
              idx: 0,
              version: '0',
              when: Date.now(),
              tag: '0000_test_marker',
              breakpoints: true,
            },
          ],
        })
      );

      try {
        // Create storage WITHOUT specifying migrationsFolder
        // It should find and apply migrations from packages/storage/drizzle
        const storage = await Storage.create({
          databasePath: dbPath,
          // migrationsFolder not specified - uses default
        });

        expect(storage.isInitialized()).toBe(true);

        // Verify the migration was applied from the default location
        const connection = storage.getConnection();
        const marker = connection.sqlite
          .prepare("SELECT id FROM default_path_test_marker")
          .get() as { id: string } | undefined;

        // This proves the default path resolved correctly
        expect(marker?.id).toBe('from-default-path');

        await storage.close();
      } finally {
        // Always clean up the drizzle folder
        try {
          rmSync(defaultMigrationsDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should use custom migrations folder when provided', async () => {
      const customMigrationsDir = createMigrationsFolder(tempDir);

      const storage = await Storage.create({
        databasePath: dbPath,
        migrationsFolder: customMigrationsDir,
      });

      // Verify the custom migration was applied
      const connection = storage.getConnection();
      const marker = connection.sqlite
        .prepare("SELECT id FROM test_migration_marker WHERE id = 'test'")
        .get();
      expect(marker).toBeDefined();

      await storage.close();
    });
  });

  describe('WAL mode configuration', () => {
    it('should enable WAL mode by default', async () => {
      const storage = await Storage.create({
        databasePath: dbPath,
      });

      const connection = storage.getConnection();
      // pragma() returns the result directly for pragmas that return a single value
      const journalMode = connection.sqlite.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');

      await storage.close();
    });

    it('should disable WAL mode when enableWAL is false', async () => {
      const storage = await Storage.create({
        databasePath: dbPath,
        enableWAL: false,
      });

      const connection = storage.getConnection();
      const journalMode = connection.sqlite.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('delete'); // Default SQLite journal mode

      await storage.close();
    });
  });
});
