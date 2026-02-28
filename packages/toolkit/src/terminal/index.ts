// Terminal tools - Full implementation with node-pty
// Security: Commands default to deny, require allowlist + approval

import type { Tool, ToolContext } from '../index.js';
import type { PolicyEngine, EvaluationResult } from '@lynae/policy-engine';
import type { ToolExecutionRepository } from '@lynae/storage';
import { TerminalSessionManager, getGlobalSessionManager } from './session.js';
import {
  CommandAllowlist,
  createDefaultAllowlist,
  validateCwd,
  validateCommand,
  parseCommand,
} from './security.js';
import { StreamingOutputHandler, TerminalOutputEvent } from './stream.js';
import { randomUUID } from 'node:crypto';

// Tool context extension for terminal
interface TerminalToolContext extends ToolContext {
  policyEngine?: PolicyEngine;
  toolExecutionRepo?: ToolExecutionRepository;
}

// Terminal constants
const TERMINAL_CONSTANTS = {
  maxConcurrency: 5,
  defaultTimeoutMs: 60000, // 1 minute
  maxTimeoutMs: 300000, // 5 minutes
  auditOutputLimit: 10000, // 10KB for audit logs
  previewOutputLimit: 2000, // 2KB for status preview
} as const;

// Terminal session manager instance
const sessionManager = getGlobalSessionManager({
  maxConcurrency: TERMINAL_CONSTANTS.maxConcurrency,
  defaultTimeoutMs: TERMINAL_CONSTANTS.defaultTimeoutMs,
  maxTimeoutMs: TERMINAL_CONSTANTS.maxTimeoutMs,
});

// Command allowlist - starts with default conservative allowlist
const commandAllowlist = createDefaultAllowlist();

// Output handlers registry for streaming
const outputHandlers = new Map<string, StreamingOutputHandler>();

// Event listener registry for cleanup (prevents memory leaks)
const outputListeners = new Map<string, (event: TerminalOutputEvent) => void>();

// Output interfaces
export interface TerminalExecuteOutput {
  sessionId: string;
  command: string;
  cwd: string;
  status: 'running' | 'denied' | 'error';
  message?: string;
  policyResult?: EvaluationResult;
}

export interface TerminalStatusOutput {
  sessionId: string;
  exists: boolean;
  command?: string;
  cwd?: string;
  status?: string;
  exitCode?: number;
  running: boolean;
  outputPreview?: string;
  startedAt?: string;
  timeoutMs?: number;
}

export interface TerminalKillOutput {
  sessionId: string;
  killed: boolean;
  wasRunning: boolean;
  message?: string;
}

export interface TerminalListOutput {
  sessions: Array<{
    sessionId: string;
    command: string;
    status: string;
    running: boolean;
    startedAt: string;
  }>;
  activeCount: number;
  maxConcurrency: number;
}

/**
 * Type guard to check if a value is a valid TerminalExecuteOutput
 */
export function isTerminalExecuteOutput(result: unknown): result is TerminalExecuteOutput {
  return (
    result !== null &&
    typeof result === 'object' &&
    'sessionId' in result &&
    typeof (result as TerminalExecuteOutput).sessionId === 'string' &&
    'command' in result &&
    typeof (result as TerminalExecuteOutput).command === 'string' &&
    'status' in result &&
    ['running', 'denied', 'error'].includes((result as TerminalExecuteOutput).status)
  );
}

/**
 * Check permission with PolicyEngine
 */
async function checkPermission(
  command: string,
  context: TerminalToolContext
): Promise<{ allowed: boolean; result?: EvaluationResult; reason?: string }> {
  if (!context.policyEngine) {
    // No policy engine available - use allowlist only
    return { allowed: true };
  }

  const result = context.policyEngine.evaluate('terminal_execute', { command });

  if (result.decision === 'deny') {
    return {
      allowed: false,
      result,
      reason: result.reason || 'Command denied by policy',
    };
  }

  if (result.decision === 'require_approval') {
    // TODO(PR-12): Implement approval queue system for commands requiring approval
    // For now, deny if approval system not fully implemented
    // In a full implementation, this would queue for approval
    // See: https://github.com/LeonEthan/lynae/issues/12
    return {
      allowed: false,
      result,
      reason: result.reason || 'Command requires approval (approval system not ready)',
    };
  }

  return { allowed: true, result };
}

