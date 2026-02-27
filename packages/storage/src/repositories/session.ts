// Session repository - handles session CRUD operations
import { eq, desc, and } from 'drizzle-orm';
import { DatabaseConnection } from '../db.js';
import { sessions, Session, NewSession } from '../schema/index.js';

export interface SessionFilters {
  status?: Session['status'];
  workspacePath?: string;
}

export interface SessionRepository {
  findById(id: string): Promise<Session | undefined>;
  findAll(filters?: SessionFilters): Promise<Session[]>;
  findRecent(limit: number): Promise<Session[]>;
  create(data: NewSession): Promise<Session>;
  update(id: string, data: Partial<NewSession>): Promise<Session | undefined>;
  delete(id: string): Promise<boolean>;
  archive(id: string): Promise<Session | undefined>;
}

export function createSessionRepository(connection: DatabaseConnection): SessionRepository {
  const { db } = connection;

  return {
    async findById(id: string): Promise<Session | undefined> {
      const result = await db.query.sessions.findFirst({
        where: eq(sessions.id, id),
      });
      return result;
    },

    async findAll(filters?: SessionFilters): Promise<Session[]> {
      const conditions = [];

      if (filters?.status) {
        conditions.push(eq(sessions.status, filters.status));
      }

      if (filters?.workspacePath) {
        conditions.push(eq(sessions.workspacePath, filters.workspacePath));
      }

      if (conditions.length > 0) {
        return await db.query.sessions.findMany({
          where: and(...conditions),
          orderBy: [desc(sessions.updatedAt)],
        });
      }

      return await db.query.sessions.findMany({
        orderBy: [desc(sessions.updatedAt)],
      });
    },

    async findRecent(limit: number): Promise<Session[]> {
      return await db.query.sessions.findMany({
        where: eq(sessions.status, 'active'),
        orderBy: [desc(sessions.updatedAt)],
        limit,
      });
    },

    async create(data: NewSession): Promise<Session> {
      await db.insert(sessions).values(data);
      const session = await this.findById(data.id);
      if (!session) {
        throw new Error(`Failed to create session with id ${data.id}`);
      }
      return session;
    },

    async update(id: string, data: Partial<NewSession>): Promise<Session | undefined> {
      await db
        .update(sessions)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(sessions.id, id));
      return this.findById(id);
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(sessions).where(eq(sessions.id, id));
      return result.changes > 0;
    },

    async archive(id: string): Promise<Session | undefined> {
      return this.update(id, { status: 'archived' });
    },
  };
}
