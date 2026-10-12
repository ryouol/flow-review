import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshots } from '../src/analyzer.js';
import type { Report, Side, Unit } from '../src/model.js';

function unit(report: Report, path: string, name: string): Unit {
  const matches = report.units.filter(u => u.path === path && u.name === name);
  assert.equal(matches.length, 1, `Expected one ${path}:${name}; got ${JSON.stringify(matches)}`);
  return matches[0]!;
}

function resolved(report: Report, from: Unit, side: Side, target: Unit) {
  return report.links.find(l => l.from === from.id && l.side === side && l.to === target.id && l.evidence === 'resolved');
}

test('deleted guard and changed callee retain accurate base/head provenance', () => {
  const base = {
    'guard.ts': 'export function validate(value: number) { if (value < 0) throw new Error("invalid"); }',
    'price.ts': 'export function price(value: number) { return value * 2; }',
    'order.ts': 'import { validate } from "./guard";\nimport { price } from "./price";\nexport function submit(value: number) { validate(value); return price(value); }',
  };
  const head = { ...base, 'price.ts': 'export function price(value: number) { return value * 3; }', 'order.ts': 'import { price } from "./price";\nexport function submit(value: number) { return price(value); }' };
  const report = analyzeSnapshots(base, head);
  const submit = unit(report, 'order.ts', 'submit');
  const validate = unit(report, 'guard.ts', 'validate');
  const price = unit(report, 'price.ts', 'price');
  const oldGuard = resolved(report, submit, 'base', validate);
  assert.ok(oldGuard, 'Removed guard must remain navigable on base side');
  assert.equal(oldGuard.status, 'removed');
  assert.equal(oldGuard.line, 3);
  assert.equal(report.links.some(l => l.from === submit.id && l.side === 'head' && l.to === validate.id), false);
  assert.ok(resolved(report, submit, 'base', price));
  assert.ok(resolved(report, submit, 'head', price));
  assert.match(submit.base!.text, /validate\(value\)/);
  assert.doesNotMatch(submit.head!.text, /validate\(value\)/);
  assert.equal(price.changed, true);
});

test('imports and aliases resolve declarations rather than global name matches', () => {
  const files = {
    'a.ts': 'export function check(n: number) { return n > 0; }',
    'b.ts': 'export function check(n: number) { return n > 10; }',
    'main.ts': 'import { check as verify } from "./a";\nimport { check } from "./b";\nexport function run(n: number) { return verify(n) && check(n); }',
  };
  const report = analyzeSnapshots(files, { ...files, 'main.ts': files['main.ts'].replace('&&', '||') });
  const run = unit(report, 'main.ts', 'run');
  const a = unit(report, 'a.ts', 'check');
  const b = unit(report, 'b.ts', 'check');
  for (const side of ['base', 'head'] as const) {
    const links = report.links.filter(l => l.from === run.id && l.side === side);
    assert.equal(links.find(l => l.expression.startsWith('verify'))?.to, a.id);
    assert.equal(links.find(l => l.expression.startsWith('check'))?.to, b.id);
  }
});

test('shadowed callbacks, computed dispatch and runtime methods do not invent targets', () => {
  const base = { 'main.ts': 'function check(n: number) { return n > 0; }\nexport function run(check: (n: number) => boolean, handlers: Record<string, (n: number) => boolean>, key: string, n: number) { return check(n) && handlers[key](n); }' };
  const head = { 'main.ts': base['main.ts'].replace('n > 0', 'n >= 0').replace('&&', '||') };
  const report = analyzeSnapshots(base, head);
  const run = unit(report, 'main.ts', 'run');
  const calls = report.links.filter(l => l.from === run.id);
  assert.ok(calls.length >= 4, 'Both snapshot callback/computed calls should be accounted for');
  for (const link of calls) {
    assert.equal(link.evidence, 'unresolved', `${link.expression} is runtime dependent`);
    assert.equal(link.to, undefined);
    assert.ok(link.reason, 'Unresolved link needs an inspectable reason');
  }
});

test('static namespace import resolves while parameter namespace remains unresolved', () => {
  const base = {
    'math.ts': 'export function scale(n: number) { return n * 2; }',
    'main.ts': 'import * as math from "./math";\nexport function run(n: number, dynamic: { scale: (n: number) => number }) { return math.scale(n) + dynamic.scale(n); }',
  };
  const report = analyzeSnapshots(base, { ...base, 'math.ts': base['math.ts'].replace('* 2', '* 3') });
  const run = unit(report, 'main.ts', 'run');
  const scale = unit(report, 'math.ts', 'scale');
  for (const side of ['base', 'head'] as const) {
    assert.ok(resolved(report, run, side, scale), 'A namespace export has static declaration evidence');
    const dynamic = report.links.find(l => l.from === run.id && l.side === side && l.expression.startsWith('dynamic.scale'));
    assert.equal(dynamic?.evidence, 'unresolved');
    assert.equal(dynamic?.to, undefined);
  }
});

