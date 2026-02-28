// Command Allowlist Security - Default-deny with allowlist checking for commands

import path from 'node:path';
import { validatePath, PathValidationResult } from '../file/security.js';

export interface AllowlistEntry {
  pattern: string | RegExp;
  description: string;
  allowedArgs?: (string | RegExp)[];
}

export interface CommandValidationResult {
  allowed: boolean;
  reason?: string;
  matchedEntry?: AllowlistEntry;
}

export class CommandAllowlist {
  private entries: AllowlistEntry[] = [];

  /**
   * Add pattern to allowlist
   */
  addEntry(entry: AllowlistEntry): void {
    this.entries.push(entry);
  }

  /**
   * Remove all entries from allowlist
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get all entries
   */
  getEntries(): AllowlistEntry[] {
    return [...this.entries];
  }

  /**
   * Check if command is allowed
   */
  validate(command: string): CommandValidationResult {
    if (!command || command.trim() === '') {
      return { allowed: false, reason: 'Command cannot be empty' };
    }

    // Normalize command (trim whitespace)
    const normalizedCommand = command.trim();

    for (const entry of this.entries) {
      if (this.matchesPattern(normalizedCommand, entry.pattern)) {
        // If allowedArgs is specified (including empty array), validate arguments
        if (entry.allowedArgs !== undefined) {
          const argsValidation = this.validateArgs(normalizedCommand, entry.allowedArgs);
          if (!argsValidation.valid) {
            return {
              allowed: false,
              reason: argsValidation.reason,
            };
          }
        }

        return {
          allowed: true,
          matchedEntry: entry,
        };
      }
    }

    return {
      allowed: false,
      reason: `Command "${command}" not in allowlist. Add a matching pattern to allow this command.`,
    };
  }

  /**
   * Load allowlist from configuration
   */
  loadFromConfig(config: { patterns: Array<{ pattern: string; description: string; regex?: boolean }> }): void {
    this.clear();
    for (const item of config.patterns) {
      this.addEntry({
        pattern: item.regex ? new RegExp(item.pattern) : item.pattern,
        description: item.description,
      });
    }
  }

  /**
   * Check if a command matches a pattern
   */
  private matchesPattern(command: string, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      // String pattern - check for exact match or prefix match
      return command === pattern || command.startsWith(pattern + ' ');
    } else {
      // RegExp pattern
      return pattern.test(command);
    }
  }

  /**
   * Validate command arguments against allowed args
   */
  private validateArgs(
    command: string,
    allowedArgs: (string | RegExp)[]
  ): { valid: boolean; reason?: string } {
    // Extract arguments from command (everything after first space)
    const spaceIndex = command.indexOf(' ');
    if (spaceIndex === -1) {
      // No arguments - check if that's allowed
      // If allowedArgs is explicitly empty array, no args are allowed (but none provided, so valid)
      return { valid: true };
    }

    const args = command.slice(spaceIndex + 1).trim();

    // If allowedArgs is explicitly empty, no arguments are allowed
    if (allowedArgs.length === 0) {
      return {
        valid: false,
        reason: `Arguments "${args}" not allowed for this command (no arguments permitted)`,
      };
    }

    // Check if any allowedArg pattern matches
    for (const allowedArg of allowedArgs) {
      if (typeof allowedArg === 'string') {
        if (args === allowedArg || args.startsWith(allowedArg + ' ')) {
          return { valid: true };
        }
      } else {
        if (allowedArg.test(args)) {
          return { valid: true };
        }
      }
    }

    return {
      valid: false,
      reason: `Arguments "${args}" not allowed for this command`,
    };
  }
}

