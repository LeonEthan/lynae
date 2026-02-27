// Claude Runtime Adapter - Wraps Claude SDK to provide AgentRuntime interface
import Anthropic from '@anthropic-ai/sdk';

/**
 * Runtime interface for AI agent providers.
 * Abstracts away provider-specific details from the business layer.
 */
export interface AgentRuntime {
  /**
   * Create a new session with the specified configuration.
   * @param config - Session configuration including model, tools, and workspace
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
 * Maintains conversation history and provides streaming message support.
 */
export interface AgentSession {
  /** Unique identifier for this session */
  id: string;

  /**
   * Send a message and receive a streaming response.
   * @param message - The user message to send
   * @returns AsyncIterable of RuntimeEvent objects (text, tool_use, error, done)
   */
  sendMessage(message: string): AsyncIterable<RuntimeEvent>;

  /**
   * Cancel any in-progress streaming request.
   * Safe to call even when no request is active.
   */
  cancel(): void;
}

/**
 * Configuration options for creating a new session.
 */
export interface SessionConfig {
  /** Claude model identifier (e.g., 'claude-3-5-sonnet-latest') */
  model?: string;

  /** System prompt to set the AI's behavior and context */
  systemPrompt?: string;

  /** Root directory for file operations (security boundary) */
  workspaceRoot: string;

  /** Tool definitions available for the AI to use */
  tools?: ToolDefinition[];

  /** Maximum tokens to generate per response (default: 8192) */
  maxTokens?: number;

  /** Sampling temperature 0.0-1.0 (default: 0.7) */
  temperature?: number;

  /**
   * Maximum number of conversation messages to retain.
   * Older messages are removed to prevent memory leaks.
   * Default: 100 messages (50 exchanges)
   */
  maxHistoryMessages?: number;
}

/**
 * Definition of a tool that can be called by the AI.
 */
export interface ToolDefinition {
  /** Tool name used in tool_use blocks */
  name: string;

  /** Description of what the tool does */
  description: string;