test('unchanged wrappers, shared callees, and recursion preserve the full navigation graph', () => {
  const base = {
    'value.ts': 'export function value(n: number): number { return n <= 0 ? 0 : value(n - 1) + 1; }',
    'wrap.ts': 'import { value } from "./value";\nexport function wrap(n: number) { return value(n); }',
    'main.ts': 'import { wrap } from "./wrap";\nimport { value } from "./value";\nexport function first(n: number) { return wrap(n); }\nexport function second(n: number) { return value(n); }',
  };
  const report = analyzeSnapshots(base, { ...base, 'value.ts': base['value.ts'].replace('+ 1', '+ 2') });
  const value = unit(report, 'value.ts', 'value');
  const wrap = unit(report, 'wrap.ts', 'wrap');
  const first = unit(report, 'main.ts', 'first');
  const second = unit(report, 'main.ts', 'second');
  assert.equal(wrap.changed, false);
  for (const side of ['base', 'head'] as const) {
    assert.ok(resolved(report, first, side, wrap));
    assert.ok(resolved(report, wrap, side, value));
    assert.ok(resolved(report, second, side, value));
    assert.ok(resolved(report, value, side, value), 'Self recursion must not hang or disappear');
  }
  assert.equal(new Set(report.units.map(u => u.id)).size, report.units.length, 'Shared callee is one canonical unit');
});

test('deleted function remains a base-only unit and every hunk is kept', () => {
  const base = { 'main.ts': 'export function kept() { return 1; }\nexport function removed() { return kept(); }\n', 'settings.json': '{"enabled":true}\n' };
  const head = { 'main.ts': 'export function kept() { return 2; }\n', 'settings.json': '{"enabled":false}\n' };
  const report = analyzeSnapshots(base, head);
  const removed = unit(report, 'main.ts', 'removed');
  assert.ok(removed.base);
  assert.equal(removed.head, undefined);
  assert.equal(removed.changed, true);
  assert.deepEqual(report.files.map(f => f.path).sort(), ['main.ts', 'settings.json']);
  assert.equal(report.coverage.changedFiles, 2);
  assert.equal(report.coverage.totalHunks, report.files.reduce((n, f) => n + f.hunks.length, 0));
  assert.ok(report.files.find(f => f.path === 'settings.json')!.hunks.some(h => h.lines.some(l => l.kind === 'add' && l.text.includes('false'))));
});

test('report identity changes with snapshot contents and stable units are unique', () => {
  const base = { 'main.ts': 'export function run() { return 1; }' };
  const a = analyzeSnapshots(base, { 'main.ts': 'export function run() { return 2; }' });
  const b = analyzeSnapshots(base, { 'main.ts': 'export function run() { return 3; }' });
  assert.notEqual(a.id, b.id, 'Review persistence must never bleed into a changed snapshot');
  assert.deepEqual(analyzeSnapshots(base, { 'main.ts': 'export function run() { return 2; }' }).units, a.units);
});

test('lexically scoped duplicate names never cross-link between enclosing functions', () => {
  const source = 'export function first() { function check() { return 1; } return check(); }\nexport function second() { function check() { return 2; } return check(); }\n';
  const report = analyzeSnapshots({ 'main.ts': source }, { 'main.ts': source.replace('return 2', 'return 3') });
  const first = unit(report, 'main.ts', 'first');
  const second = unit(report, 'main.ts', 'second');
  const firstCheck = unit(report, 'main.ts', 'first.check');
  const secondCheck = unit(report, 'main.ts', 'second.check');
  for (const side of ['base', 'head'] as const) {
    assert.ok(resolved(report, first, side, firstCheck));
    assert.ok(resolved(report, second, side, secondCheck));
    assert.equal(report.links.some(l => l.from === first.id && l.to === secondCheck.id), false);
  }
});

test('malformed TypeScript stays in inventory with explicit source-side diagnostic', () => {
  const report = analyzeSnapshots({ 'broken.ts': 'export function broken() { return 1; }\n' }, { 'broken.ts': 'export function broken( { return 2;\n' });
  assert.equal(report.files.length, 1);
  assert.ok(report.files[0]!.hunks.flatMap(h => h.lines).some(l => l.text.includes('return 2')));
  assert.ok(report.diagnostics.some(d => d.side === 'head' && d.path === 'broken.ts' && /syntax/i.test(d.message)));
  assert.equal(report.coverage.complete, true, 'Inventory completeness and symbol analysis completeness are distinct');
});

