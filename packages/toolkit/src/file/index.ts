// File Tools Implementation
// Secure file operations with workspace boundary enforcement

import fs from 'node:fs';
import path from 'node:path';
import { mkdir, writeFile, readFile, readdir, access, rename, unlink } from 'node:fs/promises';
import fastGlob from 'fast-glob';
import type { Tool, ToolContext } from '../index.js';
import { validatePath, PathValidationError } from './security.js';
import { generateDiff } from './diff.js';
import type {
  FileReadInput,
  FileReadOutput,
  FileWriteInput,
  FileWriteOutput,
  FileSearchInput,
  FileSearchOutput,
  FileSearchMatch,
  FileReplaceInput,
  FileReplaceOutput,
  FileListInput,
  FileListOutput,
  FileListEntry,
} from './types.js';

// Re-export types and utilities
export * from './security.js';
export * from './diff.js';
export * from './types.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Ensures a directory exists, creating it if necessary
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Performs atomic file write by writing to temp file then renaming
 */
async function atomicWriteFile(filePath: string, content: string, encoding: BufferEncoding): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await writeFile(tempPath, content, { encoding });
    await rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on error, then re-throw original error
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error; // Re-throw to preserve stack trace
  }
}

/**
 * Reads file content with proper encoding
 */
async function readFileContent(
  filePath: string,
  encoding: 'utf-8' | 'base64' | 'latin1' = 'utf-8'
): Promise<{ content: string; size: number }> {
  const stats = await fs.promises.stat(filePath);

  if (stats.isDirectory()) {
    throw new Error('IS_DIRECTORY');
  }

  const buffer = await readFile(filePath);

  let content: string;
  if (encoding === 'base64') {
    content = buffer.toString('base64');
  } else if (encoding === 'latin1') {
    content = buffer.toString('latin1');
  } else {
    content = buffer.toString('utf-8');
  }

  return { content, size: stats.size };
}

/**
 * Checks if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Process files with limited concurrency for better I/O throughput.
 * Uses Promise.all for batches of files to parallelize while controlling memory.
 */
async function processFilesWithLimit<T>(
  files: string[],
  processor: (file: string) => Promise<T[]>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  const CONCURRENCY = 10; // Process 10 files at a time

  for (let i = 0; i < files.length && results.length < limit; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processor));

    for (const fileResults of batchResults) {
      results.push(...fileResults);
      if (results.length >= limit) {
        return results.slice(0, limit);
      }
    }
  }

  return results;
}

// ============================================================================
// File Read Tool
// ============================================================================

export const FileReadTool: Tool = {
  name: 'file_read',
  description: 'Read file contents from the workspace',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to file' },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'base64', 'latin1'],
        description: 'File encoding (default: utf-8)',
      },
    },
    required: ['path'],
  },
  async execute(input: unknown, context: ToolContext): Promise<FileReadOutput> {
    const { path: requestedPath, encoding = 'utf-8' } = input as FileReadInput;

    // Validate path is within workspace
    const validation = await validatePath(requestedPath, context.workspaceRoot);
    if (!validation.valid) {
      throw new PathValidationError(requestedPath, context.workspaceRoot, validation.reason);
    }

    // Read file content (ENOENT will be thrown if file doesn't exist)
    try {
      const { content, size } = await readFileContent(validation.resolvedPath, encoding);
      return {
        content,
        encoding,
        size,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`FILE_NOT_FOUND: File "${requestedPath}" does not exist`);
      }
      throw error;
    }
  },
};

// ============================================================================
// File Write Tool
// ============================================================================

export const FileWriteTool: Tool = {
  name: 'file_write',
  description: 'Write file contents to the workspace (atomic write)',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to file' },
      content: { type: 'string', description: 'Content to write' },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'base64', 'latin1'],
        description: 'Content encoding (default: utf-8)',
      },
      createDirectories: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist',
      },
    },
    required: ['path', 'content'],
  },
  async execute(input: unknown, context: ToolContext): Promise<FileWriteOutput> {
    const {
      path: requestedPath,
      content,
      encoding = 'utf-8',
      createDirectories = true,
    } = input as FileWriteInput;

    // Validate path is within workspace
    const validation = await validatePath(requestedPath, context.workspaceRoot);
    if (!validation.valid) {
      throw new PathValidationError(requestedPath, context.workspaceRoot, validation.reason);
    }

    const resolvedPath = validation.resolvedPath;

    // Read original content if file exists (for diff)
    let originalContent: string | null = null;

    try {
      const stats = await fs.promises.stat(resolvedPath);
      if (stats.isDirectory()) {
        throw new Error(`IS_DIRECTORY: "${requestedPath}" is a directory`);
      }

      try {
        const { content: existingContent } = await readFileContent(resolvedPath, encoding);
        originalContent = existingContent;
      } catch {
        // If we can't read the file, treat it as new
        originalContent = null;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, originalContent stays null
    }

    // Create parent directories if needed
    if (createDirectories) {
      const parentDir = path.dirname(resolvedPath);
      await ensureDirectory(parentDir);
    }

    // Content is already a string, Buffer encoding happens during write
    const fileContent = content;

    // Perform atomic write
    const bufferEncoding = encoding === 'base64' ? 'base64' : encoding === 'latin1' ? 'latin1' : 'utf-8';
    await atomicWriteFile(resolvedPath, fileContent, bufferEncoding);

    // Calculate bytes written
    const bytes = Buffer.byteLength(fileContent, bufferEncoding);

    // Generate diff if this was an update
    const isNewFile = originalContent === null;
    const diff = !isNewFile ? generateDiff(originalContent, content) : undefined;

    return {
      written: true,
      path: resolvedPath,
      bytes,
      diff,
      isNewFile,
    };
  },
};

