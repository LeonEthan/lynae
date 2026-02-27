import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AgentRuntime,
  RuntimeEvent,
  SessionConfig,
  ToolDefinition,
} from '../index.js';

// Mock APIError class
class MockAPIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'APIError';
  }
}

// Mock APIUserAbortError class
class MockAPIUserAbortError extends Error {
  constructor() {
    super('Request was aborted');
    this.name = 'APIUserAbortError';
  }
}

// Create a mock stream that implements async iterable
type StreamEvent =
  | { type: 'content_block_start'; index: number; content_block: { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_stop' }
  | { type: 'message_start'; message: { id: string; type: string; role: string; content: unknown[]; model: string; stop_reason: null; stop_sequence: null; usage: { input_tokens: number; output_tokens: number } } }
  | { type: 'message_delta'; delta: { stop_reason: string | null; stop_sequence: string | null }; usage: { output_tokens: number } };

function createMockStream(events: StreamEvent[]): { [Symbol.asyncIterator](): AsyncGenerator<StreamEvent> } {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

// Module-level variables that will be reset for each test
let mockMessages = { stream: vi.fn() };
let MockAnthropic: ReturnType<typeof Object.assign>;

// Factory function to create fresh mock instances for each test
function createMockAnthropic() {
  mockMessages = {
    stream: vi.fn(),
  };

  const mockAnthropicConstructor = vi.fn().mockImplementation(() => ({
    messages: mockMessages,
  }));

  // Add static properties to mock
  return Object.assign(mockAnthropicConstructor, {
    APIError: MockAPIError,
    APIUserAbortError: MockAPIUserAbortError,
  });
}

vi.mock('@anthropic-ai/sdk', () => ({
  get default() {
    return MockAnthropic;
  },
}));

// Type guard for text events
function isTextEvent(event: RuntimeEvent): event is { type: 'text'; content: string } {
  return event.type === 'text';
}

// Type guard for error events
function isErrorEvent(event: RuntimeEvent): event is { type: 'error'; message: string } {
  return event.type === 'error';
}

// Type guard for usage events
function isUsageEvent(event: RuntimeEvent): event is { type: 'usage'; inputTokens: number; outputTokens: number } {
  return event.type === 'usage';
}

// Import after mocking
const { ClaudeAdapter: ClaudeAdapterClass } = await import('../index.js');

describe('ClaudeAdapter', () => {
  let adapter: AgentRuntime;

  beforeEach(() => {
    // Create fresh mock instance for each test
    MockAnthropic = createMockAnthropic();
    vi.clearAllMocks();
    adapter = new ClaudeAdapterClass({ apiKey: 'test-api-key' }) as AgentRuntime;
  });

  describe('createSession', () => {
    it('should create a session with valid ID', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        model: 'claude-3-5-sonnet-latest',
      };

      const session = await adapter.createSession(config);

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.id).toMatch(/^session-\d+-[a-z0-9]+$/);
      expect(typeof session.sendMessage).toBe('function');
      expect(typeof session.cancel).toBe('function');
    });

    it('should create session with default model when not specified', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);
      expect(session).toBeDefined();
    });

    it('should create session with tools', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'read_file',
          description: 'Read a file from the filesystem',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ];

      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        tools,
      };

      const session = await adapter.createSession(config);
      expect(session).toBeDefined();
    });
  });

  describe('listCapabilities', () => {
    it('should return correct capability list', () => {
      const capabilities = adapter.listCapabilities();

      expect(capabilities.supportsTools).toBe(true);
      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.maxContextTokens).toBe(200000);
      expect(capabilities.models).toContain('claude-3-opus-20240229');
      expect(capabilities.models).toContain('claude-3-5-sonnet-latest');
      expect(capabilities.models).toContain('claude-3-7-sonnet-latest');
    });

    it('should include all expected models', () => {
      const capabilities = adapter.listCapabilities();
      const expectedModels = [
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-sonnet-latest',
        'claude-3-5-haiku-20241022',
        'claude-3-5-haiku-latest',
        'claude-3-7-sonnet-20250219',
        'claude-3-7-sonnet-latest',
      ];

      expectedModels.forEach((model) => {
        expect(capabilities.models).toContain(model);
      });
    });
  });

  describe('sendMessage streaming', () => {
    it('should yield text events in correct order', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      // Mock stream events
      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Hello')) {
        events.push(event);
      }

      expect(events).toHaveLength(4); // 3 text events + done
      expect(events[0]).toEqual({ type: 'text', content: 'Hello' });
      expect(events[1]).toEqual({ type: 'text', content: ' ' });
      expect(events[2]).toEqual({ type: 'text', content: 'world' });
      expect(events[3]).toEqual({ type: 'done' });
    });

    it('should accumulate text across multiple deltas', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'First' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Second' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Third' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      const textEvents: Array<{ type: 'text'; content: string }> = [];
      for await (const event of session.sendMessage('Test')) {
        if (isTextEvent(event)) {
          textEvents.push(event);
        }
      }

      expect(textEvents).toHaveLength(3);
      expect(textEvents[0].content).toBe('First');
      expect(textEvents[1].content).toBe('Second');
      expect(textEvents[2].content).toBe('Third');
    });

    it('should yield usage event with token counts', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      // Mock stream with usage information from message_start and message_delta events
      mockMessages.stream.mockImplementationOnce(() =>
        ({
          async *[Symbol.asyncIterator]() {
            // message_start contains input token usage
            yield {
              type: 'message_start',
              message: {
                id: 'msg_123',
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'claude-3-5-sonnet-latest',
                stop_reason: null,
                stop_sequence: null,
                usage: {
                  input_tokens: 150,
                  output_tokens: 0,
                },
              },
            };
            yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } };
            yield { type: 'content_block_stop', index: 0 };
            // message_delta contains output token usage (cumulative)
            yield {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 42 },
            };
            yield { type: 'message_stop' };
          },
        })
      );

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Hi')) {
        events.push(event);
      }

      const usageEvent = events.find(isUsageEvent);
      expect(usageEvent).toBeDefined();
      expect(usageEvent?.inputTokens).toBe(150);
      expect(usageEvent?.outputTokens).toBe(42);
    });

    it('should handle missing usage information gracefully', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      // Mock stream without usage information (no message_start with usage or message_delta)
      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Hi')) {
        events.push(event);
      }

      // Should not have a usage event but should complete normally
      const usageEvent = events.find(isUsageEvent);
      expect(usageEvent).toBeUndefined();
      expect(events.some((e) => e.type === 'done')).toBe(true);
    });
  });

  describe('tool_use handling', () => {
    it('should correctly parse and yield tool_use events', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a location',
            inputSchema: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        ],
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => createMockStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool_123', name: 'get_weather', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"location": "San Francisco"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('What is the weather?')) {
        events.push(event);
      }

      const toolUseEvent = events.find((e): e is { type: 'tool_use'; id: string; name: string; input: unknown } =>
        e.type === 'tool_use'
      );
      expect(toolUseEvent).toBeDefined();
      expect(toolUseEvent).toMatchObject({
        type: 'tool_use',
        id: 'tool_123',
        name: 'get_weather',
        input: { location: 'San Francisco' },
      });
    });

    it('should handle multiple tool_use blocks', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        tools: [
          {
            name: 'tool_a',
            description: 'Tool A',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'tool_b',
            description: 'Tool B',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => createMockStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool_1', name: 'tool_a', input: {} },
        },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tool_2', name: 'tool_b', input: {} },
        },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_stop' },
      ]));

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Use multiple tools')) {
        events.push(event);
      }

      const toolUseEvents = events.filter((e): e is { type: 'tool_use'; id: string; name: string; input: unknown } =>
        e.type === 'tool_use'
      );
      expect(toolUseEvents).toHaveLength(2);
      expect(toolUseEvents[0]).toMatchObject({ id: 'tool_1', name: 'tool_a' });
      expect(toolUseEvents[1]).toMatchObject({ id: 'tool_2', name: 'tool_b' });
    });

    it('should handle empty tool input', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        tools: [
          {
            name: 'simple_tool',
            description: 'A simple tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => createMockStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool_empty', name: 'simple_tool', input: {} },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Use tool')) {
        events.push(event);
      }

      const toolUseEvent = events.find((e): e is { type: 'tool_use'; id: string; name: string; input: unknown } =>
        e.type === 'tool_use'
      );
      expect(toolUseEvent).toBeDefined();
      expect(toolUseEvent).toMatchObject({
        type: 'tool_use',
        id: 'tool_empty',
        name: 'simple_tool',
        input: {},
      });
    });

    it('should handle invalid JSON in tool input gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };

      const session = await adapter.createSession(config);

      // Simulate invalid JSON in the tool input stream
      mockMessages.stream.mockImplementation(() => createMockStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool_invalid', name: 'test_tool', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{invalid json' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Use tool with invalid JSON')) {
        events.push(event);
      }

      // Should still yield a tool_use event with empty input
      const toolUseEvent = events.find((e): e is { type: 'tool_use'; id: string; name: string; input: unknown } =>
        e.type === 'tool_use'
      );
      expect(toolUseEvent).toBeDefined();
      expect(toolUseEvent).toMatchObject({
        type: 'tool_use',
        id: 'tool_invalid',
        name: 'test_tool',
        input: {},
      });

      // Should log a warning with details about the parse failure
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCall = consoleWarnSpy.mock.calls[0][0];
      expect(warnCall).toContain('Failed to parse tool input JSON');
      expect(warnCall).toContain('test_tool');
      expect(warnCall).toContain('tool_invalid');
      expect(warnCall).toContain('{invalid json');

      consoleWarnSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should map API errors to RuntimeEvent errors', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => {
        throw new MockAPIError(401, 'Invalid API key');
      });

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Hello')) {
        events.push(event);
      }

      const errorEvent = events.find(isErrorEvent);
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toContain('401');
      expect(errorEvent?.message).toContain('Invalid API key');

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
    });

    it('should handle rate limit errors', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => {
        throw new MockAPIError(429, 'Rate limit exceeded');
      });

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Hello')) {
        events.push(event);
      }

      const errorEvent = events.find(isErrorEvent);
      expect(errorEvent?.message).toContain('429');
    });

    it('should handle generic errors', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => {
        throw new Error('Network error');
      });

      const events: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Hello')) {
        events.push(event);
      }

      const errorEvent = events.find(isErrorEvent);
      expect(errorEvent?.message).toBe('Network error');
    });
  });

  describe('cancellation', () => {
    it('should support cancelling streaming via abort controller', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      // Create a delayed async iterator to simulate streaming
      let abortSignal: AbortSignal | undefined;
      mockMessages.stream.mockImplementation((params: unknown, options: { signal?: AbortSignal }) => {
        abortSignal = options?.signal;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } };

            // Check if aborted
            if (abortSignal?.aborted) {
              throw new Error('Request cancelled');
            }

            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } };
            yield { type: 'content_block_stop', index: 0 };
            yield { type: 'message_stop' };
          },
        };
      });

      const events: RuntimeEvent[] = [];

      // Use for await pattern instead of manual generator iteration
      let cancelled = false;
      try {
        for await (const event of session.sendMessage('Hello')) {
          events.push(event);
          // Cancel after first event
          if (!cancelled) {
            session.cancel();
            cancelled = true;
          }
        }
      } catch {
        // Expected to potentially throw or yield error
      }

      // Should have received at least one text event
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]).toEqual({ type: 'text', content: 'Hello' });
    });

    it('should handle cancel when no active request', async () => {
      // Should not throw when cancel is called without an active request
      const testAdapter = new ClaudeAdapterClass({ apiKey: 'test' });
      const session = await testAdapter.createSession({ workspaceRoot: '/test' });
      expect(() => session.cancel()).not.toThrow();
    });
  });

  describe('conversation history', () => {
    it('should maintain conversation history across messages', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      // First message - use mockImplementation to ensure isolation
      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Response 1' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      const events1: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Message 1')) {
        events1.push(event);
      }

      expect(events1.some((e) => isTextEvent(e) && e.content === 'Response 1')).toBe(true);

      // Second message - verify history is maintained by checking mock calls
      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Response 2' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      const events2: RuntimeEvent[] = [];
      for await (const event of session.sendMessage('Message 2')) {
        events2.push(event);
      }

      expect(events2.some((e) => isTextEvent(e) && e.content === 'Response 2')).toBe(true);

      // Verify that messages.stream was called with accumulated history
      const secondCall = mockMessages.stream.mock.calls[1];
      // Second call should have more messages than the first call due to conversation history
      expect(secondCall[0].messages.length).toBeGreaterThan(1);
    });
  });

  describe('configuration options', () => {
    it('should pass custom model to API', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        model: 'claude-3-opus-20240229',
        maxTokens: 4096,
        temperature: 0.5,
        systemPrompt: 'You are a helpful assistant',
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'message_stop' },
      ]));

      for await (const _ of session.sendMessage('Hello')) {
        // consume events
      }

      const callArgs = mockMessages.stream.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-3-opus-20240229');
      expect(callArgs.max_tokens).toBe(4096);
      expect(callArgs.temperature).toBe(0.5);
      expect(callArgs.system).toBe('You are a helpful assistant');
    });

    it('should use default values when not specified', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'message_stop' },
      ]));

      for await (const _ of session.sendMessage('Hello')) {
        // consume events
      }

      const callArgs = mockMessages.stream.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-3-5-sonnet-latest');
      expect(callArgs.max_tokens).toBe(8192);
      expect(callArgs.temperature).toBe(0.7);
      expect(callArgs.system).toBeUndefined();
    });
  });

  describe('ClaudeSession.addToolResult', () => {
    it('should add tool result to conversation history', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      // Cast to access internal method
      const claudeSession = session as unknown as {
        addToolResult(toolUseId: string, output: unknown, isError?: boolean): void;
      };

      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'message_stop' },
      ]));

      // Add a tool result
      claudeSession.addToolResult('tool_123', { temperature: 72 }, false);

      // Send a message and verify the tool result is included
      for await (const _ of session.sendMessage('Thanks')) {
        // consume events
      }

      const callArgs = mockMessages.stream.mock.calls[0][0];
      // Should have user message ("Thanks") and previous tool result
      expect(callArgs.messages.length).toBeGreaterThanOrEqual(1);

      // Find the tool result message
      const toolResultMessage = callArgs.messages.find(
        (m: { role: string; content: unknown }) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.some((c: { type: string }) => c.type === 'tool_result')
      );
      expect(toolResultMessage).toBeDefined();
    });
  });

  describe('conversation history trimming', () => {
    it('should trim history when exceeding maxHistoryMessages', async () => {
      // Use a small limit for testing
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        maxHistoryMessages: 4, // Allow only 4 messages (2 exchanges)
      };

      const session = await adapter.createSession(config);

      // Cast to access internal state
      const claudeSession = session as unknown as {
        sendMessage(message: string): AsyncIterable<RuntimeEvent>;
      };

      // Simulate multiple message exchanges
      for (let i = 0; i < 5; i++) {
        mockMessages.stream.mockImplementation(() => createMockStream([
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `Response ${i}` } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_stop' },
        ]));

        for await (const _ of claudeSession.sendMessage(`Message ${i}`)) {
          // consume events
        }
      }

      // Trimming happens when a user message is added, but the assistant response
      // is added after. So we can have at most maxHistoryMessages + 1 temporarily.
      // After many exchanges, the history should be bounded.
      const lastCall = mockMessages.stream.mock.calls[4];
      // Should be trimmed to at most maxHistoryMessages (4) at the start of sendMessage
      expect(lastCall[0].messages.length).toBeLessThanOrEqual(5);
      // Verify we have at least the most recent messages
      expect(lastCall[0].messages.length).toBeGreaterThanOrEqual(2);
    });

    it('should use default limit of 100 when maxHistoryMessages not specified', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        // maxHistoryMessages not specified - should use default of 100
      };

      const session = await adapter.createSession(config);

      // Cast to access internal state
      const claudeSession = session as unknown as {
        sendMessage(message: string): AsyncIterable<RuntimeEvent>;
      };

      // Simulate a few exchanges - should not be trimmed with default limit
      for (let i = 0; i < 3; i++) {
        mockMessages.stream.mockImplementation(() => createMockStream([
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `Response ${i}` } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_stop' },
        ]));

        for await (const _ of claudeSession.sendMessage(`Message ${i}`)) {
          // consume events
        }
      }

      // All 6 messages (3 user + 3 assistant) should be preserved
      const lastCall = mockMessages.stream.mock.calls[2];
      expect(lastCall[0].messages.length).toBe(6);
    });

    it('should trim history after adding tool results', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
        maxHistoryMessages: 2,
      };

      const session = await adapter.createSession(config);

      // Cast to access internal methods
      const claudeSession = session as unknown as {
        addToolResult(toolUseId: string, output: unknown, isError?: boolean): void;
        sendMessage(message: string): AsyncIterable<RuntimeEvent>;
      };

      // Add multiple tool results
      for (let i = 0; i < 5; i++) {
        claudeSession.addToolResult(`tool_${i}`, { result: i });
      }

      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'message_stop' },
      ]));

      // Send a message to trigger history check
      for await (const _ of claudeSession.sendMessage('Final message')) {
        // consume events
      }

      // History should be trimmed to at most 2 messages
      const lastCall = mockMessages.stream.mock.calls[0];
      expect(lastCall[0].messages.length).toBeLessThanOrEqual(2);
    });
  });

  describe('concurrent request handling', () => {
    it('should create new abort controller for each request', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      // Track abort signals from both requests
      const abortSignals: (AbortSignal | undefined)[] = [];

      // Use mockImplementationOnce to ensure each call gets a fresh mock
      mockMessages.stream
        .mockImplementationOnce((params: unknown, options: { signal?: AbortSignal }) => {
          abortSignals.push(options?.signal);
          return createMockStream([
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Response 1' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_stop' },
          ]);
        })
        .mockImplementationOnce((params: unknown, options: { signal?: AbortSignal }) => {
          abortSignals.push(options?.signal);
          return createMockStream([
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Response 2' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_stop' },
          ]);
        });

      // Start first request and fully consume it
      const generator1 = session.sendMessage('First message');
      const events1: RuntimeEvent[] = [];
      for await (const event of generator1) {
        events1.push(event);
      }

      // Start second request and fully consume it
      const generator2 = session.sendMessage('Second message');
      const events2: RuntimeEvent[] = [];
      for await (const event of generator2) {
        events2.push(event);
      }

      // Verify both requests received different abort signals (proper isolation)
      expect(abortSignals.length).toBe(2);
      expect(abortSignals[0]).not.toBe(abortSignals[1]);

      // Verify the first request completed (either normally or cancelled)
      expect(events1.some((e) => e.type === 'done' || (isErrorEvent(e) && e.message.includes('cancelled')))).toBe(true);

      // Second request should complete normally
      expect(events2.some((e) => e.type === 'done')).toBe(true);
    });

    it('should handle rapid cancel and sendMessage calls', async () => {
      const config: SessionConfig = {
        workspaceRoot: '/test/workspace',
      };

      const session = await adapter.createSession(config);

      mockMessages.stream.mockImplementation(() => createMockStream([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]));

      // Start a request
      const generator = session.sendMessage('Message');

      // Immediately cancel it
      session.cancel();

      // Then start another request
      const generator2 = session.sendMessage('Another message');

      // Collect events from first generator (should be cancelled or empty)
      const events1: RuntimeEvent[] = [];
      try {
        for await (const event of generator) {
          events1.push(event);
        }
      } catch {
        // Expected
      }

      // Collect events from second generator (should complete)
      const events2: RuntimeEvent[] = [];
      for await (const event of generator2) {
        events2.push(event);
      }

      // Second request should complete successfully
      expect(events2.some((e) => isTextEvent(e) && e.content === 'Hello')).toBe(true);
      expect(events2.some((e) => e.type === 'done')).toBe(true);
    });
  });
});
