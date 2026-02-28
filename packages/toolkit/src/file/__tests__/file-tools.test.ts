import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  FileReadTool,
  FileWriteTool,
  FileSearchTool,
  FileReplaceTool,
  FileListTool,
} from '../index.js';
import type { ToolContext } from '../../index.js';

describe('File Tools Integration', () => {
  let tempDir: string;
  let context: ToolContext;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-tools-test-'));
    context = {
      workspaceRoot: tempDir,
      sessionId: 'test-session',
      taskId: 'test-task',
    };
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('FileReadTool', () => {
    it('should read a file within workspace', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'Hello, World!', 'utf-8');

      const result = await FileReadTool.execute({ path: 'test.txt' }, context);

      expect(result.content).toBe('Hello, World!');
      expect(result.encoding).toBe('utf-8');
      expect(result.size).toBe(13);
    });

    it('should read file with base64 encoding', async () => {
      const testFile = path.join(tempDir, 'binary.bin');
      const content = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      await fs.promises.writeFile(testFile, content);

      const result = await FileReadTool.execute(
        { path: 'binary.bin', encoding: 'base64' },
        context
      );

      expect(result.encoding).toBe('base64');
      expect(result.content).toBe(content.toString('base64'));
    });

    it('should throw error for file outside workspace', async () => {
      await expect(
        FileReadTool.execute({ path: '/etc/passwd' }, context)
      ).rejects.toThrow('Path validation failed');
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        FileReadTool.execute({ path: 'nonexistent.txt' }, context)
      ).rejects.toThrow('FILE_NOT_FOUND');
    });

    it('should throw error for directory', async () => {
      const dirPath = path.join(tempDir, 'testdir');
      await fs.promises.mkdir(dirPath);

      await expect(
        FileReadTool.execute({ path: 'testdir' }, context)
      ).rejects.toThrow('IS_DIRECTORY');
    });

    it('should reject path traversal attempts', async () => {
      const testFile = path.join(tempDir, 'secret.txt');
      await fs.promises.writeFile(testFile, 'secret');

      await expect(
        FileReadTool.execute({ path: '../secret.txt' }, context)
      ).rejects.toThrow('Path validation failed');
    });
  });

  describe('FileWriteTool', () => {
    it('should write a new file', async () => {
      const result = await FileWriteTool.execute(
        { path: 'newfile.txt', content: 'Hello, World!' },
        context
      );

      expect(result.written).toBe(true);
      expect(result.isNewFile).toBe(true);
      expect(result.bytes).toBe(13);

      const content = await fs.promises.readFile(
        path.join(tempDir, 'newfile.txt'),
        'utf-8'
      );
      expect(content).toBe('Hello, World!');
    });

    it('should update existing file and return diff', async () => {
      const testFile = path.join(tempDir, 'existing.txt');
      await fs.promises.writeFile(testFile, 'line1\nline2\nline3', 'utf-8');

      const result = await FileWriteTool.execute(
        { path: 'existing.txt', content: 'line1\nmodified\nline3' },
        context
      );

      expect(result.written).toBe(true);
      expect(result.isNewFile).toBe(false);
      expect(result.diff).toBeDefined();
      expect(result.diff?.additions).toBe(1);
      expect(result.diff?.deletions).toBe(1);
    });

    it('should create parent directories', async () => {
      const result = await FileWriteTool.execute(
        { path: 'subdir/nested/file.txt', content: 'nested content' },
        context
      );

      expect(result.written).toBe(true);

      const content = await fs.promises.readFile(
        path.join(tempDir, 'subdir/nested/file.txt'),
        'utf-8'
      );
      expect(content).toBe('nested content');
    });

    it('should reject writing outside workspace', async () => {
      await expect(
        FileWriteTool.execute(
          { path: '/etc/malicious.txt', content: 'hacked' },
          context
        )
      ).rejects.toThrow('Path validation failed');
    });

    it('should reject path traversal in write', async () => {
      await expect(
        FileWriteTool.execute(
          { path: '../../../etc/passwd', content: 'hacked' },
          context
        )
      ).rejects.toThrow('Path validation failed');
    });

    it('should handle base64 content', async () => {
      const base64Content = Buffer.from('binary data').toString('base64');

      const result = await FileWriteTool.execute(
        { path: 'binary.bin', content: base64Content, encoding: 'base64' },
        context
      );

      expect(result.written).toBe(true);

      const content = await fs.promises.readFile(path.join(tempDir, 'binary.bin'));
      expect(content.toString()).toBe('binary data');
    });
  });

  describe('FileSearchTool', () => {
    beforeEach(async () => {
      // Create test file structure
      await fs.promises.mkdir(path.join(tempDir, 'src', 'components'), { recursive: true });
      await fs.promises.mkdir(path.join(tempDir, 'tests'), { recursive: true });

      await fs.promises.writeFile(
        path.join(tempDir, 'src', 'index.ts'),
        'export const foo = "bar";\nexport function helper() { return 42; }'
      );
      await fs.promises.writeFile(
        path.join(tempDir, 'src', 'components', 'Button.tsx'),
        'export const Button = () => <button>Click me</button>;'
      );
      await fs.promises.writeFile(
        path.join(tempDir, 'tests', 'index.test.ts'),
        'test("helper", () => { expect(helper()).toBe(42); });'
      );
    });

    it('should find files by glob pattern', async () => {
      const result = await FileSearchTool.execute(
        { pattern: '**/*.ts' },
        context
      );

      expect(result.total).toBe(2);
      expect(result.matches.some((m) => m.path.endsWith('index.ts'))).toBe(true);
      expect(result.matches.some((m) => m.path.endsWith('index.test.ts'))).toBe(true);
    });

    it('should search within subdirectory', async () => {
      const result = await FileSearchTool.execute(
        { pattern: '*', path: 'src/components' },
        context
      );

      expect(result.total).toBe(1);
      expect(result.matches[0].path.endsWith('Button.tsx')).toBe(true);
    });

    it('should find files by content', async () => {
      const result = await FileSearchTool.execute(
        { pattern: '**/*.ts', content: 'helper' },
        context
      );

      expect(result.total).toBe(2);
    });

    it('should return line numbers for content matches', async () => {
      const result = await FileSearchTool.execute(
        { pattern: '**/*.ts', content: 'helper' },
        context
      );

      const match = result.matches.find((m) => m.path.endsWith('index.ts'));
      expect(match).toBeDefined();
      expect(match?.line).toBe(2);
      expect(match?.column).toBe(17); // 'helper' starts at position 17
    });

    it('should respect limit', async () => {
      // Create many files
      for (let i = 0; i < 10; i++) {
        await fs.promises.writeFile(
          path.join(tempDir, `file${i}.txt`),
          `content ${i}`
        );
      }

      const result = await FileSearchTool.execute(
        { pattern: '*.txt', limit: 5 },
        context
      );

      expect(result.total).toBe(5);
    });

    it('should reject search outside workspace', async () => {
      await expect(
        FileSearchTool.execute(
          { pattern: '*', path: '/etc' },
          context
        )
      ).rejects.toThrow('Path validation failed');
    });

    it('should skip files outside workspace via symlinks', async () => {
      const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'outside-'));
      try {
        await fs.promises.writeFile(path.join(outsideDir, 'secret.txt'), 'secret');
        await fs.promises.symlink(
          path.join(outsideDir, 'secret.txt'),
          path.join(tempDir, 'link.txt')
        );

        const result = await FileSearchTool.execute(
          { pattern: '*.txt' },
          context
        );

        // Should not include the symlinked file
        expect(result.matches.some((m) => m.path.includes('secret'))).toBe(false);
      } finally {
        await fs.promises.rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('FileReplaceTool', () => {
    it('should replace text in file', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'Hello, World!', 'utf-8');

      const result = await FileReplaceTool.execute(
        { path: 'test.txt', search: 'World', replace: 'Universe' },
        context
      );

      expect(result.replaced).toBe(1);
      expect(result.diff.additions).toBe(1);
      expect(result.diff.deletions).toBe(1);

      const content = await fs.promises.readFile(testFile, 'utf-8');
      expect(content).toBe('Hello, Universe!');
    });

    it('should replace all occurrences by default', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'foo bar foo baz foo', 'utf-8');

      const result = await FileReplaceTool.execute(
        { path: 'test.txt', search: 'foo', replace: 'qux' },
        context
      );

      expect(result.replaced).toBe(3);

      const content = await fs.promises.readFile(testFile, 'utf-8');
      expect(content).toBe('qux bar qux baz qux');
    });

    it('should replace limited occurrences when replaceAll is false', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'foo bar foo baz foo', 'utf-8');

      const result = await FileReplaceTool.execute(
        { path: 'test.txt', search: 'foo', replace: 'qux', replaceAll: false, limit: 2 },
        context
      );

      expect(result.replaced).toBe(2);

      const content = await fs.promises.readFile(testFile, 'utf-8');
      expect(content).toBe('qux bar qux baz foo');
    });

    it('should return zero replacements when search not found', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'Hello, World!', 'utf-8');

      const result = await FileReplaceTool.execute(
        { path: 'test.txt', search: 'notfound', replace: 'replacement' },
        context
      );

      expect(result.replaced).toBe(0);
    });

    it('should preserve original content in result', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'original content', 'utf-8');

      const result = await FileReplaceTool.execute(
        { path: 'test.txt', search: 'original', replace: 'modified' },
        context
      );

      expect(result.originalContent).toBe('original content');
      expect(result.newContent).toBe('modified content');
    });

    it('should reject replace outside workspace', async () => {
      await expect(
        FileReplaceTool.execute(
          { path: '/etc/passwd', search: 'root', replace: 'admin' },
          context
        )
      ).rejects.toThrow('Path validation failed');
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        FileReplaceTool.execute(
          { path: 'nonexistent.txt', search: 'old', replace: 'new' },
          context
        )
      ).rejects.toThrow('FILE_NOT_FOUND');
    });

    it('should throw error for directory', async () => {
      await fs.promises.mkdir(path.join(tempDir, 'testdir'));

      await expect(
        FileReplaceTool.execute(
          { path: 'testdir', search: 'old', replace: 'new' },
          context
        )
      ).rejects.toThrow('IS_DIRECTORY');
    });

    it('should handle special regex characters in search', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'price: $100.00', 'utf-8');

      const result = await FileReplaceTool.execute(
        { path: 'test.txt', search: '$100.00', replace: '$150.00' },
        context
      );

      expect(result.replaced).toBe(1);

      const content = await fs.promises.readFile(testFile, 'utf-8');
      expect(content).toBe('price: $150.00');
    });

    it('should reject empty search pattern', async () => {
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'abc', 'utf-8');

      await expect(
        FileReplaceTool.execute(
          { path: 'test.txt', search: '', replace: 'X' },
          context
        )
      ).rejects.toThrow('INVALID_INPUT');
    });
  });

  describe('FileListTool', () => {
    beforeEach(async () => {
      await fs.promises.mkdir(path.join(tempDir, 'subdir'), { recursive: true });
      await fs.promises.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
      await fs.promises.writeFile(path.join(tempDir, 'file2.txt'), 'content2');
      await fs.promises.writeFile(path.join(tempDir, 'subdir', 'nested.txt'), 'nested');
    });

    it('should list directory contents', async () => {
      const result = await FileListTool.execute({}, context);

      expect(result.total).toBe(3); // 2 files + 1 directory
      expect(result.entries.some((e) => e.name === 'file1.txt' && e.type === 'file')).toBe(true);
      expect(result.entries.some((e) => e.name === 'file2.txt' && e.type === 'file')).toBe(true);
      expect(result.entries.some((e) => e.name === 'subdir' && e.type === 'directory')).toBe(true);
    });

    it('should list specific directory', async () => {
      const result = await FileListTool.execute({ path: 'subdir' }, context);

      expect(result.total).toBe(1);
      expect(result.entries[0].name).toBe('nested.txt');
    });

    it('should list recursively', async () => {
      const result = await FileListTool.execute({ recursive: true }, context);

      const paths = result.entries.map((e) => e.path);
      expect(paths.some((p) => p.includes('file1.txt'))).toBe(true);
      expect(paths.some((p) => p.includes('nested.txt'))).toBe(true);
    });

    it('should include file sizes', async () => {
      const result = await FileListTool.execute({}, context);

      const file1 = result.entries.find((e) => e.name === 'file1.txt');
      expect(file1?.size).toBe(8); // 'content1'.length
    });

    it('should include modification times', async () => {
      const result = await FileListTool.execute({}, context);

      const file1 = result.entries.find((e) => e.name === 'file1.txt');
      expect(file1?.modifiedAt).toBeInstanceOf(Date);
    });

    it('should reject listing outside workspace', async () => {
      await expect(
        FileListTool.execute({ path: '/etc' }, context)
      ).rejects.toThrow('Path validation failed');
    });

    it('should throw error for non-existent directory', async () => {
      await expect(
        FileListTool.execute({ path: 'nonexistent' }, context)
      ).rejects.toThrow();
    });

    it('should throw error when path is a file', async () => {
      await expect(
        FileListTool.execute({ path: 'file1.txt' }, context)
      ).rejects.toThrow('NOT_A_DIRECTORY');
    });

    it('should filter by pattern when recursive', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'file.js'), 'js content');

      const result = await FileListTool.execute(
        { recursive: true, pattern: '**/*.txt' },
        context
      );

      expect(result.entries.every((e) => e.name.endsWith('.txt'))).toBe(true);
    });
  });

  describe('Security - Negative Tests', () => {
    it('should block all file operations outside workspace', async () => {
      const maliciousPaths = [
        '/etc/passwd',
        '/etc/shadow',
        '~/.ssh/id_rsa',
        '../../../etc/passwd',
        '/proc/self/environ',
      ];

      for (const maliciousPath of maliciousPaths) {
        await expect(
          FileReadTool.execute({ path: maliciousPath }, context)
        ).rejects.toThrow('Path validation failed');

        await expect(
          FileWriteTool.execute({ path: maliciousPath, content: 'evil' }, context)
        ).rejects.toThrow('Path validation failed');

        await expect(
          FileSearchTool.execute({ pattern: '*', path: maliciousPath }, context)
        ).rejects.toThrow('Path validation failed');

        await expect(
          FileReplaceTool.execute(
            { path: maliciousPath, search: 'old', replace: 'new' },
            context
          )
        ).rejects.toThrow('Path validation failed');

        await expect(
          FileListTool.execute({ path: maliciousPath }, context)
        ).rejects.toThrow('Path validation failed');
      }
    });

    it('should block symlink traversal attacks', async () => {
      const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'outside-'));
      const secretFile = path.join(outsideDir, 'secret.txt');
      await fs.promises.writeFile(secretFile, 'secret content');

      try {
        // Create symlink pointing outside workspace
        await fs.promises.symlink(secretFile, path.join(tempDir, 'link-to-secret'));

        await expect(
          FileReadTool.execute({ path: 'link-to-secret' }, context)
        ).rejects.toThrow('Path validation failed');
      } finally {
        await fs.promises.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('should block null byte injection', async () => {
      await expect(
        FileReadTool.execute({ path: 'file\0.txt' }, context)
      ).rejects.toThrow('Path validation failed');
    });
  });
});

describe('Toolkit Integration', () => {
  it('should export all file tools', () => {
    expect(FileReadTool.name).toBe('file_read');
    expect(FileWriteTool.name).toBe('file_write');
    expect(FileSearchTool.name).toBe('file_search');
    expect(FileReplaceTool.name).toBe('file_replace');
    expect(FileListTool.name).toBe('file_list');
  });
});
