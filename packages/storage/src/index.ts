// Storage package - SQLite + Drizzle ORM
// PR-04 will implement full schema and migrations

export interface StorageConfig {
  databasePath: string;
}

export class Storage {
  private config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Placeholder - will be implemented in PR-04
    console.log(`Initializing storage at ${this.config.databasePath}`);
  }

  async close(): Promise<void> {
    // Placeholder - will be implemented in PR-04
    console.log('Closing storage connection');
  }
}

export * from './schema/index.js';