  /** JSON Schema for the tool's input parameters */
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
  | { type: 'tool_result'; tool_use_id: string; output: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

/**
 * Capabilities and features supported by this runtime.
 */
export interface RuntimeCapabilities {
  /** List of available model identifiers */
  models: string[];

  /** Whether tool/function calling is supported */
  supportsTools: boolean;

  /** Whether streaming responses are supported */
  supportsStreaming: boolean;

  /** Maximum context window size in tokens */
  maxContextTokens: number;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | Array<Anthropic.Messages.ContentBlockParam>;
}

/**
 * Maximum conversation history messages before truncation.
 * Set to 100 messages (approximately 50 user/assistant exchanges).
 */
const DEFAULT_MAX_HISTORY_MESSAGES = 100;

class ClaudeSession implements AgentSession {
  id: string;
  private client: Anthropic;
  private config: SessionConfig;
  private conversationHistory: ConversationMessage[] = [];
  /** Tracks the currently active request for cancellation */
  private activeRequest: AbortController | null = null;

  constructor(
    id: string,
    client: Anthropic,
    config: SessionConfig
  ) {
    this.id = id;
    this.client = client;
    this.config = config;
  }

  /**
   * Trims conversation history to prevent unbounded memory growth.
   * Keeps the most recent messages up to maxHistoryMessages limit.
   */
  private trimConversationHistory(): void {
    const maxMessages = this.config.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;

    if (this.conversationHistory.length > maxMessages) {
      // Keep only the most recent messages
      const excessCount = this.conversationHistory.length - maxMessages;
      this.conversationHistory.splice(0, excessCount);
    }
  }

  async *sendMessage(message: string): AsyncGenerator<RuntimeEvent> {
    // Cancel any existing request to prevent race conditions
    this.activeRequest?.abort();

    // Create a new abort controller for this request
    const controller = new AbortController();
    this.activeRequest = controller;

    try {
      // Add user message to history
      this.conversationHistory.push({
        role: 'user',
        content: message,
      });

      // Trim history to prevent memory leaks
      this.trimConversationHistory();

      // Prepare tool definitions for the API
      const tools: Anthropic.Messages.ToolUnion[] | undefined = this.config.tools?.map(
        (tool): Anthropic.Messages.Tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
        })
      );

      // Start streaming
      const stream = this.client.messages.stream(
        {
          model: this.config.model ?? 'claude-3-5-sonnet-latest',
          max_tokens: this.config.maxTokens ?? 8192,
          temperature: this.config.temperature ?? 0.7,
          system: this.config.systemPrompt,
          messages: this.conversationHistory as Anthropic.Messages.MessageParam[],
          tools,
        },
        {
          signal: controller.signal,
        }
      );

      // Track accumulated content for assistant message
      const assistantContent: Anthropic.Messages.ContentBlock[] = [];
      let currentTextBlock: { type: 'text'; text: string } | null = null;
      let currentToolUseBlock: Anthropic.Messages.ToolUseBlock | null = null;
      let accumulatedJson = '';
      let inputTokens = 0;
      let outputTokens = 0;

      // The stream is an async iterable - iterate over it directly
      for await (const event of stream) {
        // Check if cancelled
        if (controller.signal.aborted) {
          throw new Error('Request cancelled');
        }

        // Handle the event based on type
        const eventType = event.type;

        if (eventType === 'message_start') {
          const startEvent = event as Anthropic.Messages.RawMessageStartEvent;
          // Capture input tokens from the initial message
          if (startEvent.message?.usage?.input_tokens) {
            inputTokens = startEvent.message.usage.input_tokens;
          }
        } else if (eventType === 'message_delta') {
          const deltaEvent = event as Anthropic.Messages.RawMessageDeltaEvent;
          // Capture output tokens from the delta (cumulative)
          if (deltaEvent.usage?.output_tokens) {
            outputTokens = deltaEvent.usage.output_tokens;
          }
        } else if (eventType === 'content_block_start') {
          const startEvent = event as Anthropic.Messages.RawContentBlockStartEvent;
          const block = startEvent.content_block;
          if (block.type === 'text') {
            currentTextBlock = { type: 'text', text: '' };
            assistantContent.push(block);
          } else if (block.type === 'tool_use') {
            currentToolUseBlock = {
              id: block.id,
              name: block.name,
              input: block.input,
              type: 'tool_use',
            };
            accumulatedJson = '';
          }
        } else if (eventType === 'content_block_delta') {
          const deltaEvent = event as Anthropic.Messages.RawContentBlockDeltaEvent;
          const delta = deltaEvent.delta;
          if (delta.type === 'text_delta' && currentTextBlock) {
            currentTextBlock.text += delta.text;
            yield { type: 'text', content: delta.text };
          } else if (delta.type === 'input_json_delta' && currentToolUseBlock) {
            accumulatedJson += delta.partial_json;
          }
        } else if (eventType === 'content_block_stop') {
          if (currentToolUseBlock) {
            // Parse the accumulated JSON for tool input
            try {
              const input = accumulatedJson ? JSON.parse(accumulatedJson) : {};
              currentToolUseBlock.input = input;
              assistantContent.push(currentToolUseBlock);
              yield {
                type: 'tool_use',
                id: currentToolUseBlock.id,
                name: currentToolUseBlock.name,
                input,
              };
            } catch (error) {
              // If JSON parsing fails, log warning with details and yield with empty input
              // This can happen if the model produces invalid JSON or the stream is interrupted
              const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
              console.warn(
                `[ClaudeSession] Failed to parse tool input JSON for tool "${currentToolUseBlock.name}" (ID: ${currentToolUseBlock.id}): ${errorMessage}. ` +
                `Raw JSON: "${accumulatedJson}". Falling back to empty input.`
              );
              currentToolUseBlock.input = {};
              assistantContent.push(currentToolUseBlock);
              yield {
                type: 'tool_use',
                id: currentToolUseBlock.id,
                name: currentToolUseBlock.name,
                input: {},
              };
            }
            currentToolUseBlock = null;
            accumulatedJson = '';
          }
          currentTextBlock = null;
        } else if (eventType === 'message_stop') {
          // Add assistant response to conversation history
          if (assistantContent.length > 0) {
            this.conversationHistory.push({
              role: 'assistant',
              content: assistantContent.map((block) => {
                if (block.type === 'text') {
                  return { type: 'text' as const, text: block.text };
                } else if (block.type === 'tool_use') {
                  return {
                    type: 'tool_use' as const,
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  };
                }
                return null;
              }).filter(Boolean) as Anthropic.Messages.ContentBlockParam[],
            });
          }
        }
      }

      // Yield token usage information if we collected any
      if (inputTokens > 0 || outputTokens > 0) {
        yield {
          type: 'usage',
          inputTokens,
          outputTokens,
        };
      }

      yield { type: 'done' };
    } catch (error) {
      // Handle different error types
      if (error instanceof Anthropic.APIError) {
        yield {
          type: 'error',
          message: `API Error (${error.status}): ${error.message}`,
        };
      } else if (error instanceof Anthropic.APIUserAbortError) {
        yield {
          type: 'error',
          message: 'Request was cancelled',
        };
      } else if (error instanceof Error) {
        if (error.message === 'Request cancelled' || error.name === 'AbortError') {
          yield {
            type: 'error',
            message: 'Request was cancelled',
          };
        } else {
          yield {
            type: 'error',
            message: error.message,
          };
        }
      } else {
        yield {
          type: 'error',
          message: 'An unknown error occurred',
        };
      }

      yield { type: 'done' };
    } finally {
      // Only clear if this is still the active request
      // (prevents race conditions with new requests)
      if (this.activeRequest === controller) {
        this.activeRequest = null;
      }
    }
  }

