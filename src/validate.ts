import type { Report } from './model.js';

/** Validate an untrusted, offline report before any UI consumes it. */
export function validateReport(value: unknown): Report {
  const fail = (path: string, message: string): never => { throw new Error(`${path}: ${message}`); };
  const object = (v: unknown, p: string): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail(p, 'expected an object');
  const string = (v: unknown, p: string) => typeof v === 'string' ? v : fail(p, 'expected text');
  const bool = (v: unknown, p: string) => typeof v === 'boolean' ? v : fail(p, 'expected true or false');
  const number = (v: unknown, p: string, min = 0) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : fail(p, 'expected a nonnegative whole number');
  const array = (v: unknown, p: string): unknown[] => Array.isArray(v) ? v : fail(p, 'expected a list');
  const enumeration = (v: unknown, allowed: string[], p: string) => allowed.includes(string(v, p)) ? v : fail(p, `expected ${allowed.join(', ')}`);
  const strings = (v: unknown, p: string) => array(v, p).map((item, i) => string(item, `${p}[${i}]`));
  const optionalString = (v: unknown, p: string) => { if (v !== undefined) string(v, p); };
  const code = (v: unknown, p: string) => {
    if (v === undefined) return;
    const o = object(v, p); string(o.path, `${p}.path`); string(o.text, `${p}.text`);
    const start = number(o.startLine, `${p}.startLine`, 1); const end = number(o.endLine, `${p}.endLine`, 1);
    if (end < start) fail(p, 'end line precedes start line');
  };
  const o = object(value, 'Report');
  if (o.schemaVersion !== 1) fail('schemaVersion', 'this reader supports report schema 1');
  ['id', 'title', 'generatedAt'].forEach(k => string(o[k], k));
  if (!o.id) fail('id', 'must not be empty');
  const repo = object(o.repository, 'repository');
  ['name', 'base', 'head', 'mergeBase'].forEach(k => string(repo[k], `repository.${k}`));
  optionalString(repo.url, 'repository.url'); bool(repo.dirty, 'repository.dirty');
  const analysis = object(o.analysis, 'analysis');
  ['toolVersion', 'typescriptVersion', 'scope'].forEach(k => string(analysis[k], `analysis.${k}`));
  ['baseStrictNullChecks', 'headStrictNullChecks'].forEach(k => bool(analysis[k], `analysis.${k}`));
  const fileIds = new Set<string>(); const hunkIds = new Set<string>();
  const files = array(o.files, 'files');
  files.forEach((v, i) => {
    const p = `files[${i}]`; const f = object(v, p); const id = string(f.id, `${p}.id`);
    if (!id || fileIds.has(id)) fail(`${p}.id`, 'empty or duplicate file id'); fileIds.add(id);
    string(f.path, `${p}.path`); optionalString(f.oldPath, `${p}.oldPath`);
    enumeration(f.status, ['added', 'modified', 'deleted', 'renamed', 'type-changed'], `${p}.status`);
    ['additions', 'deletions'].forEach(k => number(f[k], `${p}.${k}`)); bool(f.binary, `${p}.binary`);
    ['base', 'head', 'oldMode', 'newMode'].forEach(k => optionalString(f[k], `${p}.${k}`));
    strings(f.unitIds, `${p}.unitIds`);
    let additions = 0, deletions = 0;
    array(f.hunks, `${p}.hunks`).forEach((v, j) => {
      const hp = `${p}.hunks[${j}]`; const h = object(v, hp); const hid = string(h.id, `${hp}.id`);
      if (!hid || hunkIds.has(hid)) fail(`${hp}.id`, 'empty or duplicate hunk id'); hunkIds.add(hid);
      ['oldStart', 'oldLines', 'newStart', 'newLines'].forEach(k => number(h[k], `${hp}.${k}`));
      let oldCount = 0, newCount = 0;
      array(h.lines, `${hp}.lines`).forEach((v, n) => {
        const lp = `${hp}.lines[${n}]`; const line = object(v, lp);
        enumeration(line.kind, ['context', 'add', 'remove'], `${lp}.kind`); string(line.text, `${lp}.text`);
        if (line.oldLine !== undefined) number(line.oldLine, `${lp}.oldLine`, 1);
        if (line.newLine !== undefined) number(line.newLine, `${lp}.newLine`, 1);
        if (line.kind === 'add') {
          additions++;
          if (line.oldLine !== undefined || line.newLine === undefined) fail(lp, 'added line requires only an after coordinate');
        } else if (line.kind === 'remove') {
          deletions++;
          if (line.newLine !== undefined || line.oldLine === undefined) fail(lp, 'removed line requires only a before coordinate');
        } else if (line.oldLine === undefined || line.newLine === undefined) fail(lp, 'context line requires before and after coordinates');
        if (line.oldLine !== undefined && line.oldLine !== (h.oldStart as number) + oldCount++) fail(lp, 'before coordinates are not contiguous within hunk');
        if (line.newLine !== undefined && line.newLine !== (h.newStart as number) + newCount++) fail(lp, 'after coordinates are not contiguous within hunk');
      });
      if (oldCount !== h.oldLines || newCount !== h.newLines) fail(hp, 'line counts do not match hunk coordinates');
    });
    if (f.additions !== additions || f.deletions !== deletions) fail(p, 'edit counts do not match original hunks');
    if (f.binary && (additions || deletions || (f.hunks as unknown[]).length || f.base !== undefined || f.head !== undefined)) fail(p, 'opaque files cannot carry text source or hunks');
  });
  const unitIds = new Set<string>();
  const unitMap = new Map<string, Record<string, unknown>>();
  const units = array(o.units, 'units');
  units.forEach((v, i) => {
    const p = `units[${i}]`; const u = object(v, p); const id = string(u.id, `${p}.id`);
    if (!id || unitIds.has(id)) fail(`${p}.id`, 'empty or duplicate unit id'); unitIds.add(id);
    unitMap.set(id, u);
    ['name', 'path'].forEach(k => string(u[k], `${p}.${k}`));
    enumeration(u.kind, ['function', 'method', 'file'], `${p}.kind`); bool(u.changed, `${p}.changed`); bool(u.exported, `${p}.exported`);
    code(u.base, `${p}.base`); code(u.head, `${p}.head`);
    strings(u.hunkIds, `${p}.hunkIds`).forEach(id => { if (!hunkIds.has(id)) fail(`${p}.hunkIds`, 'references an unknown hunk'); });
    strings(u.markers, `${p}.markers`);
    if (u.contract !== undefined) {
      const contracts = object(u.contract, `${p}.contract`);
      for (const side of ['base', 'head']) if (contracts[side] !== undefined) {
        const contract = object(contracts[side], `${p}.contract.${side}`);
        string(contract.signature, `${p}.contract.${side}.signature`); string(contract.returnType, `${p}.contract.${side}.returnType`); bool(contract.inferred, `${p}.contract.${side}.inferred`);
        bool(contract.unknown, `${p}.contract.${side}.unknown`);
        if (u[side] === undefined) fail(`${p}.contract.${side}`, 'contract is absent from source revision');
      }
    }
  });
  files.forEach((v, i) => strings(object(v, '').unitIds, '').forEach(id => { if (!unitIds.has(id)) fail(`files[${i}].unitIds`, 'references an unknown unit'); }));
  const linkIds = new Set<string>();
  array(o.links, 'links').forEach((v, i) => {
    const p = `links[${i}]`; const l = object(v, p); const id = string(l.id, `${p}.id`);
    if (!id || linkIds.has(id)) fail(`${p}.id`, 'empty or duplicate call id'); linkIds.add(id);
    if (!unitIds.has(string(l.from, `${p}.from`))) fail(`${p}.from`, 'references an unknown caller');
    optionalString(l.to, `${p}.to`); if (l.to !== undefined && !unitIds.has(l.to as string)) fail(`${p}.to`, 'references an unknown callee');
    enumeration(l.side, ['base', 'head'], `${p}.side`); number(l.line, `${p}.line`, 1);
    string(l.expression, `${p}.expression`); optionalString(l.reason, `${p}.reason`);
    enumeration(l.evidence, ['resolved', 'unresolved'], `${p}.evidence`);
    if (l.evidence === 'resolved' && !l.to) fail(`${p}.to`, 'a resolved call needs a target');
    if (l.evidence === 'unresolved' && l.to) fail(`${p}.to`, 'an unresolved call cannot claim a target');
    const caller = unitMap.get(l.from as string);
    if (caller && caller[l.side as string] === undefined) fail(`${p}.side`, 'caller is absent on this revision');
    const source = object(caller![l.side as string], `${p}.source`);
    if ((l.line as number) < (source.startLine as number) || (l.line as number) > (source.endLine as number)) fail(`${p}.line`, 'outside caller source range');
    if (!(source.text as string).includes(l.expression as string)) fail(`${p}.expression`, 'expression is absent from caller source');
    const target = typeof l.to === 'string' ? unitMap.get(l.to) : undefined;
    if (target && target[l.side as string] === undefined) fail(`${p}.side`, 'target is absent on this revision');
    enumeration(l.status, ['added', 'removed', 'retained'], `${p}.status`);
  });
  strings(o.rootIds, 'rootIds').forEach(id => { if (!unitIds.has(id)) fail('rootIds', 'references an unknown unit'); });
  array(o.diagnostics, 'diagnostics').forEach((v, i) => {
    const p = `diagnostics[${i}]`; const d = object(v, p);
    enumeration(d.side, ['base', 'head'], `${p}.side`); optionalString(d.path, `${p}.path`); string(d.message, `${p}.message`);
  });
  const c = object(o.coverage, 'coverage'); bool(c.complete, 'coverage.complete'); string(c.note, 'coverage.note');
  ['changedFiles', 'totalHunks', 'mappedHunks', 'unresolvedCalls', 'analyzedFiles'].forEach(k => number(c[k], `coverage.${k}`));
  if (c.changedFiles !== files.length || c.totalHunks !== hunkIds.size || (c.mappedHunks as number) > hunkIds.size) fail('coverage', 'file or hunk counts do not match the inventory');
  const mapped = new Set(units.flatMap(v => strings(object(v, '').hunkIds, '')));
  if (c.mappedHunks !== mapped.size) fail('coverage.mappedHunks', 'does not match actual accounted hunk references');
  const expectedEdits = new Map<string, { fileId: string; hunkId: string; text: string }>();
  const fileMap = new Map<string, Record<string, unknown>>();
  for (const v of files) {
    const file = object(v, ''); fileMap.set(file.id as string, file);
    for (const hv of array(file.hunks, '')) {
      const hunk = object(hv, '');
      for (const lv of array(hunk.lines, '')) {
        const line = object(lv, '');
        if (line.kind === 'context') continue;
        const side = line.kind === 'remove' ? 'base' : 'head';
        const coordinate = side === 'base' ? line.oldLine : line.newLine;
        expectedEdits.set(`${file.id}:${side}:${coordinate}`, { fileId: file.id as string, hunkId: hunk.id as string, text: line.text as string });
      }
    }
  }
  const seenEdits = new Set<string>(), editIds = new Set<string>();
  for (const [i, v] of array(o.edits, 'edits').entries()) {
    const p = `edits[${i}]`, edit = object(v, p);
    const id = string(edit.id, `${p}.id`);
    if (!id || editIds.has(id)) fail(`${p}.id`, 'empty or duplicate edit id'); editIds.add(id);
    const fileId = string(edit.fileId, `${p}.fileId`), hunkId = string(edit.hunkId, `${p}.hunkId`), unitId = string(edit.unitId, `${p}.unitId`);
    enumeration(edit.side, ['base', 'head'], `${p}.side`); number(edit.line, `${p}.line`, 1); string(edit.text, `${p}.text`);
    const key = `${fileId}:${edit.side}:${edit.line}`, expected = expectedEdits.get(key);
    if (!expected || expected.hunkId !== hunkId || expected.text !== edit.text) fail(p, 'does not match an original changed line');
    if (seenEdits.has(key)) fail(p, 'changed line has duplicate ownership'); seenEdits.add(key);
    const unit = unitMap.get(unitId), file = fileMap.get(fileId);
    if (!unit || !file || !strings(file.unitIds, '').includes(unitId) || !strings(unit.hunkIds, '').includes(hunkId)) fail(p, 'owner is not accounted in its file and hunk');
    if (unit!.kind !== 'file') {
      const source = object(unit![edit.side as string], `${p}.owner`);
      if ((edit.line as number) < (source.startLine as number) || (edit.line as number) > (source.endLine as number)) fail(p, 'owner does not contain this changed source line');
    }
  }
  if (seenEdits.size !== expectedEdits.size) fail('edits', 'changed line inventory is incomplete');
  if (c.unresolvedCalls !== array(o.links, 'links').filter(v => object(v, '').evidence === 'unresolved').length) fail('coverage.unresolvedCalls', 'does not match unresolved call links');
  return value as Report;
}
