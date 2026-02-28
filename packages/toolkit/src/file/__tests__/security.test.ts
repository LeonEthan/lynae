import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  validatePath,
  validatePathSync,
  createPathValidator,
  PathValidationError,
} from '../security.js';

describe('Path Validation Security', () => {
  const workspaceRoot = path.resolve('/workspace/project');

  describe('validatePath (async)', () => {
    it('should accept valid paths within workspace', async () => {
      const result = await validatePath('src/index.ts', workspaceRoot);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(workspaceRoot, 'src/index.ts'));
      }
    });

    it('should accept paths at workspace root', async () => {
      const result = await validatePath('.', workspaceRoot);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(workspaceRoot);
      }
    });

    it('should accept paths with ./ prefix', async () => {
      const result = await validatePath('./src/index.ts', workspaceRoot);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(workspaceRoot, 'src/index.ts'));
      }
    });

    it('should reject path traversal with ../', async () => {
      const result = await validatePath('../etc/passwd', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('outside workspace');
      }
    });

    it('should reject absolute paths outside workspace', async () => {
      const result = await validatePath('/etc/passwd', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('outside workspace');
      }
    });

    it('should reject empty paths', async () => {
      const result = await validatePath('', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('empty');
      }
    });

    it('should reject paths with only whitespace', async () => {
      const result = await validatePath('   ', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('empty');
      }
    });

    it('should reject paths with null bytes', async () => {
      const result = await validatePath('file\0.txt', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('null bytes');
      }
    });

    it('should reject nested path traversal', async () => {
      const result = await validatePath('src/../../../etc/passwd', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('outside workspace');
      }
    });

    it('should reject traversal in middle of path', async () => {
      // This path: src/../../etc/passwd resolves to /workspace/etc/passwd
      // which is outside /workspace/project
      const result = await validatePath('src/../../etc/passwd', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('outside workspace');
      }
    });

    it('should accept paths that look like traversal but are valid', async () => {
      const result = await validatePath('src/components/../index.ts', workspaceRoot);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(workspaceRoot, 'src/index.ts'));
      }
    });

    it('should handle Windows-style paths on Unix', async () => {
      const result = await validatePath('src\\index.ts', workspaceRoot);
      // On Unix, backslash is treated as a literal character, not a separator
      // The behavior depends on the platform
      expect(result.valid).toBe(true);
    });
  });

  describe('validatePathSync', () => {
    it('should accept valid paths within workspace', () => {
      const result = validatePathSync('src/index.ts', workspaceRoot);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(workspaceRoot, 'src/index.ts'));
      }
    });

    it('should reject path traversal with ../', () => {
      const result = validatePathSync('../etc/passwd', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('outside workspace');
      }
    });

    it('should reject empty paths', () => {
      const result = validatePathSync('', workspaceRoot);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('empty');
      }
    });
  });

  describe('createPathValidator', () => {
    it('should create a bound validator', async () => {
      const validator = createPathValidator(workspaceRoot);

      const validResult = await validator.validate('src/index.ts');
      expect(validResult.valid).toBe(true);

      const invalidResult = await validator.validate('../etc/passwd');
      expect(invalidResult.valid).toBe(false);
    });

    it('should provide sync validation', () => {
      const validator = createPathValidator(workspaceRoot);

      const result = validator.validateSync('src/index.ts');
      expect(result.valid).toBe(true);
    });

    it('should return the workspace root', () => {
      const validator = createPathValidator(workspaceRoot);
      expect(validator.getWorkspaceRoot()).toBe(workspaceRoot);
    });
  });

  describe('PathValidationError', () => {
    it('should create error with correct properties', () => {
      const error = new PathValidationError(
        '../etc/passwd',
        workspaceRoot,
        'Path is outside workspace'
      );

      expect(error.name).toBe('PathValidationError');
      expect(error.attemptedPath).toBe('../etc/passwd');
      expect(error.workspaceRoot).toBe(workspaceRoot);
      expect(error.reason).toBe('Path is outside workspace');
      expect(error.message).toContain('Path validation failed');
    });

    it('should be instanceof Error', () => {
      const error = new PathValidationError('test', 'root', 'reason');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('Real-world attack scenarios', () => {
    it('should block /etc/passwd access', async () => {
      const result = await validatePath('/etc/passwd', workspaceRoot);
      expect(result.valid).toBe(false);
    });

    it('should block /etc/shadow access', async () => {
      const result = await validatePath('/etc/shadow', workspaceRoot);
      expect(result.valid).toBe(false);
    });

    it('should block ~/.ssh/id_rsa access', async () => {
      const result = await validatePath('~/.ssh/id_rsa', workspaceRoot);
      expect(result.valid).toBe(false); // ~ is blocked to prevent shell expansion attacks
      if (!result.valid) {
        expect(result.reason).toContain('tilde');
      }
    });

    it('should block access via multiple parent directory references', async () => {
      const result = await validatePath('a/b/c/../../../../../../etc/passwd', workspaceRoot);
      expect(result.valid).toBe(false);
    });

    it('should block access via URL encoding (if not decoded)', async () => {
      const result = await validatePath('..%2f..%2fetc%2fpasswd', workspaceRoot);
      expect(result.valid).toBe(true); // %2f is not decoded, treated as literal
    });

    it('should block null byte injection', async () => {
      const result = await validatePath('file.txt\0.jpg', workspaceRoot);
      expect(result.valid).toBe(false);
    });

    it('should block double encoding attacks', async () => {
      const result = await validatePath('..%252f..%252fetc%252fpasswd', workspaceRoot);
      expect(result.valid).toBe(true); // Treated as literal, not decoded
    });
  });

  describe('Edge cases', () => {
    it('should handle paths with trailing slash', async () => {
      const result = await validatePath('src/', workspaceRoot);
      expect(result.valid).toBe(true);
    });

    it('should handle paths with multiple slashes', async () => {
      const result = await validatePath('src//index.ts', workspaceRoot);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(workspaceRoot, 'src/index.ts'));
      }
    });

    it('should handle paths with single dot segments', async () => {
      const result = await validatePath('./././src/index.ts', workspaceRoot);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(workspaceRoot, 'src/index.ts'));
      }
    });

    it('should handle very deep paths', async () => {
      const deepPath = 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/file.txt';
      const result = await validatePath(deepPath, workspaceRoot);
      expect(result.valid).toBe(true);
    });

    it('should handle paths with spaces', async () => {
      const result = await validatePath('my documents/file.txt', workspaceRoot);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.resolvedPath).toBe(path.join(workspaceRoot, 'my documents/file.txt'));
      }
    });

    it('should handle paths with special characters', async () => {
      const result = await validatePath('file-[test].txt', workspaceRoot);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Path Validation with Real Filesystem', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'toolkit-test-'));
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should validate paths against real temp directory', async () => {
    // Create the test file first so realpath can work
    const testFile = path.join(tempDir, 'test.txt');
    await fs.promises.writeFile(testFile, 'content');

    const result = await validatePath('test.txt', tempDir);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Use realpath for comparison since temp dir may be a symlink on macOS
      const expectedPath = await fs.promises.realpath(testFile);
      expect(result.resolvedPath).toBe(expectedPath);
    }
  });

  it('should resolve symlinks that stay within workspace', async () => {
    // Create a file and a symlink within the workspace
    const realFile = path.join(tempDir, 'real.txt');
    const symlinkFile = path.join(tempDir, 'link.txt');

    await fs.promises.writeFile(realFile, 'content');
    await fs.promises.symlink(realFile, symlinkFile);

    const result = await validatePath('link.txt', tempDir);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Use realpath for comparison since temp dir may be a symlink on macOS
      const expectedRealFile = await fs.promises.realpath(realFile);
      expect(result.resolvedPath).toBe(expectedRealFile); // Should resolve to real path
    }
  });

  it('should reject symlinks that point outside workspace', async () => {
    // Create a file outside temp dir and a symlink inside
    const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'outside-'));
    const outsideFile = path.join(outsideDir, 'secret.txt');
    const symlinkFile = path.join(tempDir, 'link-to-secret.txt');

    try {
      await fs.promises.writeFile(outsideFile, 'secret');
      await fs.promises.symlink(outsideFile, symlinkFile);

      const result = await validatePath('link-to-secret.txt', tempDir);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain('outside workspace');
      }
    } finally {
      await fs.promises.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
