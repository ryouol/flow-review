import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshots } from '../src/analyzer.js';
import { validateReport } from '../src/validate.js';
import type { Report } from '../src/model.js';

function partitionFixture(): Report {
  const base = {
    'dep.ts': 'export function dep() { return 1; }\n',
    'main.ts': 'import { dep } from "./dep";\nconst policy = 1;\nexport function outer(n: number) {\n  function inner(value: number) {\n    return value + 1;\n  }\n  return inner(n);\n}\nexport function other() { return dep(); }\n',
  };
  const head = { ...base, 'main.ts': 'import { dep as selected } from "./dep";\nconst policy = 2;\nexport function outer(n: number) {\n  function inner(value: number) {\n    return value + 2;\n  }\n  return inner(n + 1);\n}\nexport function other() { return selected(); }\n' };
  return analyzeSnapshots(base, head);
}

const key = (edit: { fileId: string; hunkId: string; side: string; line: number }) => `${edit.fileId}:${edit.hunkId}:${edit.side}:${edit.line}`;

test('edited-line ownership is an exact partition even when one hunk spans nested functions', () => {
  const report = partitionFixture();
  const expected = report.files.flatMap(file => file.hunks.flatMap(hunk => hunk.lines.filter(line => line.kind !== 'context').map(line => ({ fileId: file.id, hunkId: hunk.id, side: line.kind === 'remove' ? 'base' : 'head', line: (line.kind === 'remove' ? line.oldLine : line.newLine)!, text: line.text }))));
  assert.equal(report.files[0]!.hunks.length, 1, 'Adjacent declaration and import edits share one hunk');
  assert.equal(report.edits.length, expected.length);
  assert.equal(new Set(report.edits.map(key)).size, report.edits.length);
  assert.equal(new Set(report.edits.map(edit => edit.id)).size, report.edits.length);
  assert.deepEqual(report.edits.map(key).sort(), expected.map(key).sort());
  for (const edit of report.edits) {
    assert.equal(edit.text, expected.find(row => key(row) === key(edit))!.text);
    const owner = report.units.find(unit => unit.id === edit.unitId)!;
    assert.ok(owner, 'Every edit has one known canonical owner');
    if (edit.text.includes('return value +')) assert.equal(owner.name, 'outer.inner', 'Nested body belongs to the innermost declaration');
    if (edit.text.includes('return inner(')) assert.equal(owner.name, 'outer');
    if (edit.text.startsWith('import ') || edit.text.startsWith('const policy')) assert.equal(owner.kind, 'file', 'Imports and file policy must not count as function body edits');
    if (edit.text.includes('function other')) assert.equal(owner.name, 'other');
  }
  assert.equal(validateReport(report).id, report.id);
});

test('deleted-side lines keep deleted declaration ownership and additions own only head lines', () => {
  const report = analyzeSnapshots({ 'main.ts': 'export function kept() { return 1; }\nexport function removed() { return kept(); }\n' }, { 'main.ts': 'export function kept() { return 2; }\n' });
  const removed = report.units.find(unit => unit.name === 'removed')!;
  const old = report.edits.filter(edit => edit.unitId === removed.id);
  assert.ok(old.length > 0);
  assert.ok(old.every(edit => edit.side === 'base'));
  assert.ok(report.edits.some(edit => edit.side === 'head' && edit.text.includes('return 2')));
  assert.equal(report.edits.length, report.files.reduce((total, file) => total + file.additions + file.deletions, 0));
});

test('same-line nested declarations use innermost ownership rather than hash ordering', () => {
  for (const name of ['outer', 'alpha', 'start', 'handler']) {
    const before = `export function ${name}() { function inner() { return 1; } return inner(); }\n`;
    const after = before.replace('return 1', 'return 2');
    const report = analyzeSnapshots({ 'main.ts': before }, { 'main.ts': after });
    const inner = report.units.find(unit => unit.name === `${name}.inner`)!;
    assert.ok(report.edits.length > 0);
    assert.ok(report.edits.every(edit => edit.unitId === inner.id), `${name}: nested source range wins equal line-span ties`);
  }
});

test('import rejects duplicate ownership, omitted changed lines and unknown owners', () => {
  const duplicate = partitionFixture();
  duplicate.edits.push({ ...duplicate.edits[0]!, id: 'different-id-same-line', unitId: duplicate.units.find(unit => unit.name === 'outer')!.id });
  assert.throws(() => validateReport(duplicate), /duplicate|ownership|edit|partition/i);
  const missing = partitionFixture();
  missing.edits.pop();
  assert.throws(() => validateReport(missing), /missing|edit|partition|count|complete/i);
  const unknown = partitionFixture();
  unknown.edits[0]!.unitId = 'unknown-unit';
  assert.throws(() => validateReport(unknown), /unknown|unit|owner|edit/i);
  const misplaced = partitionFixture();
  const innerEdit = misplaced.edits.find(edit => edit.text.includes('return value +'))!;
  innerEdit.unitId = misplaced.units.find(unit => unit.name === 'other')!.id;
  assert.throws(() => validateReport(misplaced), /source|line|owner|edit|range/i, 'An existing owner in the same hunk still needs to contain this source line');
});

test('strict null inference records nullable-to-implicit-undefined contract changes', () => {
  const base = {
    'tsconfig.json': '{"compilerOptions":{"strictNullChecks":true}}\n',
    'main.ts': 'export function lookup(found: boolean) {\n  if (found) return "ok";\n  return null;\n}\nexport function caller() { return lookup(false); }\n',
  };
  const head = { ...base, 'main.ts': 'export function lookup(found: boolean) {\n  if (found) return "ok";\n}\nexport function caller() { return lookup(false); }\n' };
  const report = analyzeSnapshots(base, head);
  const lookup = report.units.find(unit => unit.name === 'lookup')!;
  assert.equal(lookup.contract?.base?.inferred, true);
  assert.equal(lookup.contract?.head?.inferred, true);
  assert.match(lookup.contract!.base!.returnType, /null/);
  assert.match(lookup.contract!.head!.returnType, /undefined/);
  assert.match(lookup.contract!.base!.signature, /found.*boolean/);
  const caller = report.units.find(unit => unit.name === 'caller')!;
  assert.equal(caller.changed, false);
  assert.equal(caller.base!.text, caller.head!.text);
  assert.match(caller.contract!.base!.returnType, /null/);
  assert.match(caller.contract!.head!.returnType, /undefined/);
  for (const side of ['base', 'head'] as const) {
    const incoming = report.links.find(link => link.from === caller.id && link.to === lookup.id && link.side === side);
    assert.equal(incoming?.evidence, 'resolved');
    assert.equal(incoming?.expression, 'lookup');
    assert.ok(caller[side]!.text.includes(incoming!.expression));
  }
});
