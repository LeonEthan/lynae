// File Tools Type Definitions
// Input/output types for file operations

import type { DiffSummary } from './diff.js';

// ============================================================================
// File Read Tool Types
// ============================================================================

export interface FileReadInput {
  /** Relative or absolute path to file */
  path: string;
  /** Optional encoding (default: utf-8) */
  encoding?: 'utf-8' | 'base64' | 'latin1';
}

export interface FileReadOutput {
  /** File content */
  content: string;
  /** Encoding used for reading */
  encoding: string;
  /** File size in bytes */
  size: number;
}

// ============================================================================
// File Write Tool Types
// ============================================================================

export interface FileWriteInput {
  /** Relative or absolute path to file */
  path: string;
  /** Content to write */
  content: string;
  /** Optional encoding (default: utf-8) */
  encoding?: 'utf-8' | 'base64' | 'latin1';
  /** If true, create parent directories if they do not exist */
  createDirectories?: boolean;
}

export interface FileWriteOutput {
  /** Whether write was successful */
  written: true;
  /** Full path to the written file */
  path: string;
  /** Number of bytes written */
  bytes: number;
  /** Diff summary if file existed before */
  diff?: DiffSummary;
  /** Whether this was a new file */
  isNewFile: boolean;
}

// ============================================================================
// File Search Tool Types
// ============================================================================

export interface FileSearchInput {
  /** Glob pattern to search for files */
  pattern: string;
  /** Optional path to search within (relative or absolute) */
  path?: string;
  /** Optional content to search for within files */
  content?: string;
  /** Maximum number of results (default: 100) */
  limit?: number;
  /** Whether to exclude hidden files (default: true) */
  excludeHidden?: boolean;
}

export interface FileSearchMatch {
  /** Path to the matching file */
  path: string;
  /** Line number where match was found (if content search) */
  line?: number;
  /** Matching line content (if content search) */
  content?: string;
  /** Column number where match starts (if content search) */
  column?: number;
}

export interface FileSearchOutput {
  /** Array of matches */
  matches: FileSearchMatch[];
  /** Total number of matches found */
  total: number;
  /** Search pattern used */
  pattern: string;
}

// ============================================================================
// File Replace Tool Types
// ============================================================================

export interface FileReplaceInput {
  /** Path to file */
  path: string;
  /** Text to search for */
  search: string;
  /** Text to replace with */
  replace: string;
  /** Whether to replace all occurrences (default: true) */
  replaceAll?: boolean;
  /** Maximum number of replacements (if replaceAll is false) */
  limit?: number;
}

export interface FileReplaceOutput {
  /** Full path to the modified file */
  path: string;
  /** Number of replacements made */
  replaced: number;
  /** Diff summary of changes */
  diff: DiffSummary;
  /** Original content (for potential rollback) */
  originalContent: string;
  /** New content after replacement */
  newContent: string;
}

// ============================================================================
// File List Directory Tool Types
// ============================================================================

export interface FileListInput {
  /** Directory path to list (default: .) */
  path?: string;
  /** Whether to list recursively (default: false) */
  recursive?: boolean;
  /** Optional glob pattern to filter results */
  pattern?: string;
}

export interface FileListEntry {
  /** Name of the file/directory */
  name: string;
  /** Full path */
  path: string;
  /** Type of entry */
  type: 'file' | 'directory';
  /** Size in bytes (files only) */
  size?: number;
  /** Last modified timestamp */
  modifiedAt?: Date;
}

export interface FileListOutput {
  /** Array of entries */
  entries: FileListEntry[];
  /** Total number of entries */
  total: number;
}

// ============================================================================
// Error Types
// ============================================================================

export interface FileToolError {
  /** Error code */
  code:
    | 'PATH_VALIDATION_FAILED'
    | 'FILE_NOT_FOUND'
    | 'PERMISSION_DENIED'
    | 'IS_DIRECTORY'
    | 'NOT_A_DIRECTORY'
    | 'ALREADY_EXISTS'
    | 'SEARCH_ERROR'
    | 'WRITE_ERROR'
    | 'READ_ERROR'
    | 'INVALID_ENCODING';
  /** Error message */
  message: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

// ============================================================================
// Audit Types
// ============================================================================

export interface FileOperationAudit {
  /** Operation type */
  operation: 'read' | 'write' | 'search' | 'replace' | 'list';
  /** Requested path (before validation) */
  requestedPath: string;
  /** Resolved path (after validation) */
  resolvedPath?: string;
  /** Whether operation was successful */
  success: boolean;
  /** Error information if failed */
  error?: {
    code: string;
    message: string;
  };
  /** Session ID */
  sessionId: string;
  /** Task ID */
  taskId: string;
  /** Timestamp */
  timestamp: Date;
}