/**
 * Log tool execution to repository
 */
async function logExecution(
  repo: ToolExecutionRepository | undefined,
  data: {
    id: string;
    sessionId: string;
    toolName: string;
    input: unknown;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    output?: unknown;
    error?: string;
  }
): Promise<void> {
  if (!repo) return;

  try {
    const now = new Date();
    await repo.create({
      id: data.id,
      sessionId: data.sessionId,
      toolName: data.toolName,
      input: JSON.stringify(data.input),
      output: data.output ? JSON.stringify(data.output) : undefined,
      status: data.status,
      error: data.error,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    console.error('Failed to log tool execution:', error);
  }
}

/**
 * Update tool execution log
 */
async function updateExecutionLog(
  repo: ToolExecutionRepository | undefined,
  id: string,
  data: {
    status: 'completed' | 'failed' | 'cancelled';
    output?: unknown;
    error?: string;
  }
): Promise<void> {
  if (!repo) return;

  try {
    await repo.updateStatus(id, data.status, {
      output: data.output ? JSON.stringify(data.output) : undefined,
      error: data.error,
    });
  } catch (error) {
    console.error('Failed to update tool execution log:', error);
  }
}

/**
 * terminal_execute tool - Execute a terminal command with streaming output
 */
export const TerminalExecuteTool: Tool = {
  name: 'terminal_execute',
  description: 'Execute a terminal command with streaming output. Commands must be in allowlist.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      cwd: {
        type: 'string',
        description: 'Working directory (relative to workspace)',
        default: '.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (max 5 min, default 1 min)',
      },
      env: {
        type: 'object',
        description: 'Additional environment variables',
        additionalProperties: { type: 'string' },
      },
      allowPipes: {
        type: 'boolean',
        description: 'Allow pipe operators (|)',
        default: false,
      },
      allowRedirections: {
        type: 'boolean',
        description: 'Allow redirection operators (<, >)',
        default: false,
      },
    },
    required: ['command'],
  },
  async execute(input, context: TerminalToolContext): Promise<TerminalExecuteOutput> {
    const { command, cwd = '.', timeout, env, allowPipes, allowRedirections } = input as {
      command: string;
      cwd?: string;
      timeout?: number;
      env?: Record<string, string>;
      allowPipes?: boolean;
      allowRedirections?: boolean;
    };

    const sessionId = randomUUID();

    // Step 1: Validate CWD is within workspace
    const cwdValidation = await validateCwd(cwd, context.workspaceRoot);
    if (!cwdValidation.valid) {
      await logExecution(context.toolExecutionRepo, {
        id: sessionId,
        sessionId: context.sessionId,
        toolName: 'terminal_execute',
        input: { command, cwd },
        status: 'failed',
        error: cwdValidation.reason,
      });

      return {
        sessionId,
        command,
        cwd,
        status: 'denied',
        message: `Path validation failed: ${cwdValidation.reason}`,
      };
    }

    // Step 2: Check command against allowlist and security
    const commandValidation = validateCommand(command, commandAllowlist, {
      allowPipes: allowPipes ?? false,
      allowRedirections: allowRedirections ?? false,
    });

    if (!commandValidation.allowed) {
      await logExecution(context.toolExecutionRepo, {
        id: sessionId,
        sessionId: context.sessionId,
        toolName: 'terminal_execute',
        input: { command, cwd },
        status: 'failed',
        error: commandValidation.reason,
      });

      return {
        sessionId,
        command,
        cwd,
        status: 'denied',
        message: commandValidation.reason,
      };
    }

    // Step 3: Check PolicyEngine permission
    const permissionCheck = await checkPermission(command, context);
    if (!permissionCheck.allowed) {
      await logExecution(context.toolExecutionRepo, {
        id: sessionId,
        sessionId: context.sessionId,
        toolName: 'terminal_execute',
        input: { command, cwd },
        status: 'failed',
        error: permissionCheck.reason,
      });

      return {
        sessionId,
        command,
        cwd,
        status: 'denied',
        message: permissionCheck.reason,
        policyResult: permissionCheck.result,
      };
    }

    // Step 4: Check concurrency limit
    if (!sessionManager.canCreateSession()) {
      const activeCount = sessionManager.getActiveCount();
      const message = `Maximum concurrency limit (${TERMINAL_CONSTANTS.maxConcurrency}) reached. Active sessions: ${activeCount}`;

      await logExecution(context.toolExecutionRepo, {
        id: sessionId,
        sessionId: context.sessionId,
        toolName: 'terminal_execute',
        input: { command, cwd },
        status: 'failed',
        error: message,
      });

      return {
        sessionId,
        command,
        cwd,
        status: 'error',
        message,
      };
    }

    try {
      // Create output handler for this session (before session creation to avoid race)
      const outputHandler = new StreamingOutputHandler();
      outputHandlers.set(sessionId, outputHandler);

      // Set up event forwarding (before session creation to capture all output)
      const outputListener = (event: TerminalOutputEvent) => {
        if (event.sessionId !== sessionId) return;

        switch (event.type) {
          case 'data':
            if (event.data) outputHandler.onData(sessionId, event.data);
            break;
          case 'exit':
            outputHandler.onExit(sessionId, event.exitCode ?? 0);
            // Clean up and log completion
            handleSessionEnd(sessionId, event.exitCode ?? 0, context.toolExecutionRepo);
            break;
          case 'error':
            if (event.message) outputHandler.onError(sessionId, new Error(event.message));
            break;
          case 'timeout':
            outputHandler.onTimeout(sessionId, event.timeoutMs ?? TERMINAL_CONSTANTS.defaultTimeoutMs);
            handleSessionEnd(sessionId, -1, context.toolExecutionRepo, 'timed_out');
            break;
        }
      };

      // Register listener BEFORE creating session to prevent race condition
      // where early output events are missed
      outputListeners.set(sessionId, outputListener);
      sessionManager.on('output', outputListener);

      // Step 5: Create PTY session (listener is already registered)
      await sessionManager.createSession(
        sessionId,
        command,
        cwdValidation.resolvedPath!,
        {
          timeoutMs: timeout,
          env,
        }
      );

      // Log the running execution
      await logExecution(context.toolExecutionRepo, {
        id: sessionId,
        sessionId: context.sessionId,
        toolName: 'terminal_execute',
        input: { command, cwd, timeout, env },
        status: 'running',
      });

      return {
        sessionId,
        command,
        cwd: cwdValidation.resolvedPath!,
        status: 'running',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await logExecution(context.toolExecutionRepo, {
        id: sessionId,
        sessionId: context.sessionId,
        toolName: 'terminal_execute',
        input: { command, cwd },
        status: 'failed',
        error: errorMessage,
      });

      return {
        sessionId,
        command,
        cwd,
        status: 'error',
        message: errorMessage,
      };
    }
  },
};

