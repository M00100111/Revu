import type { Chunk, ChunkKind, ReviewRecord } from './types';

export function chunkKind(oldText: string, newText: string): ChunkKind {
  return oldText ? (newText ? 'modify' : 'delete') : 'add';
}

// Git hunk coordinates are one-based except an empty side denotes an insertion boundary.
// Take exact text from the snapshots rather than reconstructing it from patch lines.
export function parsePatch(patch: string, before: string, after: string): Chunk[] {
  const offsets = (text: string) => {
    const result = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') result.push(i + 1);
    return result;
  };
  const a = offsets(before), b = offsets(after);
  return [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match, index) => {
    const oldCount = Number(match[2] ?? 1), count = Number(match[4] ?? 1);
    const oldLine = Number(match[1]) - (oldCount ? 1 : 0);
    const line = Number(match[3]) - (count ? 1 : 0);
    const oldStart = a[oldLine] ?? before.length, oldEnd = a[oldLine + oldCount] ?? before.length;
    const start = b[line] ?? after.length, end = b[line + count] ?? after.length;
    const oldText = before.slice(oldStart, oldEnd), newText = after.slice(start, end);
    return { id: String(index), kind:chunkKind(oldText,newText), oldStart, oldEnd, start, end,
      oldText, newText, line: line + 1 };
  });
}

export function replaceExact(text: string, start: number, end: number, expected: string, replacement: string) {
  if (start < 0 || end < start || end > text.length || text.slice(start, end) !== expected) {
    throw new Error('The code changed. Wait for the review to refresh.');
  }
  return text.slice(0, start) + replacement + text.slice(end);
}

// Only map through disjoint changes. Never search for matching text elsewhere.
export function mapRange(start: number, end: number, changes: Chunk[]) {
  let delta = 0;
  for (const change of changes) {
    const a = change.oldStart, b = change.oldEnd;
    const overlap = a === b ? a >= start && a <= end
      : start === end ? a <= start && b >= start : a < end && b > start;
    if (overlap) return null;
    if (b <= start) delta += change.end - change.start - (b - a);
  }
  return { start: start + delta, end: end + delta };
}

export function reconcile(records: ReviewRecord[], chunks: Chunk[], changes: Chunk[], text: string) {
  const next = records.map(record => {
    if (record.stale) return record;
    const range = mapRange(record.start, record.end, changes);
    const expected = record.decision === 'accepted' ? record.newText : record.oldText;
    if (!range || text.slice(range.start, range.end) !== expected) return { ...record, stale: true };
    const matches = chunks.filter(chunk => chunk.oldStart === record.oldStart &&
      chunk.oldEnd === record.oldEnd && chunk.oldText === record.oldText &&
      chunk.newText === record.newText && chunk.start === range.start && chunk.end === range.end);
    if (record.decision === 'accepted' && matches.length !== 1) return { ...record, ...range, stale: true };
    return { ...record, ...range, line: text.slice(0, range.start).split('\n').length };
  });
  const pending = chunks.filter(chunk => !next.some(record => !record.stale &&
    record.decision === 'accepted' && record.oldStart === chunk.oldStart &&
    record.oldEnd === chunk.oldEnd && record.start === chunk.start && record.newText === chunk.newText));
  return { records: next, chunks: pending };
}