// Default conservative allowlist for common safe commands
export const DEFAULT_ALLOWLIST: AllowlistEntry[] = [
  {
    pattern: /^npm\s+(install|ci|run\s+\w+|test|build|lint|format|audit)(\s+--\S+)*/,
    description: 'npm package management commands',
  },
  {
    pattern: /^pnpm\s+(install|run\s+\w+|test|build|lint|format|audit)(\s+--\S+)*/,
    description: 'pnpm package management commands',
  },
  {
    pattern: /^yarn\s+(install|run\s+\w+|test|build|lint|format|audit)(\s+--\S+)*/,
    description: 'yarn package management commands',
  },
  {
    pattern: /^git\s+(status|log|diff|show|branch|remote|config\s+--list)(\s+-?\S+)*/,
    description: 'git read-only commands',
  },
  {
    pattern: /^git\s+(add|commit|checkout|switch|merge|rebase|stash|tag|fetch|pull)(\s+-?\S+)*/,
    description: 'git write commands (use with caution)',
  },
  {
    pattern: /^ls\s+/,
    description: 'list directory contents',
  },
  {
    pattern: /^cat\s+/,
    description: 'display file contents',
  },
  {
    pattern: /^echo\s+/,
    description: 'print text',
  },
  {
    pattern: /^pwd$/,
    description: 'print working directory',
  },
  {
    pattern: /^which\s+/,
    description: 'locate a command',
  },
  {
    pattern: /^grep\s+/,
    description: 'search text patterns',
  },
  {
    pattern: /^find\s+/,
    description: 'find files and directories',
  },
  {
    pattern: /^wc\s+/,
    description: 'word count',
  },
  {
    pattern: /^head\s+/,
    description: 'output first part of files',
  },
  {
    pattern: /^tail\s+/,
    description: 'output last part of files',
  },
  {
    pattern: /^mkdir\s+/,
    description: 'make directories',
  },
  {
    pattern: /^touch\s+/,
    description: 'create empty files or update timestamps',
  },
  {
    pattern: /^rm\s+/, // Note: This is potentially dangerous, requires approval
    description: 'remove files/directories (high risk)',
  },
  {
    pattern: /^cp\s+/,
    description: 'copy files/directories',
  },
  {
    pattern: /^mv\s+/,
    description: 'move/rename files/directories',
  },
  {
    pattern: /^node\s+/,
    description: 'execute node.js scripts',
  },
  {
    pattern: /^npx\s+/,
    description: 'execute npm packages',
  },
  {
    pattern: /^tsx?\s+/,
    description: 'execute TypeScript files',
  },
  {
    pattern: /^vitest\s+/,
    description: 'run vitest tests',
  },
  {
    pattern: /^jest\s+/,
    description: 'run jest tests',
  },
  {
    pattern: /^tsc\s+/,
    description: 'TypeScript compiler',
  },
  {
    pattern: /^eslint\s+/,
    description: 'ESLint linter',
  },
  {
    pattern: /^prettier\s+/,
    description: 'Prettier formatter',
  },
  {
    pattern: /^docker\s+(ps|images|info|version|inspect|logs)(\s+\S+)*/,
    description: 'docker read-only commands',
  },
  {
    pattern: /^curl\s+/, // Note: Network access, requires consideration
    description: 'transfer data from URLs (network access)',
  },
  {
    pattern: /^wget\s+/, // Note: Network access, requires consideration
    description: 'download files (network access)',
  },
];

/**
 * Validate working directory is within workspace
 */
export async function validateCwd(
  cwd: string,
  workspaceRoot: string
): Promise<{ valid: boolean; resolvedPath?: string; reason?: string }> {
  // Handle relative path - resolve against workspace root
  const result: PathValidationResult = await validatePath(cwd, workspaceRoot);

  if (!result.valid) {
    return {
      valid: false,
      reason: result.reason,
    };
  }

  // Additional check: ensure the path is actually a directory (or can be one)
  // For terminal execution, we just need to ensure it's within workspace
  // The actual existence check will be done by the shell

  return {
    valid: true,
    resolvedPath: result.resolvedPath,
  };
}

/**
 * Parse a command to detect potential shell injection
 * Returns parsed command info or null if potentially dangerous
 */