// ============================================================================
// File Search Tool
// ============================================================================

export const FileSearchTool: Tool = {
  name: 'file_search',
  description: 'Search files by glob pattern and/or content within the workspace',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to search for (e.g., "**/*.ts")',
      },
      path: {
        type: 'string',
        description: 'Optional subdirectory to search within',
      },
      content: {
        type: 'string',
        description: 'Optional text content to search for within files',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 100)',
      },
      excludeHidden: {
        type: 'boolean',
        description: 'Exclude hidden files (default: true)',
      },
    },
    required: ['pattern'],
  },
  async execute(input: unknown, context: ToolContext): Promise<FileSearchOutput> {
    const {
      pattern,
      path: searchPath,
      content: contentSearch,
      limit = 100,
      excludeHidden = true,
    } = input as FileSearchInput;

    // Validate search path if provided
    let searchRoot = context.workspaceRoot;
    if (searchPath) {
      const validation = await validatePath(searchPath, context.workspaceRoot);
      if (!validation.valid) {
        throw new PathValidationError(searchPath, context.workspaceRoot, validation.reason);
      }
      searchRoot = validation.resolvedPath;
    }

    // Check if search root is a directory
    const stats = await fs.promises.stat(searchRoot);
    if (!stats.isDirectory()) {
      throw new Error(`NOT_A_DIRECTORY: "${searchPath || '.'}" is not a directory`);
    }

    // Build glob options
    const globOptions: fastGlob.Options = {
      cwd: searchRoot,
      absolute: true,
      dot: !excludeHidden,
      followSymbolicLinks: false, // Security: don't follow symlinks outside workspace
    };

    // Perform glob search
    const allFiles = await fastGlob(pattern, globOptions);
    // Apply limit to file results
    const files = allFiles.slice(0, limit);

    // Process files with limited concurrency for better I/O throughput
    const matches = await processFilesWithLimit(files, async (file) => {
      // Validate each file is still within workspace (in case of symlinks)
      const fileValidation = await validatePath(file, context.workspaceRoot);
      if (!fileValidation.valid) {
        return []; // Skip files outside workspace
      }

      if (!contentSearch) {
        // Just return file path
        return [{ path: file }];
      }

      // Search for content in file
      try {
        const { content } = await readFileContent(file, 'utf-8');
        const fileMatches: FileSearchMatch[] = [];

        // Search for content in file
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lineContent = lines[i];
          const column = lineContent.indexOf(contentSearch);

          if (column !== -1) {
            fileMatches.push({
              path: file,
              line: i + 1,
              content: lineContent.trim(),
              column: column + 1,
            });
          }
        }
        return fileMatches;
      } catch {
        // Skip files we can't read
        return [];
      }
    }, limit);

    return {
      matches,
      total: matches.length,
      pattern,
    };
  },
};

// ============================================================================
// File Replace Tool
// ============================================================================