/**
 * Handle session end and update logs
 */
async function handleSessionEnd(
  sessionId: string,
  exitCode: number,
  repo: ToolExecutionRepository | undefined,
  forceStatus?: 'cancelled' | 'timed_out'
): Promise<void> {
  const session = sessionManager.getSession(sessionId);
  if (!session) return;

  // Clean up output handler
  outputHandlers.delete(sessionId);

  // Remove event listener to prevent memory leak
  const listener = outputListeners.get(sessionId);
  if (listener) {
    sessionManager.off('output', listener);
    outputListeners.delete(sessionId);
  }

  // Determine final status
  let status: 'completed' | 'failed' | 'cancelled';
  if (forceStatus === 'cancelled') {
    status = 'cancelled';
  } else if (forceStatus === 'timed_out') {
    status = 'failed';
  } else {
    status = exitCode === 0 ? 'completed' : 'failed';
  }

  // Update execution log
  await updateExecutionLog(repo, sessionId, {
    status,
    output: {
      exitCode,
      outputBuffer: session.outputBuffer.slice(-TERMINAL_CONSTANTS.auditOutputLimit),
      truncated: session.outputBuffer.length > TERMINAL_CONSTANTS.auditOutputLimit,
    },
  });
}

/**
 * terminal_status tool - Check running command status
 */
