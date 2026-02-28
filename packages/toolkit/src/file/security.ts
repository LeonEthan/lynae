// Workspace Security Layer - Path validation and boundary enforcement
// All file paths must be within the workspace root directory

import path from 'node:path';
import fs from 'node:fs';

export interface PathValidationSuccess {
  valid: true;
  resolvedPath: string;
}

export interface PathValidationFailure {
  valid: false;
  reason: string;
}

export type PathValidationResult = PathValidationSuccess | PathValidationFailure;

/**
 * Security error for audit logging when path validation fails
 */
export class PathValidationError extends Error {
  constructor(
    public readonly attemptedPath: string,
    public readonly workspaceRoot: string,
    public readonly reason: string
  ) {
    super(`Path validation failed: ${reason}`);
    this.name = 'PathValidationError';
  }
}

/**
 * Normalizes a path and resolves any symlinks
 */
async function resolveRealPath(inputPath: string): Promise<string | null> {
  try {
    // Check if path exists first
    await fs.promises.access(inputPath);
    // Resolve real path (follows symlinks)
    return await fs.promises.realpath(inputPath);
  } catch {
    // Path doesn't exist or can't be accessed, return normalized path
    return path.normalize(inputPath);
  }
}

/**
 * Validates that a requested path is within the workspace root
 *
 * Validation Rules:
 * 1. Resolve absolute path from workspaceRoot + requestedPath
 * 2. Ensure resolved path starts with workspaceRoot (after normalization)
 * 3. Block path traversal attempts (../, symlinks outside workspace)
 * 4. Reject absolute paths that escape workspace
 *
 * @param requestedPath - The path requested by the tool (can be relative or absolute)
 * @param workspaceRoot - The absolute path to the workspace root directory
 * @returns PathValidationResult with resolved path or failure reason
 */
export async function validatePath(
  requestedPath: string,
  workspaceRoot: string
): Promise<PathValidationResult> {
  // Ensure workspaceRoot is absolute and resolved (including symlinks)
  const normalizedWorkspaceRoot = await resolveRealPath(path.resolve(workspaceRoot)) ?? path.resolve(workspaceRoot);

  // Handle empty path
  if (!requestedPath || requestedPath.trim() === '') {
    return { valid: false, reason: 'Path cannot be empty' };
  }

  // Resolve the requested path to an absolute path
  // If path is absolute, path.resolve returns it as-is (normalized)
  // If path is relative, it's resolved against workspaceRoot
  const absolutePath = path.resolve(normalizedWorkspaceRoot, requestedPath);

  // Normalize the path to handle .. and . segments
  const normalizedPath = path.normalize(absolutePath);

  // Check for null bytes (path injection attempt)
  if (normalizedPath.includes('\0')) {
    return { valid: false, reason: 'Path contains null bytes' };
  }

  // Check for tilde expansion attempt (security: prevent home directory access)
  if (requestedPath.startsWith('~')) {
    return { valid: false, reason: 'Path contains tilde expansion' };
  }

  // Resolve symlinks if the path exists
  const resolvedPath = await resolveRealPath(normalizedPath);
  if (!resolvedPath) {
    return { valid: false, reason: 'Path cannot be accessed' };
  }

  // Ensure the resolved path starts with workspace root
  // We add path.sep to ensure we don't match partial directory names
  const workspaceRootWithSep = normalizedWorkspaceRoot.endsWith(path.sep)
    ? normalizedWorkspaceRoot
    : normalizedWorkspaceRoot + path.sep;

  const resolvedPathWithSep = resolvedPath.endsWith(path.sep)
    ? resolvedPath
    : resolvedPath + path.sep;

  // Exact match with workspace root is allowed
  const isExactWorkspaceRoot = resolvedPath === normalizedWorkspaceRoot;

  // Check if path is within workspace
  const isWithinWorkspace =
    isExactWorkspaceRoot || resolvedPathWithSep.startsWith(workspaceRootWithSep);

  if (!isWithinWorkspace) {
    return {
      valid: false,
      reason: `Path "${requestedPath}" is outside workspace boundary`,
    };
  }

  return { valid: true, resolvedPath };
}

/**
 * Synchronous version of validatePath for simple use cases
 */
export function validatePathSync(
  requestedPath: string,
  workspaceRoot: string
): PathValidationResult {
  // Ensure workspaceRoot is absolute and normalized
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);

  // Handle empty path
  if (!requestedPath || requestedPath.trim() === '') {
    return { valid: false, reason: 'Path cannot be empty' };
  }

  // Resolve the requested path to an absolute path
  const absolutePath = path.resolve(normalizedWorkspaceRoot, requestedPath);

  // Normalize the path to handle .. and . segments
  const normalizedPath = path.normalize(absolutePath);

  // Check for null bytes (path injection attempt)
  if (normalizedPath.includes('\0')) {
    return { valid: false, reason: 'Path contains null bytes' };
  }

  // Check for tilde expansion attempt (security: prevent home directory access)
  if (requestedPath.startsWith('~')) {
    return { valid: false, reason: 'Path contains tilde expansion' };
  }

  // For sync version, we can't resolve symlinks, so we just use normalized path
  // This is a limitation - the async version is preferred for security

  // Ensure the resolved path starts with workspace root
  const workspaceRootWithSep = normalizedWorkspaceRoot.endsWith(path.sep)
    ? normalizedWorkspaceRoot
    : normalizedWorkspaceRoot + path.sep;

  const normalizedPathWithSep = normalizedPath.endsWith(path.sep)
    ? normalizedPath
    : normalizedPath + path.sep;

  // Exact match with workspace root is allowed
  const isExactWorkspaceRoot = normalizedPath === normalizedWorkspaceRoot;

  // Check if path is within workspace
  const isWithinWorkspace =
    isExactWorkspaceRoot || normalizedPathWithSep.startsWith(workspaceRootWithSep);

  if (!isWithinWorkspace) {
    return {
      valid: false,
      reason: `Path "${requestedPath}" is outside workspace boundary`,
    };
  }

  return { valid: true, resolvedPath: normalizedPath };
}

/**
 * Creates a bound validator for a specific workspace root
 * Useful when multiple validations will be performed against the same workspace
 */
export function createPathValidator(workspaceRoot: string) {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);

  return {
    /**
     * Validate a path against the bound workspace root (async)
     */
    validate: (requestedPath: string) => validatePath(requestedPath, normalizedWorkspaceRoot),

    /**
     * Validate a path against the bound workspace root (sync)
     */
    validateSync: (requestedPath: string) =>
      validatePathSync(requestedPath, normalizedWorkspaceRoot),

    /**
     * Get the workspace root
     */
    getWorkspaceRoot: () => normalizedWorkspaceRoot,
  };
}

export type PathValidator = ReturnType<typeof createPathValidator>;
