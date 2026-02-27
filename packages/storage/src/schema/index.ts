// Database schema for Lynae storage
// Defines tables for sessions, messages, tool_executions, approvals, and settings

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Sessions table - stores chat sessions
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  workspacePath: text('workspace_path'),
  model: text('model'),
  status: text('status', { enum: ['active', 'archived', 'deleted'] }).notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Messages table - stores chat messages within sessions
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  metadata: text('metadata', { mode: 'json' }), // Additional message metadata
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  tokenCount: integer('token_count'),
});

// Tool executions table - stores tool call records
export const toolExecutions = sqliteTable('tool_executions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  input: text('input', { mode: 'json' }).notNull(),
  output: text('output', { mode: 'json' }),
  status: text('status', {
    enum: ['pending', 'awaiting_approval', 'approved', 'rejected', 'running', 'completed', 'failed', 'cancelled'],
  })
    .notNull()
    .default('pending'),
  error: text('error'),
  executionTimeMs: integer('execution_time_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

// Approvals table - stores approval decisions for tool executions
export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  toolExecutionId: text('tool_execution_id')
    .notNull()
    .references(() => toolExecutions.id, { onDelete: 'cascade' }),
  decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
  reason: text('reason'),
  approvedBy: text('approved_by', { enum: ['user', 'policy', 'auto'] }).notNull(),
  policyRuleId: text('policy_rule_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Settings table - stores application settings
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Checkpoints table - stores session state snapshots for rollback
export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  gitCommitSha: text('git_commit_sha'),
  fileSystemState: text('file_system_state', { mode: 'json' }),
  messageCount: integer('message_count').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Define relations
export const sessionsRelations = relations(sessions, ({ many }) => ({
  messages: many(messages),
  toolExecutions: many(toolExecutions),
  checkpoints: many(checkpoints),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  session: one(sessions, {
    fields: [messages.sessionId],
    references: [sessions.id],
  }),
  toolExecutions: many(toolExecutions),
}));

export const toolExecutionsRelations = relations(toolExecutions, ({ one, many }) => ({
  session: one(sessions, {
    fields: [toolExecutions.sessionId],
    references: [sessions.id],
  }),
  message: one(messages, {
    fields: [toolExecutions.messageId],
    references: [messages.id],
  }),
  approvals: many(approvals),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  toolExecution: one(toolExecutions, {
    fields: [approvals.toolExecutionId],
    references: [toolExecutions.id],
  }),
}));

export const checkpointsRelations = relations(checkpoints, ({ one }) => ({
  session: one(sessions, {
    fields: [checkpoints.sessionId],
    references: [sessions.id],
  }),
}));

// Export types inferred from schema
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type ToolExecution = typeof toolExecutions.$inferSelect;
export type NewToolExecution = typeof toolExecutions.$inferInsert;

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export type Checkpoint = typeof checkpoints.$inferSelect;
export type NewCheckpoint = typeof checkpoints.$inferInsert;
