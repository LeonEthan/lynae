import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRuntime, RuntimeEvent, SessionConfig } from '../index.js';

const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>('@anthropic-ai/claude-agent-sdk');
  return {
    ...actual,
    query: (...args: unknown[]) => mockQuery(...args),
  };
});

const { ClaudeAdapter } = await import('../index.js');

function createMockQuery(messages: SDKMessage[], opts: { error?: Error } = {}): Query & { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();

  const iterable = {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }

      if (opts.error) {
        throw opts.error;
      }
    },
  };

  return {
    ...iterable,
    close,
  } as unknown as Query & { close: ReturnType<typeof vi.fn> };
}

function createNeverEndingQuery(): Query & { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();

  const iterable = {
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {});
    },
  };

  return {
    ...iterable,
    close,
  } as unknown as Query & { close: ReturnType<typeof vi.fn> };
}

async function collectEvents(stream: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('ClaudeAdapter (thin adapter)', () => {
  let adapter: AgentRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter();
  });

  describe('createSession', () => {
    it('creates a session with generated id', async () => {
      const session = await adapter.createSession({ workspaceRoot: '/tmp/workspace' });
      expect(session.id).toMatch(/^session-\d+-[a-z0-9]+$/);
      expect(typeof session.sendMessage).toBe('function');
      expect(typeof session.cancel).toBe('function');
    });

    it('validates workspaceRoot', async () => {
      await expect(adapter.createSession({} as SessionConfig)).rejects.toThrow('workspaceRoot is required');
      await expect(adapter.createSession({ workspaceRoot: '' })).rejects.toThrow('workspaceRoot is required');
      await expect(adapter.createSession({ workspaceRoot: '   ' })).rejects.toThrow('workspaceRoot cannot be empty');
      await expect(adapter.createSession({ workspaceRoot: 123 as unknown as string })).rejects.toThrow('workspaceRoot must be a string');
    });

    it('validates optional fields', async () => {
      await expect(
        adapter.createSession({
          workspaceRoot: '/tmp/workspace',
          model: '',
        })
      ).rejects.toThrow('model cannot be empty');

      await expect(
        adapter.createSession({
          workspaceRoot: '/tmp/workspace',
          allowedTools: ['Bash', ''],
        })
      ).rejects.toThrow('allowedTools entries must be non-empty strings');

      await expect(
        adapter.createSession({
          workspaceRoot: '/tmp/workspace',
          maxTurns: 0,
        })
      ).rejects.toThrow('maxTurns must be a positive integer');
    });
  });

  describe('sendMessage', () => {
    it('passes normalized options to Agent SDK query()', async () => {
      const session = await adapter.createSession({
        workspaceRoot: '/repo',
        model: 'claude-sonnet-4-5',
        systemPrompt: 'Be concise',
        allowedTools: ['Bash', 'Read'],
        includePartialMessages: true,
        maxTurns: 3,
      });

      const sdkQuery = createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          usage: { input_tokens: 10, output_tokens: 20 },
        } as unknown as SDKMessage,
      ]);
      mockQuery.mockReturnValueOnce(sdkQuery);

      const events = await collectEvents(session.sendMessage('hello'));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith({
        prompt: 'hello',
        options: expect.objectContaining({
          cwd: '/repo',
          model: 'claude-sonnet-4-5',
          systemPrompt: 'Be concise',
          allowedTools: ['Bash', 'Read'],
          includePartialMessages: true,
          maxTurns: 3,
        }),
      });

      expect(events).toEqual([
        { type: 'usage', inputTokens: 10, outputTokens: 20 },
        { type: 'done' },
      ]);
    });

    it('maps assistant text/tool_use blocks and result usage', async () => {
      const session = await adapter.createSession({ workspaceRoot: '/repo' });
      mockQuery.mockReturnValueOnce(
        createMockQuery([
          {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'hello ' },
                { type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'ls' } },
                { type: 'text', text: 'world' },
              ],
            },
            parent_tool_use_id: null,
            uuid: 'a1',
            session_id: 's1',
          } as unknown as SDKMessage,
          {
            type: 'result',
            subtype: 'success',
            is_error: false,
            usage: { input_tokens: 11, output_tokens: 22 },
          } as unknown as SDKMessage,
        ])
      );

      const events = await collectEvents(session.sendMessage('run'));

      expect(events).toEqual([
        { type: 'text', content: 'hello ' },
        { type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'ls' } },
        { type: 'text', content: 'world' },
        { type: 'usage', inputTokens: 11, outputTokens: 22 },
        { type: 'done' },
      ]);
    });

    it('maps assistant error and result error into runtime errors', async () => {
      const session = await adapter.createSession({ workspaceRoot: '/repo' });
      mockQuery.mockReturnValueOnce(
        createMockQuery([
          {
            type: 'assistant',
            message: { content: [] },
            parent_tool_use_id: null,
            error: 'rate_limit',
          } as unknown as SDKMessage,
          {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            errors: ['permission denied', 'timeout'],
          } as unknown as SDKMessage,
        ])
      );

      const events = await collectEvents(session.sendMessage('run'));

      expect(events).toEqual([
        { type: 'error', message: 'Claude Agent SDK assistant error: rate_limit' },
        { type: 'error', message: 'permission denied; timeout' },
        { type: 'done' },
      ]);
    });

    it('maps thrown errors into runtime error event', async () => {
      const session = await adapter.createSession({ workspaceRoot: '/repo' });
      mockQuery.mockReturnValueOnce(createMockQuery([], { error: new Error('boom') }));

      const events = await collectEvents(session.sendMessage('run'));

      expect(events).toEqual([
        { type: 'error', message: 'boom' },
        { type: 'done' },
      ]);
    });

    it('cancels previous active query when a new turn starts', async () => {
      const session = await adapter.createSession({ workspaceRoot: '/repo' });

      const firstQuery = createNeverEndingQuery();
      const secondQuery = createMockQuery([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as SDKMessage,
      ]);

      mockQuery
        .mockReturnValueOnce(firstQuery)
        .mockReturnValueOnce(secondQuery);

      const firstTurn = session.sendMessage('first');
      void firstTurn[Symbol.asyncIterator]().next();

      const secondEvents = await collectEvents(session.sendMessage('second'));

      expect(firstQuery.close).toHaveBeenCalledTimes(1);
      expect(secondEvents).toEqual([
        { type: 'usage', inputTokens: 1, outputTokens: 1 },
        { type: 'done' },
      ]);
    });

    it('cancel() closes active query', async () => {
      const session = await adapter.createSession({ workspaceRoot: '/repo' });
      const firstQuery = createNeverEndingQuery();
      mockQuery.mockReturnValueOnce(firstQuery);

      const stream = session.sendMessage('long-running');
      void stream[Symbol.asyncIterator]().next();

      session.cancel();

      expect(firstQuery.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('listCapabilities', () => {
    it('returns capabilities in normalized shape', () => {
      const capabilities = adapter.listCapabilities();

      expect(capabilities.supportsTools).toBe(true);
      expect(capabilities.supportsStreaming).toBe(true);
      expect(capabilities.maxContextTokens).toBeGreaterThan(0);
      expect(capabilities.models.length).toBeGreaterThan(0);
    });
  });
});
