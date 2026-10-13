import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshots } from '../src/analyzer.js';
import { validateReport } from '../src/validate.js';
import type { Report } from '../src/model.js';

function fixture(): Report {
  return analyzeSnapshots({
    'main.ts': 'export function target() { return 1; }\nexport function gone() { return target(); }\nexport function dynamic(fn: () => number) { return fn(); }\n',
  }, {
    'main.ts': 'export function target() { return 2; }\nexport function dynamic(fn: () => number) { return fn(); }\n',
  });
}

test('valid analyzer report survives strict untrusted-import validation', () => {
  const report = fixture();
  assert.equal(validateReport(JSON.parse(JSON.stringify(report))).id, report.id);
});

test('duplicate IDs and foreign references fail instead of silently opening wrong code', () => {
  const duplicate = fixture();
  duplicate.units.push(structuredClone(duplicate.units[0]!));
  assert.throws(() => validateReport(duplicate), /duplicate/i);
  const unknown = fixture();
  unknown.links[0]!.to = 'nonexistent-callee';
  assert.throws(() => validateReport(unknown), /unknown callee/i);
});

test('unresolved links cannot carry a navigable target', () => {
  const report = fixture();
  const unresolved = report.links.find(l => l.evidence === 'unresolved')!;
  unresolved.to = report.units.find(u => u.name === 'target')!.id;
  assert.throws(() => validateReport(report), /unresolved|target|evidence/i);
});

test('links cannot claim head provenance for base-only deleted callers', () => {
  const report = fixture();
  const gone = report.units.find(u => u.name === 'gone')!;
  const removed = report.links.find(l => l.from === gone.id)!;
  removed.side = 'head';
  assert.throws(() => validateReport(report), /side|head|snapshot|caller|provenance/i);
});

test('unresolved coverage count must agree with actual link evidence', () => {
  const report = fixture();
  report.coverage.unresolvedCalls = 0;
  assert.throws(() => validateReport(report), /coverage|unresolved|count/i);
});

test('malformed diff coordinates and unsupported schemas reject cleanly', () => {
  const report = fixture();
  report.files[0]!.hunks[0]!.lines[0]!.oldLine = -1;
  assert.throws(() => validateReport(report), /whole number|line/i);
  assert.throws(() => validateReport({ ...fixture(), schemaVersion: 999 }), /schema/i);
  assert.throws(() => validateReport(null), /object/i);
});

test('call provenance must fit its caller source and name an expression present there', () => {
  const outside = fixture();
  outside.links[0]!.line = 500;
  assert.throws(() => validateReport(outside), /line|source|range|caller|provenance/i);
  const invented = fixture();
  invented.links[0]!.expression = 'inventedFunctionNotInSource';
  assert.throws(() => validateReport(invented), /expression|source|caller|provenance/i);
});

test('diff rows require the corresponding original old/new coordinates', () => {
  for (const kind of ['add', 'remove', 'context'] as const) {
    const report = fixture();
    const rows = report.files[0]!.hunks[0]!.lines;
    const row = rows.find(l => l.kind === kind);
    assert.ok(row, `Fixture needs ${kind} row`);
    if (kind === 'add') delete row.newLine;
    else delete row.oldLine;
    assert.throws(() => validateReport(report), /line|coordinate|diff|kind/i, `${kind} without its required coordinate must fail`);
  }
  const impossible = fixture();
  const added = impossible.files[0]!.hunks[0]!.lines.find(l => l.kind === 'add')!;
  added.oldLine = 1;
  assert.throws(() => validateReport(impossible), /line|coordinate|diff|kind/i, 'An added-only row cannot also claim old source');
});

test('mapped hunk count equals the actual canonical referenced hunk union', () => {
  const report = fixture();
  assert.ok(new Set(report.units.flatMap(u => u.hunkIds)).size > 0);
  report.coverage.mappedHunks = 0;
  assert.throws(() => validateReport(report), /coverage|mapped|hunk|count/i);
});

test('imported contracts require typed fields and source on the claimed revision', () => {
  const malformed = fixture();
  const contract = malformed.units.find(unit => unit.name === 'target')!.contract!.base!;
  (contract as { returnType: unknown }).returnType = { forged: 'type' };
  assert.throws(() => validateReport(malformed), /contract|returnType|text/i);
  const absent = fixture();
  const gone = absent.units.find(unit => unit.name === 'gone')!;
  gone.contract!.head = { ...gone.contract!.base! };
  assert.throws(() => validateReport(absent), /contract|revision|source/i);
});

test('analysis provenance and explicit contract uncertainty are mandatory on import', () => {
  assert.throws(() => validateReport({ ...fixture(), analysis: undefined }), /analysis|object/i);
  const missingUncertainty = fixture();
  const contract = missingUncertainty.units.find(unit => unit.name === 'target')!.contract!.base!;
  delete (contract as { unknown?: boolean }).unknown;
  assert.throws(() => validateReport(missingUncertainty), /unknown|contract|false|true/i);
  const forgedScope = fixture();
  (forgedScope.analysis as { scope: unknown }).scope = { unavailable: true };
  assert.throws(() => validateReport(forgedScope), /scope|analysis|text/i);
});

test('imported additions and deletions must match the original hunk rows', () => {
  const additions = fixture(); additions.files[0]!.additions += 123;
  assert.throws(() => validateReport(additions), /addition|count|hunk|file/i);
  const deletions = fixture(); deletions.files[0]!.deletions += 123;
  assert.throws(() => validateReport(deletions), /deletion|count|hunk|file/i);
});

test('an imported binary marker cannot hide an existing text diff', () => {
  const report = fixture(); report.files[0]!.binary = true;
  assert.ok(report.files[0]!.hunks.length > 0);
  assert.throws(() => validateReport(report), /binary|text|hunk|file/i);
});
