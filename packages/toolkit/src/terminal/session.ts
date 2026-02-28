// Terminal Session Manager - Manages active PTY sessions with concurrency limits

import { spawn, IPty } from 'node-pty';
import { EventEmitter } from 'node:events';

export type TerminalSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';

// Buffer management constants
const OUTPUT_BUFFER_MAX_SIZE = 1024 * 1024; // 1MB
const KILL_GRACE_PERIOD_MS = 5000; // 5 seconds between SIGTERM and SIGKILL
const MIN_TIMEOUT_MS = 1000; // Minimum allowed timeout

export interface TerminalSession {
  id: string;
  pty: IPty;
  command: string;
  cwd: string;
  startedAt: Date;
  timeoutMs: number;
  timeoutId?: NodeJS.Timeout;
  status: TerminalSessionStatus;
  exitCode?: number;
  outputBuffer: string;
  env: Record<string, string>;
  // Internal: output buffer chunks for efficient accumulation
  _outputChunks?: string[];
  _outputSize?: number;
  _outputTruncated?: boolean;
}

export interface SessionManagerConfig {
  maxConcurrency: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionManagerConfig = {
  maxConcurrency: 5,
  defaultTimeoutMs: 60000, // 1 minute
  maxTimeoutMs: 300000, // 5 minutes
};

export interface SessionOutputEvent {
  type: 'data' | 'exit' | 'error' | 'timeout';
  sessionId: string;
  data?: string;
  exitCode?: number;
  message?: string;
}

export class TerminalSessionManager extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();
  private config: SessionManagerConfig;

  constructor(config?: Partial<SessionManagerConfig>) {
    super();
    this.config = {
      ...DEFAULT_SESSION_CONFIG,
      ...config,
    };
  }

  /**
   * Get current number of active (running) sessions
   */
  getActiveCount(): number {
    return Array.from(this.sessions.values()).filter((s) => s.status === 'running').length;
  }

  /**
   * Check if concurrency limit would be exceeded
   */
  canCreateSession(): boolean {
    return this.getActiveCount() < this.config.maxConcurrency;
  }

