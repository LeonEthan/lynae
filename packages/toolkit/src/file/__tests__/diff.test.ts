import { describe, it, expect } from 'vitest';
import { generateDiff, formatUnifiedDiff, generateDiffStats } from '../diff.js';

describe('Diff Generation', () => {
  describe('generateDiff', () => {
    it('should generate diff for new file', () => {
      const newContent = 'line1\nline2\nline3';
      const diff = generateDiff(null, newContent);

      expect(diff.additions).toBe(3);
      expect(diff.deletions).toBe(0);
      expect(diff.changes).toBe(0);
      expect(diff.totalLines).toBe(3);
      expect(diff.hunks.length).toBeGreaterThan(0);
    });

    it('should generate diff for deleted file', () => {
      const originalContent = 'line1\nline2\nline3';
      const diff = generateDiff(originalContent, '');

      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(3);
      expect(diff.changes).toBe(0);
      expect(diff.totalLines).toBe(0);
    });

    it('should generate diff for modified file', () => {
      const originalContent = 'line1\nline2\nline3';
      const newContent = 'line1\nmodified\nline3';
      const diff = generateDiff(originalContent, newContent);

      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(1);
      expect(diff.totalLines).toBe(3);
    });

    it('should handle unchanged content', () => {
      const content = 'line1\nline2\nline3';
      const diff = generateDiff(content, content);

      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(0);
      expect(diff.changes).toBe(0);
      expect(diff.totalLines).toBe(3);
    });

    it('should handle empty original content', () => {
      const diff = generateDiff('', 'new line');

      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(0);
    });

    it('should handle empty new content', () => {
      const diff = generateDiff('old line', '');

      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(1);
    });

    it('should handle trailing newlines correctly', () => {
      const original = 'line1\nline2\n';
      const modified = 'line1\nline2\n';
      const diff = generateDiff(original, modified);

      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(0);
    });

    it('should handle multiple additions', () => {
      const original = 'line1';
      const modified = 'line1\nline2\nline3';
      const diff = generateDiff(original, modified);

      expect(diff.additions).toBe(2);
      expect(diff.deletions).toBe(0);
    });

    it('should handle multiple deletions', () => {
      const original = 'line1\nline2\nline3';
      const modified = 'line1';
      const diff = generateDiff(original, modified);

      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(2);
    });

    it('should handle complex diff with multiple hunks', () => {
      const original = `line1
line2
line3
line4
line5
line6
line7
line8
line9
line10`;

      const modified = `line1
modified2
line3
line4
line5
modified6
line7
line8
line9
modified10`;

      const diff = generateDiff(original, modified);

      expect(diff.additions).toBe(3);
      expect(diff.deletions).toBe(3);
      expect(diff.totalLines).toBe(10);
    });

    it('should provide detailed hunks', () => {
      const original = 'line1\nline2\nline3';
      const modified = 'line1\nmodified\nline3';
      const diff = generateDiff(original, modified);

      expect(diff.hunks.length).toBeGreaterThan(0);
      const hunk = diff.hunks[0];
      expect(hunk.lines.length).toBeGreaterThan(0);

      // Check that we have removed, added, and unchanged lines
      const removedLine = hunk.lines.find((l) => l.type === 'removed');
      const addedLine = hunk.lines.find((l) => l.type === 'added');
      const unchangedLine = hunk.lines.find((l) => l.type === 'unchanged');

      expect(removedLine).toBeDefined();
      expect(addedLine).toBeDefined();
      expect(unchangedLine).toBeDefined();

      if (removedLine) {
        expect(removedLine.content).toBe('line2');
        expect(removedLine.lineNumber.old).toBe(2);
      }

      if (addedLine) {
        expect(addedLine.content).toBe('modified');
        expect(addedLine.lineNumber.new).toBe(2);
      }
    });

    it('should handle completely different files', () => {
      const original = 'old content here';
      const modified = 'completely new\ncontent here\nwith more lines';
      const diff = generateDiff(original, modified);

      expect(diff.additions).toBe(3);
      expect(diff.deletions).toBe(1);
      expect(diff.totalLines).toBe(3);
    });

    it('should handle single line changes', () => {
      const original = 'hello world';
      const modified = 'hello universe';
      const diff = generateDiff(original, modified);

      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(1);
    });

    it('should calculate hunk line numbers correctly', () => {
      const original = `line1
line2
line3
line4
line5`;

      const modified = `line1
modified
line3
line4
line5`;

      const diff = generateDiff(original, modified);
      expect(diff.hunks.length).toBe(1);

      const hunk = diff.hunks[0];
      expect(hunk.oldStart).toBe(1); // Should start from line 1 with context
      expect(hunk.newStart).toBe(1);
    });
  });

  describe('formatUnifiedDiff', () => {
    it('should format diff in unified format', () => {
      const original = 'line1\nline2';
      const modified = 'line1\nmodified';

      const formatted = formatUnifiedDiff(original, modified, {
        originalPath: 'a/file.txt',
        newPath: 'b/file.txt',
      });

      expect(formatted).toContain('--- a/file.txt');
      expect(formatted).toContain('+++ b/file.txt');
      expect(formatted).toContain('-line2');
      expect(formatted).toContain('+modified');
    });

    it('should return empty string for identical content', () => {
      const content = 'line1\nline2';
      const formatted = formatUnifiedDiff(content, content);

      expect(formatted).toBe('');
    });

    it('should use default paths', () => {
      const original = 'old';
      const modified = 'new';

      const formatted = formatUnifiedDiff(original, modified);

      expect(formatted).toContain('--- a/file');
      expect(formatted).toContain('+++ b/file');
    });

    it('should include hunk headers', () => {
      const original = 'line1\nline2\nline3';
      const modified = 'line1\nmodified\nline3';

      const formatted = formatUnifiedDiff(original, modified);

      expect(formatted).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    });
  });

  describe('generateDiffStats', () => {
    it('should return stats without hunks', () => {
      const original = 'line1\nline2';
      const modified = 'line1\nmodified';

      const stats = generateDiffStats(original, modified);

      expect(stats.additions).toBe(1);
      expect(stats.deletions).toBe(1);
      expect(stats.totalLines).toBe(2);
      expect('hunks' in stats).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle both empty inputs', () => {
      const diff = generateDiff('', '');

      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(0);
      expect(diff.totalLines).toBe(0);
    });

    it('should handle whitespace-only changes', () => {
      const original = 'line1\nline2';
      const modified = 'line1 \nline2';

      const diff = generateDiff(original, modified);
      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(1);
    });

    it('should handle tab characters', () => {
      const original = 'line1\n\tindented';
      const modified = 'line1\n  indented';

      const diff = generateDiff(original, modified);
      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(1);
    });

    it('should handle very long lines', () => {
      const longLine = 'x'.repeat(10000);
      const diff = generateDiff('short', longLine);

      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(1);
    });

    it('should handle many lines', () => {
      const lines = Array(1000).fill('line content');
      const original = lines.join('\n');
      const modified = lines.map((l, i) => (i % 10 === 0 ? `modified ${i}` : l)).join('\n');

      const diff = generateDiff(original, modified);

      expect(diff.additions).toBe(100);
      expect(diff.deletions).toBe(100);
    });

    it('should report zero changes for large identical files', () => {
      // Create large identical files (>5000 lines triggers fast path)
      const lines = Array(6001).fill('same content');
      const content = lines.join('\n');

      const diff = generateDiff(content, content);

      // For identical files, even large ones, changes should be 0
      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(0);
      expect(diff.changes).toBe(0);
      expect(diff.hunks).toHaveLength(0);
    });

    it('should indicate modifications for large files with same line count but different content', () => {
      // Create large files (>5000 lines) with same line count but different content
      const originalLines = Array(6001).fill('line content');
      const modifiedLines = Array(6001).fill('modified content');
      const original = originalLines.join('\n');
      const modified = modifiedLines.join('\n');

      const diff = generateDiff(original, modified);

      // Line counts are equal, so no net additions/deletions
      expect(diff.additions).toBe(0);
      expect(diff.deletions).toBe(0);
      // But changes should be -1 to indicate "modified but count unknown"
      expect(diff.changes).toBe(-1);
      expect(diff.hunks).toHaveLength(0);
    });
  });
});
