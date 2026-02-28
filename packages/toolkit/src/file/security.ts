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
 * Normalizes a path and resolves any symlinks.
 * For non-existent paths, resolves the parent directory to detect symlink escapes.
 */
async function resolveRealPath(inputPath: string): Promise<string> {
  try {
    // Resolve real path (follows symlinks). This will fail if path doesn't exist.
    return await fs.promises.realpath(inputPath);
  } catch {
    // Path doesn't exist - resolve the parent directory to check for symlink escapes
    const parentDir = path.dirname(inputPath);
    const baseName = path.basename(inputPath);

    try {
      // Resolve the parent directory (follows symlinks)
      const resolvedParent = await fs.promises.realpath(parentDir);
      // Reconstruct the full path with resolved parent
      return path.join(resolvedParent, baseName);
    } catch {
      // Parent also doesn't exist or can't be accessed, return normalized path
      return path.normalize(inputPath);
    }
  }
}

/**
 * Performs basic validation checks on the requested path.
 * Returns a failure result if validation fails, null otherwise.
 */
function performBasicValidation(
  requestedPath: string,
  normalizedPath: string
): PathValidationFailure | null {
  // Handle empty path
  if (!requestedPath || requestedPath.trim() === '') {
    return { valid: false, reason: 'Path cannot be empty' };
  }

  // Check for null bytes (path injection attempt)
  if (normalizedPath.includes('\0')) {
    return { valid: false, reason: 'Path contains null bytes' };
  }

  // Check for tilde expansion attempt (security: prevent home directory access)
  if (requestedPath.startsWith('~')) {
    return { valid: false, reason: 'Path contains tilde expansion' };
  }

  return null;
}

/**
 * Checks if a resolved path is within the workspace boundary.
 */
function isPathWithinWorkspace(
  resolvedPath: string,
  workspaceRoot: string
): boolean {
  // Ensure the resolved path starts with workspace root
  // We add path.sep to ensure we don't match partial directory names
  const workspaceRootWithSep = workspaceRoot.endsWith(path.sep)
    ? workspaceRoot
    : workspaceRoot + path.sep;

  const resolvedPathWithSep = resolvedPath.endsWith(path.sep)
    ? resolvedPath
    : resolvedPath + path.sep;

  // Exact match with workspace root is allowed
  const isExactWorkspaceRoot = resolvedPath === workspaceRoot;

  return isExactWorkspaceRoot || resolvedPathWithSep.startsWith(workspaceRootWithSep);
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
  const normalizedWorkspaceRoot = await resolveRealPath(path.resolve(workspaceRoot));

  // Resolve the requested path to an absolute path
  const absolutePath = path.resolve(normalizedWorkspaceRoot, requestedPath);
  const normalizedPath = path.normalize(absolutePath);

  // Perform basic validation checks
  const basicValidation = performBasicValidation(requestedPath, normalizedPath);
  if (basicValidation) {
    return basicValidation;
  }

  // Resolve symlinks if the path exists
  const resolvedPath = await resolveRealPath(normalizedPath);

  // Check workspace boundary
  if (!isPathWithinWorkspace(resolvedPath, normalizedWorkspaceRoot)) {
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

  // Resolve the requested path to an absolute path
  const absolutePath = path.resolve(normalizedWorkspaceRoot, requestedPath);
  const normalizedPath = path.normalize(absolutePath);

  // Perform basic validation checks
  const basicValidation = performBasicValidation(requestedPath, normalizedPath);
  if (basicValidation) {
    return basicValidation;
  }

  // For sync version, we can't resolve symlinks, so we just use normalized path
  // This is a limitation - the async version is preferred for security

  // Check workspace boundary
  if (!isPathWithinWorkspace(normalizedPath, normalizedWorkspaceRoot)) {
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
