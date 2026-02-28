// Diff Utility - Generate diff summaries for file modifications

/**
 * Represents a single hunk in a diff
 */
export interface DiffHunk {
  oldStart: number; // Starting line number in original file
  oldLines: number; // Number of lines in original file
  newStart: number; // Starting line number in new file
  newLines: number; // Number of lines in new file
  lines: DiffLine[]; // Individual diff lines
}

/**
 * Represents a single line in a diff hunk
 */
export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: {
    old?: number;
    new?: number;
  };
}

/**
 * Summary of changes between two file versions
 */
export interface DiffSummary {
  additions: number; // Lines added
  deletions: number; // Lines removed
  changes: number; // Lines changed (modified)
  totalLines: number; // Total lines in new file
  hunks: DiffHunk[]; // Detailed hunks for preview
}

/**
 * Simple diff result for line-by-line comparison
 */
interface LineDiff {
  type: 'added' | 'removed' | 'unchanged';
  oldIndex: number | null;
  newIndex: number | null;
  content: string;
}

/**
 * Computes a simple line-based diff between two strings
 * Uses a simplified Myers diff algorithm
 */
function computeLineDiff(originalLines: string[], newLines: string[]): LineDiff[] {
  const result: LineDiff[] = [];
  const m = originalLines.length;
  const n = newLines.length;

  // Handle edge cases
  if (m === 0 && n === 0) {
    return [];
  }

  if (m === 0) {
    return newLines.map((content, i) => ({
      type: 'added' as const,
      oldIndex: null,
      newIndex: i,
      content,
    }));
  }

  if (n === 0) {
    return originalLines.map((content, i) => ({
      type: 'removed' as const,
      oldIndex: i,
      newIndex: null,
      content,
    }));
  }

  // Build LCS (Longest Common Subsequence) matrix
  // NOTE: This uses O(N*M) memory. Callers should check file size before calling.
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the diff
  let i = m;
  let j = n;
  const diff: LineDiff[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1] === newLines[j - 1]) {
      // Lines are the same
      diff.unshift({
        type: 'unchanged',
        oldIndex: i - 1,
        newIndex: j - 1,
        content: originalLines[i - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Line was added
      diff.unshift({
        type: 'added',
        oldIndex: null,
        newIndex: j - 1,
        content: newLines[j - 1],
      });
      j--;
    } else {
      // Line was removed
      diff.unshift({
        type: 'removed',
        oldIndex: i - 1,
        newIndex: null,
        content: originalLines[i - 1],
      });
      i--;
    }
  }

  return diff;
}

/**
 * Groups consecutive line changes into hunks
 */
function groupIntoHunks(lineDiffs: LineDiff[], contextLines = 3): DiffHunk[] {
  if (lineDiffs.length === 0) {
    return [];
  }

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let lastChangeIndex = -1;

  for (let i = 0; i < lineDiffs.length; i++) {
    const line = lineDiffs[i];
    const isChange = line.type !== 'unchanged';

    // Determine if we should start a new hunk
    if (isChange) {
      const withinContext = lastChangeIndex >= 0 && i - lastChangeIndex <= contextLines * 2;

      if (!currentHunk || !withinContext) {
        // Start new hunk
        if (currentHunk) {
          hunks.push(currentHunk);
        }

        const contextStart = Math.max(0, i - contextLines);
        currentHunk = {
          oldStart: (lineDiffs[contextStart].oldIndex ?? 0) + 1,
          oldLines: 0,
          newStart: (lineDiffs[contextStart].newIndex ?? 0) + 1,
          newLines: 0,
          lines: [],
        };
      }

      lastChangeIndex = i;
    }

    // Add line to current hunk if we're within context of a change
    if (currentHunk) {
      const withinContextOfLastChange =
        lastChangeIndex >= 0 && i <= lastChangeIndex + contextLines;

      if (isChange || withinContextOfLastChange) {
        currentHunk.lines.push({
          type: line.type,
          content: line.content,
          lineNumber: {
            old: line.oldIndex !== null ? line.oldIndex + 1 : undefined,
            new: line.newIndex !== null ? line.newIndex + 1 : undefined,
          },
        });

        if (line.type !== 'added') {
          currentHunk.oldLines++;
        }
        if (line.type !== 'removed') {
          currentHunk.newLines++;
        }
      }

      // Check if we should end this hunk
      if (i > lastChangeIndex + contextLines) {
        hunks.push(currentHunk);
        currentHunk = null;
        lastChangeIndex = -1;
      }
    }
  }

  // Don't forget the last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Generates a diff summary between original and new content
 *
 * @param originalContent - The original file content (null if file is new)
 * @param newContent - The new file content
 * @returns DiffSummary with statistics and detailed hunks
 */
export function generateDiff(
  originalContent: string | null,
  newContent: string
): DiffSummary {
  // Split content into lines, handling empty strings
  const originalLines = originalContent === null || originalContent === ''
    ? []
    : originalContent.split('\n');
  const newLines = newContent === ''
    ? []
    : newContent.split('\n');

  // Handle trailing newlines
  if (originalContent !== null && originalContent.endsWith('\n') && originalLines.length > 0 && originalLines[originalLines.length - 1] === '') {
    originalLines.pop();
  }
  if (newContent.endsWith('\n') && newLines.length > 0 && newLines[newLines.length - 1] === '') {
    newLines.pop();
  }

  // Skip detailed diff for very large files to avoid O(N*M) memory explosion
  // For a 10,000 line file, the matrix would be ~400MB
  const MAX_DIFF_LINES = 5000;
  const skipDetailedDiff = originalLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES;

  // Compute line-by-line diff (unless file is too large)
  const lineDiffs = skipDetailedDiff ? [] : computeLineDiff(originalLines, newLines);

  // Count statistics
  let additions = 0;
  let deletions = 0;
  let changes = 0;

  if (skipDetailedDiff) {
    // For large files, estimate changes by comparing total lines
    // This is a rough estimate but avoids O(N*M) memory
    additions = Math.max(0, newLines.length - originalLines.length);
    deletions = Math.max(0, originalLines.length - newLines.length);
    changes = Math.min(originalLines.length, newLines.length);
  } else {
    // Detect changed lines (adjacent add/remove pairs)
    for (let i = 0; i < lineDiffs.length; i++) {
      const line = lineDiffs[i];
      if (line.type === 'added') {
        additions++;
      } else if (line.type === 'removed') {
        deletions++;
      }
    }

    // Calculate changes (min of additions and deletions, representing replaced lines)
    // This is a simplified heuristic
    changes = Math.min(additions, deletions);
  }

  // Group into hunks (empty for large files)
  const hunks = skipDetailedDiff ? [] : groupIntoHunks(lineDiffs);

  return {
    additions,
    deletions,
    changes,
    totalLines: newLines.length,
    hunks,
  };
}

/**
 * Generates a unified diff format string (similar to git diff)
 */
export function formatUnifiedDiff(
  originalContent: string | null,
  newContent: string,
  options: {
    originalPath?: string;
    newPath?: string;
    contextLines?: number;
  } = {}
): string {
  const { originalPath = 'a/file', newPath = 'b/file', contextLines = 3 } = options;

  const diff = generateDiff(originalContent, newContent);

  if (diff.hunks.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(`--- ${originalPath}`);
  lines.push(`+++ ${newPath}`);

  for (const hunk of diff.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    );

    for (const line of hunk.lines) {
      const prefix =
        line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      lines.push(`${prefix}${line.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * Quick summary without detailed hunks (for performance when details not needed)
 */
export function generateDiffStats(
  originalContent: string | null,
  newContent: string
): Omit<DiffSummary, 'hunks'> {
  const full = generateDiff(originalContent, newContent);
  return {
    additions: full.additions,
    deletions: full.deletions,
    changes: full.changes,
    totalLines: full.totalLines,
  };
}
