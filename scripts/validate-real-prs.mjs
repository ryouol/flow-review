#!/usr/bin/env node
// Replays the pinned public examples using fetched clones; no network or reviewed code execution.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeRepository } from '../dist/git.js';
import { renderReport } from '../dist/render.js';

if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Use Node.js 22 or newer.');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clones = resolve(process.argv[2] ?? `${project}/tmp/real-pr-validation`);
const output = resolve(process.argv[3] ?? `${project}/tmp/real-pr-replay`);
const record = JSON.parse(readFileSync(`${project}/docs/real-pr-validation.json`, 'utf8'));
const fingerprintPaths = ['src/analyzer.ts', 'src/git.ts', 'src/model.ts', 'src/cli.ts', 'src/github.ts', 'src/render.ts', 'src/validate.ts', 'src/web/main.tsx', 'src/web/styles.css', 'src/web/icons.ts', 'scripts/build-site.mjs', 'dist/git.js', 'dist/render.js', 'dist/web/client.js', 'dist/web/client.css'];
const fingerprints = Object.fromEntries(fingerprintPaths.map(path => [path, createHash('sha256').update(readFileSync(`${project}/${path}`)).digest('hex')]));
mkdirSync(output, { recursive: true });
const results = [];
const sort = rows => [...rows].sort((a, b) => a.path.localeCompare(b.path));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const pinned of record.cases) {
  const repo = resolve(clones, pinned.repository.split('/')[1]);
  const git = args => execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', '--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '--literal-pathspecs', '-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  const started = performance.now();
  try {
    const mergeBase = git(['merge-base', pinned.baseRefOid, pinned.headRefOid]).trim();
    const numstat = git(['diff', '--numstat', '-z', '--no-ext-diff', '--no-textconv', mergeBase, pinned.headRefOid, '--']).split('\0').filter(Boolean).map(row => {
      const [additions, deletions, path] = row.split('\t');
      if (!path || additions === '-' || deletions === '-') throw new Error('Recorded text-example runner encountered a binary or rename format; use the adversarial suite for those formats.');
      return { path, additions: Number(additions), deletions: Number(deletions) };
    });
    const patch = git(['diff', '--unified=3', '--no-ext-diff', '--no-textconv', mergeBase, pinned.headRefOid, '--']);
    const headers = new Map(), expectedEdits = [];
    let filePath = '', oldPath = '', oldLine = 0, newLine = 0, inHunk = false;
    for (const line of patch.split('\n')) {
      if (line.startsWith('diff --git ')) { inHunk = false; continue; }
      if (line.startsWith('--- a/')) { oldPath = line.slice(6); continue; }
      if (line.startsWith('+++ ')) { filePath = line.startsWith('+++ b/') ? line.slice(6) : oldPath; headers.set(filePath, []); continue; }
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        oldLine = Number(match[1]); newLine = Number(match[3]); inHunk = true;
        headers.get(filePath).push({ oldStart: oldLine, oldLines: Number(match[2] ?? 1), newStart: newLine, newLines: Number(match[4] ?? 1) }); continue;
      }
      if (!inHunk || line.startsWith('\\')) continue;
      if (line.startsWith('+')) expectedEdits.push({ path: filePath, side: 'head', line: newLine++, text: line.slice(1) });
      else if (line.startsWith('-')) expectedEdits.push({ path: filePath, side: 'base', line: oldLine++, text: line.slice(1) });
      else if (line.startsWith(' ')) { oldLine++; newLine++; }
    }
    const analysisStart = performance.now();
    const report = analyzeRepository({ repo, base: pinned.baseRefOid, head: pinned.headRefOid, title: pinned.title });
    const analyzeMs = Math.round(performance.now() - analysisStart);
    const units = new Map(report.units.map(unit => [unit.id, unit])), files = new Map(report.files.map(file => [file.id, file]));
    const actualEdits = report.edits.map(edit => ({ path: files.get(edit.fileId)?.path, side: edit.side, line: edit.line, text: edit.text }));
    const editKey = edit => JSON.stringify(edit);
    const invalidOwners = report.edits.filter(edit => { const unit = units.get(edit.unitId), code = unit?.[edit.side]; return !unit?.changed || !code || edit.line < code.startLine || edit.line > code.endLine; });
    const inventoryMatches = same(sort(numstat), sort(report.files.map(({ path, additions, deletions }) => ({ path, additions, deletions }))));
    const hunksMatch = report.files.every(file => same(headers.get(file.path) ?? [], file.hunks.map(({ oldStart, oldLines, newStart, newLines }) => ({ oldStart, oldLines, newStart, newLines }))));
    const editsMatch = same(expectedEdits.map(editKey).sort(), actualEdits.map(editKey).sort()) && new Set(actualEdits.map(editKey)).size === actualEdits.length && invalidOwners.length === 0;
    const sourceCache = new Map();
    const source = (side, path) => { const sha = side === 'base' ? mergeBase : pinned.headRefOid, key = `${sha}:${path}`; if (!sourceCache.has(key)) sourceCache.set(key, git(['show', key])); return sourceCache.get(key); };
    const changed = report.units.filter(unit => unit.changed), declarations = changed.filter(unit => unit.kind !== 'file');
    const changedIds = new Set(changed.map(unit => unit.id)), declarationIds = new Set(declarations.map(unit => unit.id));
    const calls = report.links.filter(link => changedIds.has(link.from));
    const peeks = calls.filter(link => link.evidence === 'resolved');
    const provenance = peeks.map(link => {
      const caller = units.get(link.from), target = units.get(link.to), code = target?.[link.side];
      const callerLine = source(link.side, caller[link.side].path).split('\n')[link.line - 1];
      const range = code ? source(link.side, code.path).split('\n').slice(code.startLine - 1, code.endLine).join('\n') : '';
      return { linkId: link.id, passed: !!code && range.includes(code.text) && !!callerLine?.includes(link.expression.split('\n')[0]) };
    });
    const adjacency = new Map(declarations.map(unit => [unit.id, new Set()])), edges = new Set();
    for (const link of report.links) if (link.evidence === 'resolved' && declarationIds.has(link.from) && declarationIds.has(link.to) && link.from !== link.to) { adjacency.get(link.from).add(link.to); adjacency.get(link.to).add(link.from); edges.add([link.from, link.to].sort().join(':')); }
    const seen = new Set(), componentSizes = [];
    for (const id of declarationIds) if (!seen.has(id)) { let size = 0; const queue = [id]; seen.add(id); while (queue.length) { size++; for (const next of adjacency.get(queue.pop())) if (!seen.has(next)) { seen.add(next); queue.push(next); } } componentSizes.push(size); }
    const stem = `${output}/${pinned.repository.split('/')[1]}-${pinned.prNumber}`;
    const html = renderReport(report); // Includes the product's report validator.
    writeFileSync(`${stem}.json`, JSON.stringify(report, null, 2) + '\n'); writeFileSync(`${stem}.html`, html);
    const passed = inventoryMatches && hunksMatch && editsMatch && provenance.every(check => check.passed);
    results.push({ repository: pinned.repository, prNumber: pinned.prNumber, mergeBase, analyzeMs, durationMs: Math.round(performance.now() - started), changedFiles: report.files.length, hunks: report.coverage.totalHunks, edits: report.edits.length, inventoryMatches, hunksMatch, editsMatch, resolvedSourceChecks: provenance.length, failedSourceChecks: provenance.filter(check => !check.passed), staticNavigation: { callSitesFromChangedUnits: calls.length, resolvedPeeks: peeks.length, peekShare: calls.length ? peeks.length / calls.length : null, changedDeclarations: declarationIds.size, distinctUndirectedEdges: edges.size, componentSizes: componentSizes.sort((a, b) => b - a) }, passed });
    console.log(`${pinned.repository} #${pinned.prNumber}: ${passed ? 'PASS' : 'FAIL'} (${report.files.length} files, ${report.edits.length} exact edits, ${peeks.length} source peeks)`);
  } catch (error) {
    results.push({ repository: pinned.repository, prNumber: pinned.prNumber, passed: false, durationMs: Math.round(performance.now() - started), error: String(error) });
    console.log(`${pinned.repository} #${pinned.prNumber}: FAILED / REFUSED: ${String(error)}`);
  }
  writeFileSync(`${output}/validation.json`, JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, fingerprints, results }, null, 2) + '\n');
}
if (results.some(result => !result.passed)) process.exitCode = 1;