test('reassigned function binding and instance dispatch remain explicitly unresolved', () => {
  const source = 'function original() { return 1; }\nfunction replacement() { return 2; }\nlet chosen = original;\nchosen = replacement;\nclass A { run() { return 1; } }\nexport function entry(instance: A) { return chosen() + instance.run(); }\n';
  const report = analyzeSnapshots({ 'main.ts': source }, { 'main.ts': source.replace('return 2', 'return 3') });
  const entry = unit(report, 'main.ts', 'entry');
  for (const link of report.links.filter(l => l.from === entry.id)) {
    assert.equal(link.evidence, 'unresolved');
    assert.equal(link.to, undefined);
    assert.ok(link.reason);
  }
});

test('inserting a repeated call labels the inserted occurrence rather than a later retained call', () => {
  const base = { 'main.ts': 'function shared() { return 1; }\nexport function entry() {\n  shared(); // original\n}\n' };
  const head = { 'main.ts': 'function shared() { return 1; }\nexport function entry() {\n  shared(); // newly inserted\n  shared(); // original\n}\n' };
  const report = analyzeSnapshots(base, head);
  const entry = unit(report, 'main.ts', 'entry');
  const calls = report.links.filter(l => l.from === entry.id);
  assert.equal(calls.find(l => l.side === 'head' && l.line === 3)?.status, 'added');
  assert.equal(calls.find(l => l.side === 'head' && l.line === 4)?.status, 'retained');
  assert.equal(calls.find(l => l.side === 'base' && l.line === 3)?.status, 'retained');
});

test('root tsconfig paths and re-export aliases resolve actual snapshot declarations', () => {
  const files = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@logic/*': ['src/*'] } } }),
    'src/actual.ts': 'export function actual() { return 1; }\n',
    'src/barrel.ts': 'export { actual as published } from "./actual";\n',
    'src/main.ts': 'import { published as local } from "@logic/barrel";\nexport function entry() { return local(); }\n',
  };
  const report = analyzeSnapshots(files, { ...files, 'src/actual.ts': files['src/actual.ts'].replace('return 1', 'return 2') });
  const entry = unit(report, 'src/main.ts', 'entry');
  const target = unit(report, 'src/actual.ts', 'actual');
  for (const side of ['base', 'head'] as const) assert.ok(resolved(report, entry, side, target));
});

test('changing an import keeps distinct old/new targets even when caller text is identical', () => {
  const base = {
    'a.ts': 'export function shared() { return 1; }\n',
    'b.ts': 'export function shared() { return 2; }\n',
    'main.ts': 'import { shared } from "./a";\nexport function entry() { return shared(); }\n',
  };
  const report = analyzeSnapshots(base, { ...base, 'main.ts': base['main.ts'].replace('"./a"', '"./b"') });
  const entry = unit(report, 'main.ts', 'entry');
  assert.equal(resolved(report, entry, 'base', unit(report, 'a.ts', 'shared'))?.status, 'removed');
  assert.equal(resolved(report, entry, 'head', unit(report, 'b.ts', 'shared'))?.status, 'added');
  assert.ok(report.files.find(f => f.path === 'main.ts')!.hunks.some(h => h.lines.some(l => l.text.includes('./b'))));
});

test('final-newline-only edits preserve distinct complete before/after file text', () => {
  const before = 'export function run() { return 1; }\n';
  const after = before.slice(0, -1);
  const report = analyzeSnapshots({ 'main.ts': before }, { 'main.ts': after });
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0]!.base, before);
  assert.equal(report.files[0]!.head, after);
  assert.ok(report.files[0]!.hunks.length > 0);
  assert.equal(report.coverage.totalHunks, report.files[0]!.hunks.length);
});

test('keywords in edited strings and comments do not invent branch or async changes', () => {
  const base = { 'main.ts': 'export function instructions() {\n  // ordinary comment\n  const text = "ordinary message";\n  return text;\n}\n' };
  const head = { 'main.ts': 'export function instructions() {\n  // if await throw catch are words here\n  const text = "if await switch are words here";\n  return text;\n}\n' };
  const report = analyzeSnapshots(base, head);
  const instructions = unit(report, 'main.ts', 'instructions');
  assert.equal(instructions.changed, true);
  assert.equal(instructions.markers.includes('Branch changed'), false);
  assert.equal(instructions.markers.includes('Async boundary changed'), false);
});

test('removed branch and await syntax retain structural markers from the before source', () => {
  const base = { 'main.ts': 'export async function work(condition: boolean, next: () => Promise<number>) {\n  if (condition) {\n    return await next();\n  }\n  return 0;\n}\n' };
  const head = { 'main.ts': 'export async function work(condition: boolean, next: () => Promise<number>) {\n  return 0;\n}\n' };
  const report = analyzeSnapshots(base, head);
  const work = unit(report, 'main.ts', 'work');
  assert.ok(work.markers.includes('Branch changed'));
  assert.ok(work.markers.includes('Async boundary changed'));
});
