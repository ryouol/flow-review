import type { CodeSide, DiffLine } from '../model.js';

const lines = (text: string) => text === '' ? [] : text.replace(/\n$/, '').split('\n');

/** A bounded line diff for display. Provenance is assigned from original snapshots. */
export function codeDiff(base?: CodeSide, head?: CodeSide): DiffLine[] {
  const old = lines(base?.text ?? ''); const next = lines(head?.text ?? '');
  const out: DiffLine[] = [];
  let oi = base?.startLine ?? 1; let ni = head?.startLine ?? 1;
  const remove = (text: string) => out.push({ kind: 'remove', text, oldLine: oi++ });
  const add = (text: string) => out.push({ kind: 'add', text, newLine: ni++ });
  const context = (text: string) => out.push({ kind: 'context', text, oldLine: oi++, newLine: ni++ });
  // Trim shared edges before LCS; large changed interiors stay exact as delete/add blocks.
  let prefix = 0; while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
  let suffix = 0; while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  for (let i = 0; i < prefix; i++) context(old[i]);
  const a = old.slice(prefix, old.length - suffix); const b = next.slice(prefix, next.length - suffix);
  if (a.length * b.length > 500_000) { a.forEach(remove); b.forEach(add); }
  else {
    const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0; let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { context(a[i++]); j++; }
      else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) remove(a[i++]);
      else add(b[j++]);
    }
  }
  for (let i = old.length - suffix; i < old.length; i++) context(old[i]);
  return out;
}