export function parseCommand(command: string): {
  baseCommand: string;
  args: string[];
  hasPipes: boolean;
  hasRedirections: boolean;
  hasCommandSubstitution: boolean;
  hasBackground: boolean;
} {
  const trimmed = command.trim();

  // Check for shell features
  const hasPipes = trimmed.includes('|');
  const hasRedirections = trimmed.includes('>') || trimmed.includes('<');
  const hasCommandSubstitution = trimmed.includes('$(') || trimmed.includes('`');
  const hasBackground = trimmed.endsWith('&') || trimmed.includes(' & ');

  // Extract base command (first word before any special characters)
  // This is a simplified parser - complex shell syntax may not be fully parsed
  const firstSpecialChar = trimmed.search(/[|;<>\&$`]/);
  const commandPart = firstSpecialChar === -1 ? trimmed : trimmed.slice(0, firstSpecialChar);
  const parts = commandPart.trim().split(/\s+/);
  const baseCommand = parts[0] || '';

  // Extract arguments (simplified - doesn't handle quoted strings properly)
  const args = parts.slice(1).filter((arg) => arg.length > 0);

  return {
    baseCommand,
    args,
    hasPipes,
    hasRedirections,
    hasCommandSubstitution,
    hasBackground,
  };
}

/**
 * Check for shell injection attempts
 * Returns null if safe, or a reason string if potentially dangerous
 *
 * SECURITY NOTE: This uses pattern matching which can be bypassed.
 * This is defense-in-depth; the primary security is the allowlist.
 */
export function detectShellInjection(command: string): string | null {
  // Check for common injection patterns
  // Patterns use \s* to catch variations with/without whitespace
  const dangerousPatterns = [
    // rm -rf / patterns (various forms)
    { pattern: /;\s*rm\s+-rf\s+\//, reason: 'Dangerous rm -rf / pattern detected' },
    { pattern: /&&\s*rm\s+-rf\s+\//, reason: 'Dangerous rm -rf / pattern detected' },
    { pattern: /\|\s*rm\s+-rf\s+\//, reason: 'Dangerous rm -rf / pattern detected' },

    // Piping curl/wget to shell (various whitespace patterns)
    { pattern: /curl\s+[^|]*\|\s*sh/, reason: 'Piping curl to shell is dangerous' },
    { pattern: /curl\s+[^|]*\|\s*bash/, reason: 'Piping curl to bash is dangerous' },
    { pattern: /wget\s+[^|]*\|\s*sh/, reason: 'Piping wget to shell is dangerous' },
    { pattern: /wget\s+[^|]*\|\s*bash/, reason: 'Piping wget to bash is dangerous' },

    // Command substitution with dangerous commands
    { pattern: /\$\(\s*rm\s+-rf/, reason: 'Command substitution with rm detected' },
    { pattern: /`rm\s+-rf/, reason: 'Backtick substitution with rm detected' },
    { pattern: /\$\(\s*curl\s+.*\|\s*sh/, reason: 'Command substitution with curl|sh detected' },
    { pattern: /`curl\s+.*\|\s*sh/, reason: 'Backtick substitution with curl|sh detected' },

    // Fork bomb and other denial of service patterns
    { pattern: /:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}[^;]*;/, reason: 'Fork bomb detected' },
    { pattern: /:\(\):\{:\|:\}&/, reason: 'Fork bomb detected' },

    // Suspicious eval/exec patterns
    { pattern: /eval\s*\$\(/, reason: 'Eval with command substitution detected' },
    { pattern: /eval\s*`/, reason: 'Eval with backtick substitution detected' },
  ];

  for (const { pattern, reason } of dangerousPatterns) {
    if (pattern.test(command)) {
      return reason;
    }
  }

  return null;
}

/**
 * Comprehensive command validation
 * Combines allowlist, shell injection detection, and parsing
 */
export function validateCommand(
  command: string,
  allowlist: CommandAllowlist,
  options?: {
    allowPipes?: boolean;
    allowRedirections?: boolean;
    allowCommandSubstitution?: boolean;
    allowBackground?: boolean;
  }
): CommandValidationResult & {
  parsed?: ReturnType<typeof parseCommand>;
  injectionWarning?: string;
} {
  // Check for shell injection first
  const injectionWarning = detectShellInjection(command);
  if (injectionWarning) {
    return {
      allowed: false,
      reason: `Security violation: ${injectionWarning}`,
      injectionWarning,
    };
  }

  // Parse command to understand its structure
  const parsed = parseCommand(command);

  // Check shell feature restrictions
  if (parsed.hasPipes && !options?.allowPipes) {
    return {
      allowed: false,
      reason: 'Pipes are not allowed. Use allowPipes option to enable.',
      parsed,
    };
  }

  if (parsed.hasRedirections && !options?.allowRedirections) {
    return {
      allowed: false,
      reason: 'Redirections are not allowed. Use allowRedirections option to enable.',
      parsed,
    };
  }

  if (parsed.hasCommandSubstitution && !options?.allowCommandSubstitution) {
    return {
      allowed: false,
      reason: 'Command substitution is not allowed. Use allowCommandSubstitution option to enable.',
      parsed,
    };
  }

  if (parsed.hasBackground && !options?.allowBackground) {
    return {
      allowed: false,
      reason: 'Background processes are not allowed. Use allowBackground option to enable.',
      parsed,
    };
  }

  // Finally, check allowlist
  const allowlistResult = allowlist.validate(command);

  return {
    ...allowlistResult,
    parsed,
    injectionWarning: undefined,
  };
}

/**
 * Create a default allowlist with conservative settings
 */
export function createDefaultAllowlist(): CommandAllowlist {
  const allowlist = new CommandAllowlist();
  for (const entry of DEFAULT_ALLOWLIST) {
    allowlist.addEntry(entry);
  }
  return allowlist;
}
