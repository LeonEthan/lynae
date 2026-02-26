// Terminal tools - PR-08 will implement full functionality with node-pty
// Security: Commands default to deny, require allowlist + approval

import type { Tool } from '../index.js';

export interface TerminalOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const TerminalExecuteTool: Tool = {
  name: 'terminal_execute',
  description: 'Execute terminal command',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      cwd: { type: 'string', description: 'Working directory (relative to workspace)' },
      timeout: { type: 'number', description: 'Timeout in milliseconds' }
    },
    required: ['command']
  },
  async execute(input) {
    // Placeholder - PR-08 implementation with node-pty
    const { command } = input as { command: string; cwd?: string; timeout?: number };
    return {
      stdout: `Placeholder: would execute "${command}"`,
      stderr: '',
      exitCode: 0
    };
  }
};

export const TerminalStatusTool: Tool = {
  name: 'terminal_status',
  description: 'Check terminal session status',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' }
    },
    required: ['sessionId']
  },
  async execute(input) {
    const { sessionId } = input as { sessionId: string };
    return { sessionId, running: false };
  }
};

export const TerminalKillTool: Tool = {
  name: 'terminal_kill',
  description: 'Kill terminal session',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' }
    },
    required: ['sessionId']
  },
  async execute(input) {
    const { sessionId } = input as { sessionId: string };
    return { sessionId, killed: true };
  }
};
