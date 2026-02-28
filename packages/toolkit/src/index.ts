// Toolkit - Tool execution layer (file, terminal, git)
// PR-07, PR-08, PR-09 will implement full tool chains

import { FileTools } from './file/index.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  workspaceRoot: string;
  sessionId: string;
  taskId: string;
}

export interface ToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export class Toolkit {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: Record<string, Tool>): void {
    for (const tool of Object.values(tools)) {
      this.register(tool);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` };
    }

    try {
      const output = await tool.execute(input, context);
      return { success: true, output };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

/**
 * Registers all file tools with the toolkit
 */
export function registerFileTools(toolkit: Toolkit): void {
  toolkit.registerAll(FileTools);
}

// Export file tools and utilities
export * from './file/index.js';
export * from './terminal/index.js';
export * from './git/index.js';
