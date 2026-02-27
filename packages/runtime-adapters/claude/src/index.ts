import {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type Query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * Runtime interface for AI agent providers.
 * Abstracts away provider-specific details from the business layer.
 */
export interface AgentRuntime {
  /**
   * Create a new session with the specified configuration.
   * @param config - Session configuration including model and workspace
   * @returns A new AgentSession instance
   */
  createSession(config: SessionConfig): Promise<AgentSession>;

  /**
   * List the capabilities supported by this runtime.
   * @returns RuntimeCapabilities describing available models and features
   */
  listCapabilities(): RuntimeCapabilities;
}

/**
 * A session represents a single conversation with an AI agent.
 */
export interface AgentSession {
  /** Unique identifier for this session */
  id: string;

  /**
   * Send a message and receive a streaming response.
   * @param message - The user message to send
   * @returns AsyncIterable of normalized RuntimeEvent objects
   */
  sendMessage(message: string): AsyncIterable<RuntimeEvent>;

  /**
   * Cancel any in-progress request.
   * Safe to call even when no request is active.
   */
  cancel(): void;
}

/**
 * Configuration options for creating a new session.
 */
export interface SessionConfig {
  /** Claude model identifier (e.g., 'claude-sonnet-4-5') */
  model?: string;

  /** System prompt to set the AI's behavior and context */
  systemPrompt?: string;

  /** Root directory for file operations (security boundary) */
  workspaceRoot: string;

  /** Tool names allowed without approval prompts (Agent SDK option passthrough) */
  allowedTools?: string[];

  /** Permission mode for the Agent SDK runtime */
  permissionMode?: PermissionMode;

  /** Optional custom permission callback */
  canUseTool?: CanUseTool;

  /** Emit partial stream events from Agent SDK */
  includePartialMessages?: boolean;

  /** Maximum number of turns per query */
  maxTurns?: number;

  /**
   * Legacy field from the previous adapter design.
   * Ignored in the thin adapter because Agent SDK owns runtime tool orchestration.
   */
  tools?: ToolDefinition[];
}

/**
 * Legacy tool definition kept for backward compatibility in config shape.
 * Not used by the thin adapter runtime.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Events emitted during streaming message processing.
 */
export type RuntimeEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * Capabilities and features supported by this runtime.
 */
export interface RuntimeCapabilities {
  models: string[];
  supportsTools: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number;
}

type OptionsWithoutPrompt = Omit<Options, 'abortController'>;

class ClaudeSession implements AgentSession {
  id: string;
  private config: SessionConfig;
  private baseOptions: Partial<OptionsWithoutPrompt>;
  private activeQuery: Query | null = null;
  private activeAbortController: AbortController | null = null;

  constructor(id: string, config: SessionConfig, baseOptions: Partial<OptionsWithoutPrompt>) {
    this.id = id;
    this.config = config;
    this.baseOptions = baseOptions;
  }

  private buildOptions(abortController: AbortController): Options {
    const options: Options = {
      ...this.baseOptions,
      abortController,
      cwd: this.config.workspaceRoot,
    };

    if (this.config.model) {
      options.model = this.config.model;
    }
    if (this.config.systemPrompt) {
      options.systemPrompt = this.config.systemPrompt;
    }
    if (this.config.allowedTools && this.config.allowedTools.length > 0) {
      options.allowedTools = [...this.config.allowedTools];
    }
    if (this.config.permissionMode) {
      options.permissionMode = this.config.permissionMode;
    }
    if (this.config.canUseTool) {
      options.canUseTool = this.config.canUseTool;
    }
    if (this.config.includePartialMessages) {
      options.includePartialMessages = true;
    }
    if (this.config.maxTurns !== undefined) {
      options.maxTurns = this.config.maxTurns;
    }

    return options;
  }

  private static readUsage(message: SDKMessage): { inputTokens: number; outputTokens: number } | null {
    if (message.type !== 'result') {
      return null;
    }

    const usage = (message as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
    if (!usage) {
      return null;
    }

    const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;

    if (inputTokens === 0 && outputTokens === 0) {
      return null;
    }

    return { inputTokens, outputTokens };
  }

  private static readAssistantEvents(
    message: SDKMessage
  ): Array<{ type: 'text'; content: string } | { type: 'tool_use'; id: string; name: string; input: unknown }> {
    if (message.type !== 'assistant') {
      return [];
    }

    const content = (message.message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return [];
    }

    const events: Array<
      { type: 'text'; content: string } | { type: 'tool_use'; id: string; name: string; input: unknown }
    > = [];
    for (const block of content) {
      if (typeof block !== 'object' || block === null) {
        continue;
      }
      const typedBlock = block as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (typedBlock.type === 'text' && typeof typedBlock.text === 'string' && typedBlock.text.length > 0) {
        events.push({ type: 'text', content: typedBlock.text });
      } else if (typedBlock.type === 'tool_use' && typeof typedBlock.id === 'string' && typeof typedBlock.name === 'string') {
        events.push({
          type: 'tool_use',
          id: typedBlock.id,
          name: typedBlock.name,
          input: typedBlock.input ?? {},
        });
      }
    }

    return events;
  }

  private static readResultError(message: SDKMessage): string | null {
    if (message.type !== 'result' || message.subtype === 'success' || !message.is_error) {
      return null;
    }

    if (Array.isArray(message.errors) && message.errors.length > 0) {
      return message.errors.join('; ');
    }

    return `Claude Agent SDK execution failed (${message.subtype})`;
  }

  private static readAssistantError(message: SDKMessage): string | null {
    if (message.type !== 'assistant' || !message.error) {
      return null;
    }

    return `Claude Agent SDK assistant error: ${message.error}`;
  }

  async *sendMessage(message: string): AsyncGenerator<RuntimeEvent> {
    // Ensure only one active query per session.
    this.cancel();

    const controller = new AbortController();
    const currentQuery = query({
      prompt: message,
      options: this.buildOptions(controller),
    });

    this.activeAbortController = controller;
    this.activeQuery = currentQuery;

    try {
      for await (const sdkMessage of currentQuery) {
        const assistantError = ClaudeSession.readAssistantError(sdkMessage);
        if (assistantError) {
          yield { type: 'error', message: assistantError };
        }

        for (const assistantEvent of ClaudeSession.readAssistantEvents(sdkMessage)) {
          yield assistantEvent;
        }

        const usage = ClaudeSession.readUsage(sdkMessage);
        if (usage) {
          yield { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
        }

        const resultError = ClaudeSession.readResultError(sdkMessage);
        if (resultError) {
          yield { type: 'error', message: resultError };
        }
      }

      yield { type: 'done' };
    } catch (error) {
      if (controller.signal.aborted) {
        yield { type: 'error', message: 'Request was cancelled' };
      } else if (error instanceof Error) {
        yield { type: 'error', message: error.message };
      } else {
        yield { type: 'error', message: 'An unknown error occurred' };
      }

      yield { type: 'done' };
    } finally {
      if (this.activeAbortController === controller) {
        this.activeAbortController = null;
      }
      if (this.activeQuery === currentQuery) {
        this.activeQuery = null;
      }
    }
  }

  cancel(): void {
    this.activeAbortController?.abort();
    this.activeQuery?.close();
  }
}

/**
 * Adapter for Anthropic Claude Agent SDK.
 * Keeps a thin runtime surface: startup/configuration + event normalization.
 */
export class ClaudeAdapter implements AgentRuntime {
  private defaultOptions: Partial<OptionsWithoutPrompt>;

  /**
   * Create a new ClaudeAdapter instance.
   *
   * @param config.defaultOptions - Optional baseline Agent SDK options
   */
  constructor(config: { defaultOptions?: Partial<OptionsWithoutPrompt> } = {}) {
    this.defaultOptions = config.defaultOptions ?? {};
  }

  private validateSessionConfig(config: SessionConfig): void {
    if (!config.workspaceRoot) {
      throw new Error('workspaceRoot is required');
    }
    if (typeof config.workspaceRoot !== 'string') {
      throw new Error('workspaceRoot must be a string');
    }
    if (config.workspaceRoot.trim().length === 0) {
      throw new Error('workspaceRoot cannot be empty');
    }

    if (config.model !== undefined) {
      if (typeof config.model !== 'string') {
        throw new Error('model must be a string');
      }
      if (config.model.trim().length === 0) {
        throw new Error('model cannot be empty');
      }
    }

    if (config.systemPrompt !== undefined && typeof config.systemPrompt !== 'string') {
      throw new Error('systemPrompt must be a string');
    }

    if (config.allowedTools !== undefined) {
      if (!Array.isArray(config.allowedTools)) {
        throw new Error('allowedTools must be an array');
      }
      for (const toolName of config.allowedTools) {
        if (typeof toolName !== 'string' || toolName.trim().length === 0) {
          throw new Error('allowedTools entries must be non-empty strings');
        }
      }
    }

    if (config.maxTurns !== undefined) {
      if (!Number.isInteger(config.maxTurns) || config.maxTurns <= 0) {
        throw new Error('maxTurns must be a positive integer');
      }
    }

    // Legacy field validation retained for backward compatibility.
    if (config.tools !== undefined) {
      if (!Array.isArray(config.tools)) {
        throw new Error('tools must be an array');
      }
      for (const tool of config.tools) {
        if (!tool.name || typeof tool.name !== 'string') {
          throw new Error('Tool name is required and must be a string');
        }
        if (!tool.description || typeof tool.description !== 'string') {
          throw new Error(`Tool "${tool.name}" description is required and must be a string`);
        }
        if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
          throw new Error(`Tool "${tool.name}" inputSchema must be an object type`);
        }
      }
    }
  }

  async createSession(config: SessionConfig): Promise<AgentSession> {
    this.validateSessionConfig(config);
    return new ClaudeSession(generateId(), config, this.defaultOptions);
  }

  listCapabilities(): RuntimeCapabilities {
    return {
      models: [
        'claude-sonnet-4-5',
        'claude-opus-4-1',
        'claude-haiku-3-5',
      ],
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 200000,
    };
  }
}

function generateId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default ClaudeAdapter;
