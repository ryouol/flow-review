import test from 'node:test';
import assert from 'node:assert/strict';
import { codeDiff } from '../src/web/diff.js';

test('display diff preserves source-side line numbers after insertion and deletion', () => {
  const result = codeDiff(
    { path: 'a.ts', startLine: 10, endLine: 12, text: 'same\ndeleted\nlast' },
    { path: 'a.ts', startLine: 20, endLine: 22, text: 'same\nadded\nlast' },
  );
  assert.deepEqual(result, [
    { kind: 'context', text: 'same', oldLine: 10, newLine: 20 },
    { kind: 'remove', text: 'deleted', oldLine: 11 },
    { kind: 'add', text: 'added', newLine: 21 },
    { kind: 'context', text: 'last', oldLine: 12, newLine: 22 },
  ]);
});

test('bounded display algorithm preserves every source line for large changed interiors', () => {
  const old = ['prefix', ...Array.from({ length: 800 }, (_, i) => `OLD ${i}`), 'suffix'];
  const next = ['prefix', ...Array.from({ length: 800 }, (_, i) => `NEW ${i}`), 'suffix'];
  const result = codeDiff({ path: 'a.ts', startLine: 1, endLine: old.length, text: old.join('\n') }, { path: 'a.ts', startLine: 1, endLine: next.length, text: next.join('\n') });
  assert.deepEqual(result.filter(l => l.oldLine !== undefined).map(l => l.text), old);
  assert.deepEqual(result.filter(l => l.newLine !== undefined).map(l => l.text), next);
  assert.deepEqual(result.filter(l => l.oldLine !== undefined).map(l => l.oldLine), Array.from({ length: old.length }, (_, i) => i + 1));
  assert.deepEqual(result.filter(l => l.newLine !== undefined).map(l => l.newLine), Array.from({ length: next.length }, (_, i) => i + 1));
});
