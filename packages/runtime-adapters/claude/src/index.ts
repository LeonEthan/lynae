// Claude Runtime Adapter - PR-06 will implement full SDK integration
// Wraps Claude SDK to provide AgentRuntime interface

export interface AgentRuntime {
  createSession(config: SessionConfig): Promise<AgentSession>;
  listCapabilities(): RuntimeCapabilities;
}

export interface AgentSession {
  id: string;
  sendMessage(message: string): AsyncIterable<RuntimeEvent>;
  cancel(): void;
}

export interface SessionConfig {
  model?: string;
  systemPrompt?: string;
  workspaceRoot: string;
}

export type RuntimeEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; output: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface RuntimeCapabilities {
  models: string[];
  supportsTools: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
}

export class ClaudeAdapter implements AgentRuntime {
  private apiKey?: string;

  constructor(config: { apiKey?: string } = {}) {
    this.apiKey = config.apiKey;
  }

  async createSession(config: SessionConfig): Promise<AgentSession> {
    // Placeholder - PR-06 will implement actual SDK integration
    const session: AgentSession = {
      id: generateId(),
      async *sendMessage(message: string): AsyncGenerator<RuntimeEvent> {
        yield { type: 'text', content: `Placeholder response for: ${message}` };
        yield { type: 'done' };
      },
      cancel() {
        console.log('Session cancelled');
      }
    };
    return session;
  }

  listCapabilities(): RuntimeCapabilities {
    return {
      models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 200000
    };
  }
}

function generateId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}