export const TerminalStatusTool: Tool = {
  name: 'terminal_status',
  description: 'Check status of a running or completed terminal command',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID from terminal_execute',
      },
      includeOutput: {
        type: 'boolean',
        description: 'Include output preview in response',
        default: true,
      },
    },
    required: ['sessionId'],
  },
  async execute(input): Promise<TerminalStatusOutput> {
    const { sessionId, includeOutput = true } = input as {
      sessionId: string;
      includeOutput?: boolean;
    };

    const session = sessionManager.getSession(sessionId);

    if (!session) {
      return {
        sessionId,
        exists: false,
        running: false,
      };
    }

    return {
      sessionId,
      exists: true,
      command: session.command,
      cwd: session.cwd,
      status: session.status,
      exitCode: session.exitCode,
      running: session.status === 'running',
      outputPreview: includeOutput
        ? session.outputBuffer.slice(-TERMINAL_CONSTANTS.previewOutputLimit)
        : undefined,
      startedAt: session.startedAt.toISOString(),
      timeoutMs: session.timeoutMs,
    };
  },
};

/**
 * terminal_kill tool - Cancel running command
 */
export const TerminalKillTool: Tool = {
  name: 'terminal_kill',
  description: 'Kill a running terminal command',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID to kill',
      },
      reason: {
        type: 'string',
        description: 'Reason for cancellation',
        default: 'User requested',
      },
    },
    required: ['sessionId'],
  },
  async execute(input, context: TerminalToolContext): Promise<TerminalKillOutput> {
    const { sessionId, reason = 'User requested' } = input as {
      sessionId: string;
      reason?: string;
    };

    const session = sessionManager.getSession(sessionId);

    if (!session) {
      return {
        sessionId,
        killed: false,
        wasRunning: false,
        message: 'Session not found',
      };
    }

    const wasRunning = session.status === 'running';

    if (!wasRunning) {
      return {
        sessionId,
        killed: false,
        wasRunning: false,
        message: `Session is already ${session.status}`,
      };
    }

    const success = await sessionManager.cancelSession(sessionId, reason);

    if (success) {
      // Update the execution log
      await handleSessionEnd(sessionId, -1, context.toolExecutionRepo, 'cancelled');

      return {
        sessionId,
        killed: true,
        wasRunning: true,
        message: `Session killed: ${reason}`,
      };
    }

    return {
      sessionId,
      killed: false,
      wasRunning: true,
      message: 'Failed to kill session',
    };
  },
};

/**
 * terminal_list tool - List all terminal sessions
 */
export const TerminalListTool: Tool = {
  name: 'terminal_list',
  description: 'List all terminal sessions (active and completed)',
  inputSchema: {
    type: 'object',
    properties: {
      activeOnly: {
        type: 'boolean',
        description: 'Only show active (running) sessions',
        default: false,
      },
    },
  },
  async execute(input): Promise<TerminalListOutput> {
    const { activeOnly = false } = input as { activeOnly?: boolean };

    const sessions = activeOnly
      ? sessionManager.getActiveSessions()
      : sessionManager.getAllSessions();

    return {
      sessions: sessions.map((s) => ({
        sessionId: s.id,
        command: s.command,
        status: s.status,
        running: s.status === 'running',
        startedAt: s.startedAt.toISOString(),
      })),
      activeCount: sessionManager.getActiveCount(),
      maxConcurrency: TERMINAL_CONSTANTS.maxConcurrency,
    };
  },
};

/**
 * Get the global session manager (for testing and advanced use)
 */
export function getSessionManager(): TerminalSessionManager {
  return sessionManager;
}

/**
 * Get the command allowlist (for configuration)
 */
export function getCommandAllowlist(): CommandAllowlist {
  return commandAllowlist;
}

/**
 * Reset and clear all sessions (for testing)
 */
export async function resetAllSessions(): Promise<void> {
  // Clean up all event listeners
  for (const [sessionId, listener] of outputListeners) {
    sessionManager.off('output', listener);
  }
  outputListeners.clear();
  await sessionManager.killAllSessions();
  outputHandlers.clear();
}

// Export all terminal tools
export const TerminalTools = {
  TerminalExecuteTool,
  TerminalStatusTool,
  TerminalKillTool,
  TerminalListTool,
};

// Re-export types and classes
export * from './session.js';
export * from './security.js';
export * from './stream.js';