  /**
   * Create a new PTY session with concurrency check
   */
  async createSession(
    sessionId: string,
    command: string,
    cwd: string,
    options?: { timeoutMs?: number; env?: Record<string, string> }
  ): Promise<TerminalSession> {
    // Check concurrency limit
    if (!this.canCreateSession()) {
      throw new Error(
        `Maximum concurrency limit (${this.config.maxConcurrency}) reached. ` +
          `Active sessions: ${this.getActiveCount()}`
      );
    }

    // Validate and cap timeout
    let timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs;
    if (timeoutMs > this.config.maxTimeoutMs) {
      timeoutMs = this.config.maxTimeoutMs;
    }
    if (timeoutMs < MIN_TIMEOUT_MS) {
      throw new Error(`Timeout must be at least ${MIN_TIMEOUT_MS}ms`);
    }

    // Merge environment variables
    const env = {
      ...process.env,
      ...options?.env,
    };

    // Spawn the PTY
    // Use the user's shell by default, passing the command with -c flag
    const shell = process.env.SHELL || '/bin/bash';
    const pty = spawn(shell, ['-c', command], {
      name: 'xterm-color',
      cwd,
      env,
      cols: 80,
      rows: 30,
    });

    const session: TerminalSession = {
      id: sessionId,
      pty,
      command,
      cwd,
      startedAt: new Date(),
      timeoutMs,
      status: 'running',
      outputBuffer: '',
      env: options?.env ?? {},
    };

    // Set up timeout
    session.timeoutId = setTimeout(() => {
      this.handleTimeout(sessionId);
    }, timeoutMs);

    // Set up event handlers
    // Use an array of chunks for O(1) append, periodically joined for memory efficiency
    const TRUNCATION_MESSAGE = '\n[...output truncated due to size limit...]\n';
    session._outputChunks = [];
    session._outputSize = 0;
    session._outputTruncated = false;

    const flushBuffer = () => {
      const chunks = session._outputChunks!;
      if (chunks.length > 1) {
        session.outputBuffer = chunks.join('');
        chunks.length = 0;
        chunks.push(session.outputBuffer);
      }
    };

    pty.onData((data) => {
      if (session._outputTruncated) {
        // Still emit data for streaming, but don't accumulate
        this.emit('output', {
          type: 'data',
          sessionId,
          data,
        } as SessionOutputEvent);
        return;
      }

      // Check if adding this chunk would exceed the limit
      const newSize = session._outputSize! + data.length;

      if (newSize > OUTPUT_BUFFER_MAX_SIZE) {
        // Calculate how much of the new data we can keep
        const keepSize = Math.max(0, OUTPUT_BUFFER_MAX_SIZE - session._outputSize!);
        if (keepSize > 0) {
          session._outputChunks!.push(data.slice(0, keepSize));
          session._outputSize! += keepSize;
        }
        // Mark as truncated
        session._outputChunks!.push(TRUNCATION_MESSAGE);
        session._outputTruncated = true;
        flushBuffer();
      } else {
        session._outputChunks!.push(data);
        session._outputSize = newSize;
        // Periodically flush to prevent excessive array growth (every 100 chunks)
        if (session._outputChunks!.length > 100) {
          flushBuffer();
        }
      }

      this.emit('output', {
        type: 'data',
        sessionId,
        data,
      } as SessionOutputEvent);
    });

    pty.onExit(({ exitCode, signal }) => {
      this.handleExit(sessionId, exitCode, signal);
    });

    this.sessions.set(sessionId, session);
    this.emit('sessionCreated', { sessionId, command, cwd });

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all sessions (both active and completed)
   */
  getAllSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * List only active (running) sessions
   */
  getActiveSessions(): TerminalSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === 'running');
  }

  /**
   * Gracefully kill a PTY process with SIGTERM, then SIGKILL after grace period
   */
  private gracefulKill(pty: IPty): void {
    try {
      pty.kill('SIGTERM');
    } catch {
      // Process may already be dead
      return;
    }

    // Give it time to terminate gracefully, then force kill
    setTimeout(() => {
      try {
        pty.kill('SIGKILL');
      } catch {
        // Process may already be dead
      }
    }, KILL_GRACE_PERIOD_MS);
  }

  /**
   * Cancel/kill a running session
   */
  async cancelSession(sessionId: string, reason: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.status !== 'running') {
      return false;
    }

    // Clear timeout
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = undefined;
    }

    // Kill the PTY process
    this.gracefulKill(session.pty);

    session.status = 'cancelled';
    this.emit('output', {
      type: 'error',
      sessionId,
      message: `Session cancelled: ${reason}`,
    } as SessionOutputEvent);

    this.emit('sessionEnded', { sessionId, status: 'cancelled', reason });

    return true;
  }

  /**
   * Handle session timeout
   */
  private handleTimeout(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') {
      return;
    }

    // Kill the process
    this.gracefulKill(session.pty);

    session.status = 'timed_out';
    this.emit('output', {
      type: 'timeout',
      sessionId,
      message: `Command timed out after ${session.timeoutMs}ms`,
    } as SessionOutputEvent);

    this.emit('sessionEnded', {
      sessionId,
      status: 'timed_out',
      timeoutMs: session.timeoutMs,
    });
  }

  /**
   * Handle process exit
   */
  private handleExit(sessionId: string, exitCode: number, signal?: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Clear timeout if still active
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
      session.timeoutId = undefined;
    }

    // Flush any remaining output chunks to the buffer
    if (session._outputChunks && session._outputChunks.length > 1) {
      session.outputBuffer = session._outputChunks.join('');
    }

    // Only update status if still running (not already cancelled/timed out)
    if (session.status === 'running') {
      session.status = exitCode === 0 ? 'completed' : 'failed';
      session.exitCode = exitCode;
    }

    this.emit('output', {
      type: 'exit',
      sessionId,
      exitCode,
      message: signal ? `Process exited with signal ${signal}` : undefined,
    } as SessionOutputEvent);

    this.emit('sessionEnded', { sessionId, status: session.status, exitCode, signal });
  }

  /**
   * Clean up completed session from memory
   */
  cleanupSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Only allow cleanup of non-running sessions
    if (session.status === 'running') {
      return false;
    }

    // Clear timeout if still active
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }

    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Clean up all completed sessions
   */
  cleanupCompletedSessions(): number {
    let count = 0;
    for (const [sessionId, session] of this.sessions) {
      if (session.status !== 'running') {
        this.cleanupSession(sessionId);
        count++;
      }
    }
    return count;
  }

  /**
   * Force kill all running sessions (for shutdown)
   */
  async killAllSessions(): Promise<void> {
    const promises = Array.from(this.sessions.values())
      .filter((s) => s.status === 'running')
      .map((s) => this.cancelSession(s.id, 'Manager shutting down'));

    await Promise.all(promises);
  }

  /**
   * Get session output buffer
   */
  getOutput(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.outputBuffer;
  }

  /**
   * Write data to a running session's PTY (for interactive sessions)
   */
  writeToSession(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') {
      return false;
    }

    session.pty.write(data);
    return true;
  }

  /**
   * Resize a running session's PTY
   */
  resizeSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') {
      return false;
    }

    session.pty.resize(cols, rows);
    return true;
  }
}

/**
 * Singleton session manager instance
 */
let globalSessionManager: TerminalSessionManager | undefined;

export function getGlobalSessionManager(
  config?: Partial<SessionManagerConfig>
): TerminalSessionManager {
  if (!globalSessionManager) {
    globalSessionManager = new TerminalSessionManager(config);
  }
  return globalSessionManager;
}

export function resetGlobalSessionManager(): void {
  globalSessionManager = undefined;
}
