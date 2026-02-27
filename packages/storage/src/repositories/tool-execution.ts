// Tool execution repository - handles tool execution CRUD operations
import { eq, desc, and, asc, sql } from 'drizzle-orm';
import { DatabaseConnection } from '../db.js';
import { toolExecutions, ToolExecution, NewToolExecution } from '../schema/index.js';

export interface ToolExecutionFilters {
  sessionId?: string;
  status?: ToolExecution['status'];
  toolName?: string;
}

export interface ToolExecutionRepository {
  findById(id: string): Promise<ToolExecution | undefined>;
  findBySessionId(sessionId: string, limit?: number): Promise<ToolExecution[]>;
  findByMessageId(messageId: string): Promise<ToolExecution[]>;
  findPending(): Promise<ToolExecution[]>;
  findAll(filters?: ToolExecutionFilters): Promise<ToolExecution[]>;
  create(data: NewToolExecution): Promise<ToolExecution>;
  update(id: string, data: Partial<NewToolExecution>): Promise<ToolExecution | undefined>;
  updateStatus(
    id: string,
    status: ToolExecution['status'],
    additionalData?: Partial<NewToolExecution>
  ): Promise<ToolExecution | undefined>;
  delete(id: string): Promise<boolean>;
  deleteBySessionId(sessionId: string): Promise<number>;
  countBySessionId(sessionId: string): Promise<number>;
  getStatsByToolName(sessionId: string): Promise<{ toolName: string; count: number; avgExecutionTime: number }[]>;
}

export function createToolExecutionRepository(
  connection: DatabaseConnection
): ToolExecutionRepository {
  const { db } = connection;

  return {
    async findById(id: string): Promise<ToolExecution | undefined> {
      return await db.query.toolExecutions.findFirst({
        where: eq(toolExecutions.id, id),
      });
    },

    async findBySessionId(sessionId: string, limit?: number): Promise<ToolExecution[]> {
      return await db.query.toolExecutions.findMany({
        where: eq(toolExecutions.sessionId, sessionId),
        orderBy: [desc(toolExecutions.createdAt)],
        limit,
      });
    },

    async findByMessageId(messageId: string): Promise<ToolExecution[]> {
      return await db.query.toolExecutions.findMany({
        where: eq(toolExecutions.messageId, messageId),
        orderBy: [asc(toolExecutions.createdAt)],
      });
    },

    async findPending(): Promise<ToolExecution[]> {
      return await db.query.toolExecutions.findMany({
        where: and(
          eq(toolExecutions.status, 'pending'),
          eq(toolExecutions.status, 'awaiting_approval')
        ),
        orderBy: [asc(toolExecutions.createdAt)],
      });
    },

    async findAll(filters?: ToolExecutionFilters): Promise<ToolExecution[]> {
      const conditions = [];

      if (filters?.sessionId) {
        conditions.push(eq(toolExecutions.sessionId, filters.sessionId));
      }

      if (filters?.status) {
        conditions.push(eq(toolExecutions.status, filters.status));
      }

      if (filters?.toolName) {
        conditions.push(eq(toolExecutions.toolName, filters.toolName));
      }

      if (conditions.length > 0) {
        return await db.query.toolExecutions.findMany({
          where: and(...conditions),
          orderBy: [desc(toolExecutions.createdAt)],
        });
      }

      return await db.query.toolExecutions.findMany({
        orderBy: [desc(toolExecutions.createdAt)],
      });
    },

    async create(data: NewToolExecution): Promise<ToolExecution> {
      await db.insert(toolExecutions).values(data);
      const execution = await this.findById(data.id);
      if (!execution) {
        throw new Error(`Failed to create tool execution with id ${data.id}`);
      }
      return execution;
    },

    async update(id: string, data: Partial<NewToolExecution>): Promise<ToolExecution | undefined> {
      await db
        .update(toolExecutions)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(toolExecutions.id, id));
      return this.findById(id);
    },

    async updateStatus(
      id: string,
      status: ToolExecution['status'],
      additionalData?: Partial<NewToolExecution>
    ): Promise<ToolExecution | undefined> {
      const updateData: Partial<NewToolExecution> = {
        status,
        updatedAt: new Date(),
        ...additionalData,
      };

      // Automatically set startedAt when transitioning to running
      if (status === 'running' && !additionalData?.startedAt) {
        updateData.startedAt = new Date();
      }

      // Automatically set completedAt when transitioning to completed/failed
      if ((status === 'completed' || status === 'failed') && !additionalData?.completedAt) {
        updateData.completedAt = new Date();

        // Calculate execution time if we have a start time
        const existing = await this.findById(id);
        if (existing?.startedAt) {
          updateData.executionTimeMs =
            updateData.completedAt!.getTime() - existing.startedAt.getTime();
        }
      }

      await db.update(toolExecutions).set(updateData).where(eq(toolExecutions.id, id));
      return this.findById(id);
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(toolExecutions).where(eq(toolExecutions.id, id));
      return result.changes > 0;
    },

    async deleteBySessionId(sessionId: string): Promise<number> {
      const result = await db
        .delete(toolExecutions)
        .where(eq(toolExecutions.sessionId, sessionId));
      return result.changes || 0;
    },

    async countBySessionId(sessionId: string): Promise<number> {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(toolExecutions)
        .where(eq(toolExecutions.sessionId, sessionId));
      return result[0]?.count ?? 0;
    },

    async getStatsByToolName(
      sessionId: string
    ): Promise<{ toolName: string; count: number; avgExecutionTime: number }[]> {
      const results = await db
        .select({
          toolName: toolExecutions.toolName,
          count: sql<number>`count(*)`,
          avgExecutionTime: sql<number>`avg(${toolExecutions.executionTimeMs})`,
        })
        .from(toolExecutions)
        .where(eq(toolExecutions.sessionId, sessionId))
        .groupBy(toolExecutions.toolName);

      return results.map((r) => ({
        toolName: r.toolName,
        count: r.count,
        avgExecutionTime: r.avgExecutionTime || 0,
      }));
    },
  };
}
