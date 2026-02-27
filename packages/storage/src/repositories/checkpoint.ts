// Checkpoint repository - handles checkpoint CRUD operations
import { eq, desc, and, sql } from 'drizzle-orm';
import { DatabaseConnection } from '../db.js';
import { checkpoints, Checkpoint, NewCheckpoint } from '../schema/index.js';

export interface CheckpointFilters {
  sessionId?: string;
}

export interface CheckpointRepository {
  findById(id: string): Promise<Checkpoint | undefined>;
  findBySessionId(sessionId: string): Promise<Checkpoint[]>;
  findLatestBySessionId(sessionId: string): Promise<Checkpoint | undefined>;
  findAll(filters?: CheckpointFilters): Promise<Checkpoint[]>;
  create(data: NewCheckpoint): Promise<Checkpoint>;
  update(id: string, data: Partial<NewCheckpoint>): Promise<Checkpoint | undefined>;
  delete(id: string): Promise<boolean>;
  deleteBySessionId(sessionId: string): Promise<number>;
  deleteOlderThan(sessionId: string, beforeDate: Date): Promise<number>;
}

export function createCheckpointRepository(
  connection: DatabaseConnection
): CheckpointRepository {
  const { db, sqlite } = connection;

  return {
    async findById(id: string): Promise<Checkpoint | undefined> {
      return await db.query.checkpoints.findFirst({
        where: eq(checkpoints.id, id),
      });
    },

    async findBySessionId(sessionId: string): Promise<Checkpoint[]> {
      return await db.query.checkpoints.findMany({
        where: eq(checkpoints.sessionId, sessionId),
        orderBy: [desc(checkpoints.createdAt)],
      });
    },

    async findLatestBySessionId(sessionId: string): Promise<Checkpoint | undefined> {
      return await db.query.checkpoints.findFirst({
        where: eq(checkpoints.sessionId, sessionId),
        orderBy: [desc(checkpoints.createdAt)],
      });
    },

    async findAll(filters?: CheckpointFilters): Promise<Checkpoint[]> {
      if (filters?.sessionId) {
        return await db.query.checkpoints.findMany({
          where: eq(checkpoints.sessionId, filters.sessionId),
          orderBy: [desc(checkpoints.createdAt)],
        });
      }

      return await db.query.checkpoints.findMany({
        orderBy: [desc(checkpoints.createdAt)],
      });
    },

    async create(data: NewCheckpoint): Promise<Checkpoint> {
      await db.insert(checkpoints).values(data);
      const checkpoint = await this.findById(data.id);
      if (!checkpoint) {
        throw new Error(`Failed to create checkpoint with id ${data.id}`);
      }
      return checkpoint;
    },

    async update(
      id: string,
      data: Partial<NewCheckpoint>
    ): Promise<Checkpoint | undefined> {
      await db.update(checkpoints).set(data).where(eq(checkpoints.id, id));
      return this.findById(id);
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(checkpoints).where(eq(checkpoints.id, id));
      return result.changes > 0;
    },

    async deleteBySessionId(sessionId: string): Promise<number> {
      const result = await db
        .delete(checkpoints)
        .where(eq(checkpoints.sessionId, sessionId));
      return result.changes || 0;
    },

    async deleteOlderThan(sessionId: string, beforeDate: Date): Promise<number> {
      // Drizzle stores timestamps as seconds (Unix epoch), not milliseconds
      const beforeTimestampSeconds = Math.floor(beforeDate.getTime() / 1000);
      const result = sqlite
        .prepare(
          'DELETE FROM checkpoints WHERE session_id = ? AND created_at < ?'
        )
        .run(sessionId, beforeTimestampSeconds);
      return result.changes || 0;
    },
  };
}
