// Streaming Output Handler - Handles streaming output from PTY to consumers

import { EventEmitter } from 'node:events';

export interface TerminalOutputEvent {
  type: 'data' | 'exit' | 'error' | 'timeout';
  sessionId: string;
  data?: string;
  exitCode?: number;
  message?: string;
  timeoutMs?: number; // Present for timeout events
}

export type OutputHandler = (event: TerminalOutputEvent) => void;

export interface StreamingOutputHandlerOptions {
  maxBufferSize?: number;
  emitPartialLines?: boolean;
}

export class StreamingOutputHandler extends EventEmitter {
  private buffers: Map<string, string> = new Map();
  private maxBufferSize: number;
  private emitPartialLines: boolean;

  constructor(options?: StreamingOutputHandlerOptions) {
    super();
    this.maxBufferSize = options?.maxBufferSize ?? 1024 * 1024; // 1MB default
    this.emitPartialLines = options?.emitPartialLines ?? true;
  }

  /**
   * Called when PTY outputs data
   */
  onData(sessionId: string, data: string): void {
    let buffer = this.buffers.get(sessionId) ?? '';
    buffer += data;

    // Check buffer size limit
    if (buffer.length > this.maxBufferSize) {
      // Truncate from beginning, keep the end
      const excess = buffer.length - this.maxBufferSize;
      buffer =
        `[...${excess} characters truncated...]\n` +
        buffer.slice(-this.maxBufferSize);
    }

    this.buffers.set(sessionId, buffer);

    // Emit the event
    this.emit('output', {
      type: 'data',
      sessionId,
      data,
    } as TerminalOutputEvent);

    // Also emit line-by-line if requested
    if (this.emitPartialLines) {
      this.emitLineEvents(sessionId, data);
    }
  }

  /**
   * Emit individual line events for real-time processing
   */
  private emitLineEvents(sessionId: string, data: string): void {
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        this.emit('line', {
          sessionId,
          line: line.trim(),
        });
      }
    }
  }

  /**
   * Called when process exits
   */
  onExit(sessionId: string, exitCode: number): void {
    this.emit('output', {
      type: 'exit',
      sessionId,
      exitCode,
    } as TerminalOutputEvent);

    this.emit('sessionEnd', {
      sessionId,
      exitCode,
    });
  }

  /**
   * Called on error
   */
  onError(sessionId: string, error: Error): void {
    this.emit('output', {
      type: 'error',
      sessionId,
      message: error.message,
    } as TerminalOutputEvent);

    this.emit('error', {
      sessionId,
      error,
    });
  }

  /**
   * Called on timeout
   */
  onTimeout(sessionId: string, timeoutMs: number): void {
    this.emit('output', {
      type: 'timeout',
      sessionId,
      message: `Command timed out after ${timeoutMs}ms`,
    } as TerminalOutputEvent);
  }

  /**
   * Get buffered output for a session
   */
  getBuffer(sessionId: string): string {
    return this.buffers.get(sessionId) ?? '';
  }

  /**
   * Clear buffer for a session
   */
  clearBuffer(sessionId: string): void {
    this.buffers.delete(sessionId);
  }

  /**
   * Clear all buffers
   */
  clearAllBuffers(): void {
    this.buffers.clear();
  }

  /**
   * Get buffer size for a session
   */
  getBufferSize(sessionId: string): number {
    return this.buffers.get(sessionId)?.length ?? 0;
  }

  /**
   * Check if a session has buffered output
   */
  hasBuffer(sessionId: string): boolean {
    return this.buffers.has(sessionId);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Clean up resources for a session
   */
  cleanup(sessionId: string): void {
    this.clearBuffer(sessionId);
  }
}

/**
 * Create a callback-style output handler
 * Useful for simple use cases where you just want a callback
 */
export function createOutputHandler(
  onOutput: (sessionId: string, data: string) => void,
  onExit?: (sessionId: string, exitCode: number) => void,
  onError?: (sessionId: string, error: Error) => void
): StreamingOutputHandler {
  const handler = new StreamingOutputHandler();

  handler.on('output', (event: TerminalOutputEvent) => {
    switch (event.type) {
      case 'data':
        if (event.data) {
          onOutput(event.sessionId, event.data);
        }
        break;
      case 'exit':
        onExit?.(event.sessionId, event.exitCode ?? 0);
        break;
      case 'error':
        if (event.message) {
          onError?.(event.sessionId, new Error(event.message));
        }
        break;
    }
  });

  return handler;
}

/**
 * Collect all output from a session into a single string
 * Useful for commands that need complete output
 */
export async function collectOutput(
  sessionManager: {
    on: (event: string, handler: (event: TerminalOutputEvent) => void) => void;
    off: (event: string, handler: (event: TerminalOutputEvent) => void) => void;
  },
  sessionId: string,
  options?: {
    timeoutMs?: number;
    maxSize?: number;
  }
): Promise<{
  output: string;
  exitCode?: number;
  timedOut: boolean;
  truncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let exitCode: number | undefined;
    let completed = false;
    let truncated = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      sessionManager.off('output', onOutput);
    };

    const timeoutId = options?.timeoutMs
      ? setTimeout(() => {
          if (!completed) {
            completed = true;
            cleanup();
            resolve({
              output: chunks.join(''),
              exitCode,
              timedOut: true,
              truncated,
            });
          }
        }, options.timeoutMs)
      : null;

    // Track running size for O(1) updates instead of O(n) reduction
    let currentSize = 0;

    const onOutput = (event: TerminalOutputEvent) => {
      if (event.sessionId !== sessionId) return;

      switch (event.type) {
        case 'data':
          if (event.data) {
            chunks.push(event.data);
            currentSize += event.data.length;

            // Check max size and remove oldest chunks if exceeded
            if (options?.maxSize && currentSize > options.maxSize) {
              truncated = true;
              // Remove oldest chunks to stay under limit
              while (chunks.length > 1 && currentSize > options.maxSize) {
                const removed = chunks.shift()!;
                currentSize -= removed.length;
              }
            }
          }
          break;

        case 'exit':
          exitCode = event.exitCode;
          if (!completed) {
            completed = true;
            cleanup();
            resolve({
              output: chunks.join(''),
              exitCode,
              timedOut: false,
              truncated,
            });
          }
          break;

        case 'error':
          if (!completed) {
            completed = true;
            cleanup();
            reject(new Error(event.message || 'Unknown error'));
          }
          break;

        case 'timeout':
          if (!completed) {
            completed = true;
            cleanup();
            resolve({
              output: chunks.join(''),
              exitCode,
              timedOut: true,
              truncated,
            });
          }
          break;
      }
    };

    sessionManager.on('output', onOutput);
  });
}
