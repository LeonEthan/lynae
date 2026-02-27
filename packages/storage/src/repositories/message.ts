// Message repository - handles message CRUD operations
import { eq, desc, and, asc, sql } from 'drizzle-orm';
import { DatabaseConnection } from '../db.js';
import { messages, Message, NewMessage } from '../schema/index.js';

export interface MessageFilters {
  sessionId?: string;
  role?: Message['role'];
}

export interface MessageRepository {
  findById(id: string): Promise<Message | undefined>;
  findBySessionId(sessionId: string, limit?: number): Promise<Message[]>;
  findBySessionIdPaginated(
    sessionId: string,
    cursor?: Date,
    limit?: number
  ): Promise<{ messages: Message[]; hasMore: boolean }>;
  findAll(filters?: MessageFilters): Promise<Message[]>;
  create(data: NewMessage): Promise<Message>;
  createBatch(data: NewMessage[]): Promise<Message[]>;
  update(id: string, data: Partial<NewMessage>): Promise<Message | undefined>;
  delete(id: string): Promise<boolean>;
  deleteBySessionId(sessionId: string): Promise<number>;
  countBySessionId(sessionId: string): Promise<number>;
}

export function createMessageRepository(connection: DatabaseConnection): MessageRepository {
  const { db } = connection;

  return {
    async findById(id: string): Promise<Message | undefined> {
      return await db.query.messages.findFirst({
        where: eq(messages.id, id),
      });
    },

    async findBySessionId(sessionId: string, limit?: number): Promise<Message[]> {
      return await db.query.messages.findMany({
        where: eq(messages.sessionId, sessionId),
        orderBy: [asc(messages.createdAt)],
        limit,
      });
    },

    async findBySessionIdPaginated(
      sessionId: string,
      cursor?: Date,
      limit: number = 50
    ): Promise<{ messages: Message[]; hasMore: boolean }> {
      const conditions = [eq(messages.sessionId, sessionId)];

      if (cursor) {
        conditions.push(desc(messages.createdAt));
      }

      const results = await db.query.messages.findMany({
        where: and(...conditions),
        orderBy: [desc(messages.createdAt)],
        limit: limit + 1,
      });

      const hasMore = results.length > limit;
      const messagesList = hasMore ? results.slice(0, limit) : results;

      // Return in ascending order (oldest first)
      return {
        messages: messagesList.reverse(),
        hasMore,
      };
    },

    async findAll(filters?: MessageFilters): Promise<Message[]> {
      const conditions = [];

      if (filters?.sessionId) {
        conditions.push(eq(messages.sessionId, filters.sessionId));
      }

      if (filters?.role) {
        conditions.push(eq(messages.role, filters.role));
      }

      if (conditions.length > 0) {
        return await db.query.messages.findMany({
          where: and(...conditions),
          orderBy: [desc(messages.createdAt)],
        });
      }

      return await db.query.messages.findMany({
        orderBy: [desc(messages.createdAt)],
      });
    },

    async create(data: NewMessage): Promise<Message> {
      await db.insert(messages).values(data);
      const message = await this.findById(data.id);
      if (!message) {
        throw new Error(`Failed to create message with id ${data.id}`);
      }
      return message;
    },

    async createBatch(data: NewMessage[]): Promise<Message[]> {
      if (data.length === 0) return [];

      await db.insert(messages).values(data);

      // Fetch all created messages
      const ids = data.map((d) => d.id);
      const created = await db.query.messages.findMany({
        where: (msg, { inArray }) => inArray(msg.id, ids),
      });

      return created;
    },

    async update(id: string, data: Partial<NewMessage>): Promise<Message | undefined> {
      await db.update(messages).set(data).where(eq(messages.id, id));
      return this.findById(id);
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(messages).where(eq(messages.id, id));
      return result.changes > 0;
    },

    async deleteBySessionId(sessionId: string): Promise<number> {
      const result = await db.delete(messages).where(eq(messages.sessionId, sessionId));
      return result.changes || 0;
    },

    async countBySessionId(sessionId: string): Promise<number> {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.sessionId, sessionId));
      return result[0]?.count ?? 0;
    },
  };
}
