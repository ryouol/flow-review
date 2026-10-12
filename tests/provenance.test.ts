import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshots } from '../src/analyzer.js';
import { validateReport } from '../src/validate.js';

test('CR and Unicode separators use original LF-only Git line coordinates', () => {
  for (const separator of ['\r', '\u2028', '\u2029']) {
    const before = `export function target() { return 1; }${separator}export function entry() {${separator}  return target();${separator}}\n`;
    const report = analyzeSnapshots({ 'main.ts': before }, { 'main.ts': before.replace('return 1', 'return 2') });
    const target = report.units.find(unit => unit.name === 'target')!;
    const entry = report.units.find(unit => unit.name === 'entry')!;
    for (const side of ['base', 'head'] as const) {
      assert.equal(target[side]!.startLine, 1);
      assert.equal(target[side]!.endLine, 1);
      assert.equal(entry[side]!.startLine, 1);
      assert.equal(entry[side]!.endLine, 1);
      assert.ok(entry[side]!.text.includes(separator));
      const call = report.links.find(link => link.from === entry.id && link.to === target.id && link.side === side)!;
      assert.equal(call.line, 1, 'JavaScript line separators cannot invent separate Git source lines');
    }
    assert.ok(report.edits.every(edit => edit.line === 1));
    assert.equal(validateReport(report).id, report.id);
  }
});

test('one changed LF line shared by sibling functions has a residual file owner', () => {
  const before = 'export function first() { return 1; } export function second() { return 10; }\n';
  const after = 'export function first() { return 2; } export function second() { return 20; }\n';
  const report = analyzeSnapshots({ 'main.ts': before }, { 'main.ts': after });
  assert.equal(report.edits.length, 2);
  for (const edit of report.edits) {
    const owner = report.units.find(unit => unit.id === edit.unitId)!;
    assert.equal(owner.kind, 'file', 'Reading one sibling must not credit the whole edited line');
    assert.equal(edit.line, 1);
    assert.ok(owner[edit.side]!.text.includes('function first'));
    assert.ok(owner[edit.side]!.text.includes('function second'));
  }
  assert.equal(new Set(report.edits.map(edit => edit.unitId)).size, 1);
  assert.equal(validateReport(report).id, report.id);
});

test('contract uncertainty is explicit for any, unknown and unloaded external returns', () => {
  const before = 'import { external } from "unavailable-package";\nexport function fromExternal() { return external(); }\nexport function opaque(value: any) { return value; }\nexport function unknownValue(value: unknown) { return value; }\nexport function precise(): number { return 1; }\n';
  const report = analyzeSnapshots({ 'main.ts': before }, { 'main.ts': before.replace('return 1', 'return 2') });
  for (const name of ['fromExternal', 'opaque', 'unknownValue']) {
    const unit = report.units.find(unit => unit.name === name)!;
    for (const side of ['base', 'head'] as const) assert.equal(unit.contract![side]!.unknown, true, `${name} must disclose unavailable type precision`);
  }
  const precise = report.units.find(unit => unit.name === 'precise')!;
  assert.equal(precise.contract!.base!.unknown, false);
  assert.equal(precise.contract!.head!.unknown, false);
});

test('analysis provenance records compiler, tool and effective snapshot null checking', () => {
  const source = 'export function lookup(value: boolean) { return value ? "ok" : null; }\n';
  const report = analyzeSnapshots({ 'tsconfig.json': '{"compilerOptions":{"strictNullChecks":false}}', 'main.ts': source }, { 'tsconfig.json': '{"compilerOptions":{"strictNullChecks":true}}', 'main.ts': source });
  assert.equal(report.analysis.baseStrictNullChecks, false);
  assert.equal(report.analysis.headStrictNullChecks, true);
  assert.match(report.analysis.toolVersion, /\d+\.\d+/);
  assert.match(report.analysis.typescriptVersion, /\d+\.\d+/);
  assert.ok(report.analysis.scope, 'Report must describe analysis limits');
  assert.equal(validateReport(report).id, report.id);
});