  /**
   * Cancel any in-progress streaming request.
   * Safe to call even when no request is active.
   */
  cancel(): void {
    this.activeRequest?.abort();
  }

  /**
   * Add a tool result to the conversation history.
   * This should be called after a tool_use event and tool execution.
   *
   * @param toolUseId - The ID from the tool_use event
   * @param output - The tool execution result (string or object)
   * @param isError - Whether the tool execution failed
   */
  addToolResult(toolUseId: string, output: unknown, isError = false): void {
    this.conversationHistory.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: typeof output === 'string' ? output : JSON.stringify(output),
          is_error: isError,
        } as Anthropic.Messages.ToolResultBlockParam,
      ],
    });

    // Trim history after adding tool result
    this.trimConversationHistory();
  }
}

/**
 * Adapter for the Anthropic Claude API.
 * Implements the AgentRuntime interface to provide a provider-agnostic
 * abstraction for the business layer.
 */
export class ClaudeAdapter implements AgentRuntime {
  private apiKey?: string;
  private baseURL?: string;

  /**
   * Create a new ClaudeAdapter instance.
   *
   * @param config - Adapter configuration
   * @param config.apiKey - Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
   * @param config.baseURL - Optional custom API base URL
   */
  constructor(config: { apiKey?: string; baseURL?: string } = {}) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
  }

  /**
   * Validates the session configuration.
   * Throws an error if required fields are missing or invalid.
   *
   * @param config - Session configuration to validate
   */
  private validateSessionConfig(config: SessionConfig): void {
    // Validate workspaceRoot
    if (!config.workspaceRoot) {
      throw new Error('workspaceRoot is required');
    }
    if (typeof config.workspaceRoot !== 'string') {
      throw new Error('workspaceRoot must be a string');
    }
    if (config.workspaceRoot.trim().length === 0) {
      throw new Error('workspaceRoot cannot be empty');
    }

    // Validate model if provided
    if (config.model !== undefined) {
      if (typeof config.model !== 'string') {
        throw new Error('model must be a string');
      }
      if (config.model.trim().length === 0) {
        throw new Error('model cannot be empty');
      }
    }

    // Validate maxTokens if provided
    if (config.maxTokens !== undefined) {
      if (typeof config.maxTokens !== 'number') {
        throw new Error('maxTokens must be a number');
      }
      if (!Number.isInteger(config.maxTokens) || config.maxTokens <= 0) {
        throw new Error('maxTokens must be a positive integer');
      }
    }

    // Validate temperature if provided
    if (config.temperature !== undefined) {
      if (typeof config.temperature !== 'number') {
        throw new Error('temperature must be a number');
      }
      if (config.temperature < 0 || config.temperature > 1) {
        throw new Error('temperature must be between 0 and 1');
      }
    }

    // Validate maxHistoryMessages if provided
    if (config.maxHistoryMessages !== undefined) {
      if (typeof config.maxHistoryMessages !== 'number') {
        throw new Error('maxHistoryMessages must be a number');
      }
      if (!Number.isInteger(config.maxHistoryMessages) || config.maxHistoryMessages < 1) {
        throw new Error('maxHistoryMessages must be a positive integer');
      }
    }

    // Validate systemPrompt if provided
    if (config.systemPrompt !== undefined) {
      if (typeof config.systemPrompt !== 'string') {
        throw new Error('systemPrompt must be a string');
      }
    }

    // Validate tools if provided
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

  /**
   * Create a new session for conversation.
   *
   * @param config - Session configuration
   * @returns A new ClaudeSession instance
   * @throws Error if config validation fails
   */
  async createSession(config: SessionConfig): Promise<AgentSession> {
    // Validate configuration before creating session
    this.validateSessionConfig(config);

    const client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      // Required for Electron renderer process where nodeIntegration may be limited
      dangerouslyAllowBrowser: true,
    });

    const session = new ClaudeSession(
      generateId(),
      client,
      config
    );

    return session;
  }

  /**
   * Get the capabilities of this runtime.
   * Includes all available Claude models and feature flags.
   *
   * @returns RuntimeCapabilities describing supported features
   */
  listCapabilities(): RuntimeCapabilities {
    return {
      models: [
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-sonnet-latest',
        'claude-3-5-haiku-20241022',
        'claude-3-5-haiku-latest',
        'claude-3-7-sonnet-20250219',
        'claude-3-7-sonnet-latest',
      ],
      supportsTools: true,
      supportsStreaming: true,
      maxContextTokens: 200000,
    };
  }
}

/**
 * Generate a unique session ID.
 * Format: session-{timestamp}-{random}
 */
function generateId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default ClaudeAdapter;
