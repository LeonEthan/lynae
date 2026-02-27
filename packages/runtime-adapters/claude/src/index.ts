// Claude Runtime Adapter - Wraps Claude SDK to provide AgentRuntime interface
import Anthropic from '@anthropic-ai/sdk';

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
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
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

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | Array<Anthropic.Messages.ContentBlockParam>;
}

class ClaudeSession implements AgentSession {
  id: string;
  private client: Anthropic;
  private config: SessionConfig;
  private conversationHistory: ConversationMessage[] = [];
  private abortController: AbortController | null = null;

  constructor(
    id: string,
    client: Anthropic,
    config: SessionConfig
  ) {
    this.id = id;
    this.client = client;
    this.config = config;
  }

  async *sendMessage(message: string): AsyncGenerator<RuntimeEvent> {
    // Create a new abort controller for this request
    this.abortController = new AbortController();

    try {
      // Add user message to history
      this.conversationHistory.push({
        role: 'user',
        content: message,
      });

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
          signal: this.abortController.signal,
        }
      );

      // Track accumulated content for assistant message
      const assistantContent: Anthropic.Messages.ContentBlock[] = [];
      let currentTextBlock: { type: 'text'; text: string } | null = null;
      let currentToolUseBlock: Anthropic.Messages.ToolUseBlock | null = null;
      let accumulatedJson = '';

      // The stream is an async iterable - iterate over it directly
      for await (const event of stream) {
        // Check if cancelled
        if (this.abortController.signal.aborted) {
          throw new Error('Request cancelled');
        }

        // Handle the event based on type
        const eventType = event.type as string;

        if (eventType === 'content_block_start') {
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
            } catch {
              // If JSON parsing fails, yield with empty input
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
      this.abortController = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Add a tool result to the conversation history.
   * This should be called after a tool_use event and tool execution.
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
  }
}

export class ClaudeAdapter implements AgentRuntime {
  private apiKey?: string;
  private baseURL?: string;

  constructor(config: { apiKey?: string; baseURL?: string } = {}) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
  }

  async createSession(config: SessionConfig): Promise<AgentSession> {
    const client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: true, // Allow usage in Electron renderer
    });

    const session = new ClaudeSession(
      generateId(),
      client,
      config
    );

    return session;
  }

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

function generateId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export default ClaudeAdapter;
