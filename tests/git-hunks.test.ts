import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHunks } from '../src/git.js';

test('Git hunk parser preserves explicit zero counts and omitted one-line counts', () => {
  const patch = 'diff --git a/example.txt b/example.txt\n--- /dev/null\n+++ b/example.txt\n@@ -0,0 +1,2 @@\n+first\n+\n@@ -12 +23 @@ context is not source\n-old\n+new\n';
  const hunks = parseGitHunks('example.txt', patch);
  assert.equal(hunks.length, 2);
  assert.deepEqual({ oldStart: hunks[0]!.oldStart, oldLines: hunks[0]!.oldLines, newStart: hunks[0]!.newStart, newLines: hunks[0]!.newLines }, { oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 });
  assert.deepEqual(hunks[0]!.lines, [{ kind: 'add', text: 'first', newLine: 1 }, { kind: 'add', text: '', newLine: 2 }]);
  assert.equal(hunks[1]!.oldLines, 1);
  assert.equal(hunks[1]!.newLines, 1);
  assert.deepEqual(hunks[1]!.lines, [{ kind: 'remove', text: 'old', oldLine: 12 }, { kind: 'add', text: 'new', newLine: 23 }]);
});

test('no-final-newline flags consume no source lines and header-like source stays literal', () => {
  const patch = '--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@ <script>hostile header suffix</script>\n --- a/fake-file\n-@@ -99 +99 @@ forged source header\n\\ No newline at end of file\n+@@ -88 +88 @@ replacement source header\n\\ No newline at end of file\n +++ b/fake-file\ndiff --git a/next.txt b/next.txt\n--- a/next.txt\n+++ b/next.txt\n';
  const hunks = parseGitHunks('a.txt', patch);
  assert.equal(hunks.length, 1);
  assert.deepEqual(hunks[0]!.lines, [
    { kind: 'context', text: '--- a/fake-file', oldLine: 1, newLine: 1 },
    { kind: 'remove', text: '@@ -99 +99 @@ forged source header', oldLine: 2 },
    { kind: 'add', text: '@@ -88 +88 @@ replacement source header', newLine: 2 },
    { kind: 'context', text: '+++ b/fake-file', oldLine: 3, newLine: 3 },
  ]);
  assert.equal(hunks[0]!.lines.some(line => line.text.includes('hostile header suffix')), false);
});

test('deletion to an empty file preserves a zero-length head range', () => {
  const hunks = parseGitHunks('deleted.txt', '@@ -1,2 +0,0 @@\n-first\n-second\n\\ No newline at end of file\n');
  assert.equal(hunks[0]!.newStart, 0);
  assert.equal(hunks[0]!.newLines, 0);
  assert.deepEqual(hunks[0]!.lines, [{ kind: 'remove', text: 'first', oldLine: 1 }, { kind: 'remove', text: 'second', oldLine: 2 }]);
});
