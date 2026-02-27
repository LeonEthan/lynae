// Approval repository - handles approval CRUD operations
import { eq, desc, and } from 'drizzle-orm';
import { DatabaseConnection } from '../db.js';
import { approvals, Approval, NewApproval } from '../schema/index.js';

export interface ApprovalFilters {
  toolExecutionId?: string;
  decision?: Approval['decision'];
  approvedBy?: Approval['approvedBy'];
}

export interface ApprovalRepository {
  findById(id: string): Promise<Approval | undefined>;
  findByToolExecutionId(toolExecutionId: string): Promise<Approval[]>;
  findLatestByToolExecutionId(toolExecutionId: string): Promise<Approval | undefined>;
  findAll(filters?: ApprovalFilters): Promise<Approval[]>;
  create(data: NewApproval): Promise<Approval>;
  delete(id: string): Promise<boolean>;
  deleteByToolExecutionId(toolExecutionId: string): Promise<number>;
}

export function createApprovalRepository(connection: DatabaseConnection): ApprovalRepository {
  const { db } = connection;

  return {
    async findById(id: string): Promise<Approval | undefined> {
      return await db.query.approvals.findFirst({
        where: eq(approvals.id, id),
      });
    },

    async findByToolExecutionId(toolExecutionId: string): Promise<Approval[]> {
      return await db.query.approvals.findMany({
        where: eq(approvals.toolExecutionId, toolExecutionId),
        orderBy: [desc(approvals.createdAt)],
      });
    },

    async findLatestByToolExecutionId(toolExecutionId: string): Promise<Approval | undefined> {
      return await db.query.approvals.findFirst({
        where: eq(approvals.toolExecutionId, toolExecutionId),
        orderBy: [desc(approvals.createdAt)],
      });
    },

    async findAll(filters?: ApprovalFilters): Promise<Approval[]> {
      const conditions = [];

      if (filters?.toolExecutionId) {
        conditions.push(eq(approvals.toolExecutionId, filters.toolExecutionId));
      }

      if (filters?.decision) {
        conditions.push(eq(approvals.decision, filters.decision));
      }

      if (filters?.approvedBy) {
        conditions.push(eq(approvals.approvedBy, filters.approvedBy));
      }

      if (conditions.length > 0) {
        return await db.query.approvals.findMany({
          where: and(...conditions),
          orderBy: [desc(approvals.createdAt)],
        });
      }

      return await db.query.approvals.findMany({
        orderBy: [desc(approvals.createdAt)],
      });
    },

    async create(data: NewApproval): Promise<Approval> {
      await db.insert(approvals).values(data);
      const approval = await this.findById(data.id);
      if (!approval) {
        throw new Error(`Failed to create approval with id ${data.id}`);
      }
      return approval;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(approvals).where(eq(approvals.id, id));
      return result.changes > 0;
    },

    async deleteByToolExecutionId(toolExecutionId: string): Promise<number> {
      const result = await db
        .delete(approvals)
        .where(eq(approvals.toolExecutionId, toolExecutionId));
      return result.changes || 0;
    },
  };
}