export const FileReplaceTool: Tool = {
  name: 'file_replace',
  description: 'Replace text in files within the workspace',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to file',
      },
      search: {
        type: 'string',
        description: 'Text to search for',
      },
      replace: {
        type: 'string',
        description: 'Text to replace with',
      },
      replaceAll: {
        type: 'boolean',
        description: 'Replace all occurrences (default: true)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of replacements (if replaceAll is false)',
      },
    },
    required: ['path', 'search', 'replace'],
  },
  async execute(input: unknown, context: ToolContext): Promise<FileReplaceOutput> {
    const {
      path: requestedPath,
      search,
      replace,
      replaceAll = true,
      limit = 1,
    } = input as FileReplaceInput;

    // Validate search is not empty (empty search would match at every position)
    if (search === '') {
      throw new Error('INVALID_INPUT: search pattern cannot be empty');
    }

    // Validate path is within workspace
    const validation = await validatePath(requestedPath, context.workspaceRoot);
    if (!validation.valid) {
      throw new PathValidationError(requestedPath, context.workspaceRoot, validation.reason);
    }

    const resolvedPath = validation.resolvedPath;

    // Check if file exists
    if (!(await fileExists(resolvedPath))) {
      throw new Error(`FILE_NOT_FOUND: File "${requestedPath}" does not exist`);
    }

    // Check it's not a directory
    const stats = await fs.promises.stat(resolvedPath);
    if (stats.isDirectory()) {
      throw new Error(`IS_DIRECTORY: "${requestedPath}" is a directory`);
    }

    // Read original content
    const { content: originalContent } = await readFileContent(resolvedPath, 'utf-8');

    // Perform replacement
    let newContent: string;
    let replacedCount = 0;

    if (replaceAll) {
      // Replace all occurrences
      const regex = new RegExp(escapeRegExp(search), 'g');
      const matches = originalContent.match(regex);
      replacedCount = matches ? matches.length : 0;
      newContent = originalContent.replace(regex, replace);
    } else {
      // Replace limited occurrences
      const maxReplacements = Math.max(1, limit);
      let remaining = maxReplacements;
      const regex = new RegExp(escapeRegExp(search), 'g');

      newContent = originalContent.replace(regex, (match) => {
        if (remaining > 0) {
          remaining--;
          replacedCount++;
          return replace;
        }
        return match;
      });
    }

    // If nothing was replaced, return early
    if (replacedCount === 0) {
      return {
        path: resolvedPath,
        replaced: 0,
        diff: generateDiff(originalContent, originalContent),
        originalContent,
        newContent: originalContent,
      };
    }

    // Write the modified content
    await atomicWriteFile(resolvedPath, newContent, 'utf-8');

    // Generate diff
    const diff = generateDiff(originalContent, newContent);

    return {
      path: resolvedPath,
      replaced: replacedCount,
      diff,
      originalContent,
      newContent,
    };
  },
};

/**
 * Escapes special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// File List Directory Tool
// ============================================================================

export const FileListTool: Tool = {
  name: 'file_list',
  description: 'List directory contents within the workspace',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (default: current directory)',
      },
      recursive: {
        type: 'boolean',
        description: 'List recursively (default: false)',
      },
      pattern: {
        type: 'string',
        description: 'Optional glob pattern to filter results',
      },
    },
  },
  async execute(input: unknown, context: ToolContext): Promise<FileListOutput> {
    const { path: requestedPath = '.', recursive = false, pattern } = input as FileListInput;

    // Validate path is within workspace
    const validation = await validatePath(requestedPath, context.workspaceRoot);
    if (!validation.valid) {
      throw new PathValidationError(requestedPath, context.workspaceRoot, validation.reason);
    }

    const resolvedPath = validation.resolvedPath;

    // Check if path exists and is a directory
    const stats = await fs.promises.stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`NOT_A_DIRECTORY: "${requestedPath}" is not a directory`);
    }

    const entries: FileListEntry[] = [];

    if (recursive && pattern) {
      // Use glob for recursive pattern matching
      const files = await fastGlob(pattern, {
        cwd: resolvedPath,
        absolute: true,
        dot: true,
      });

      for (const file of files) {
        // Validate each file is within workspace
        const fileValidation = await validatePath(file, context.workspaceRoot);
        if (!fileValidation.valid) {
          continue;
        }

        try {
          const fileStats = await fs.promises.stat(file);
          entries.push({
            name: path.basename(file),
            path: file,
            type: fileStats.isDirectory() ? 'directory' : 'file',
            size: fileStats.isFile() ? fileStats.size : undefined,
            modifiedAt: fileStats.mtime,
          });
        } catch {
          // Skip entries we can't stat
          continue;
        }
      }
    } else {
      // Read directory contents
      const items = await readdir(resolvedPath, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(resolvedPath, item.name);

        // Security: Re-validate each entry to detect symlink escapes
        // (directory entries could be symlinks pointing outside workspace)
        const entryValidation = await validatePath(itemPath, context.workspaceRoot);
        if (!entryValidation.valid) {
          continue;
        }

        const itemStats = await fs.promises.stat(itemPath);
        entries.push({
          name: item.name,
          path: itemPath,
          type: item.isDirectory() ? 'directory' : 'file',
          size: item.isFile() ? itemStats.size : undefined,
          modifiedAt: itemStats.mtime,
        });

        // If recursive, add subdirectory contents
        if (recursive && item.isDirectory()) {
          const subDirResult = await FileListTool.execute(
            { path: itemPath, recursive: true },
            context
          );
          entries.push(...(subDirResult as FileListOutput).entries);
        }
      }
    }

    return {
      entries,
      total: entries.length,
    };
  },
};

// ============================================================================
// Export All File Tools
// ============================================================================

export const FileTools = {
  FileReadTool,
  FileWriteTool,
  FileSearchTool,
  FileReplaceTool,
  FileListTool,
};
