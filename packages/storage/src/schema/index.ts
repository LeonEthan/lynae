// Database schema placeholder
// Full schema will be implemented in PR-04

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

export interface ToolExecution {
  id: string;
  sessionId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed';
  createdAt: Date;
}

export interface Approval {
  id: string;
  toolExecutionId: string;
  decision: 'approved' | 'rejected';
  reason?: string;
  createdAt: Date;
}
