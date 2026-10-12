import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeSnapshots } from '../src/analyzer.js';

const cli = resolve('dist/cli.js');
const invoke = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'flow-review-cli-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '--initial-branch=main'); git('config', 'user.name', 'Fixture Author'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(path, 'README.md'), 'Before\n'); git('add', '--all'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  return { path, base, git, close: () => rmSync(path, { recursive: true, force: true }) };
}

test('CLI produces inspectable offline HTML and matching JSON for non-code-only changes', () => {
  const r = fixture();
  try {
    writeFileSync(join(r.path, 'README.md'), 'After\n'); r.git('add', '--all'); r.git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'head');
    const output = join(r.path, 'output', 'review.html');
    const result = invoke('analyze', '--repo', r.path, '--base', r.base, '--out', output);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(output.replace(/\.html$/, '.json'), 'utf8'));
    assert.equal(report.files.length, 1); assert.equal(report.files[0].path, 'README.md');
    assert.equal(report.coverage.totalHunks, 1); assert.equal(report.coverage.unresolvedCalls, 0);
    assert.match(readFileSync(output, 'utf8'), /<!doctype html>/i);
  } finally { r.close(); }
});

test('CLI handles identical revisions without inventing changed declarations', () => {
  const r = fixture();
  try {
    const output = join(r.path, 'empty.html');
    const result = invoke('analyze', '--repo', r.path, '--base', r.base, '--head', r.base, '--out', output);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(output.replace(/\.html$/, '.json'), 'utf8'));
    assert.equal(report.files.length, 0); assert.equal(report.coverage.totalHunks, 0);
    assert.equal(report.units.filter((u: { changed: boolean }) => u.changed).length, 0);
  } finally { r.close(); }
});

test('CLI bad revisions and missing values fail without writing a misleading report', () => {
  const r = fixture();
  try {
    const output = join(r.path, 'failed.html');
    const bad = invoke('analyze', '--repo', r.path, '--base', 'not-a-real-ref', '--out', output);
    assert.notEqual(bad.status, 0); assert.match(bad.stderr, /Git|revision|ref/i); assert.equal(existsSync(output), false);
    const missing = invoke('analyze', '--base');
    assert.notEqual(missing.status, 0); assert.match(missing.stderr, /missing|requires/i);
  } finally { r.close(); }
});

test('CLI render rejects malformed JSON and report references before overwriting outputs', () => {
  const r = fixture();
  try {
    const input = join(r.path, 'import.json'); const output = join(r.path, 'existing.html');
    const report = analyzeSnapshots({}, { 'main.ts': 'export function one() { return two(); }\nexport function two() { return 2; }\n' });
    report.links[0]!.to = 'nonexistent-callee';
    for (const contents of ['{ invalid JSON', JSON.stringify(report)]) {
      writeFileSync(input, contents); writeFileSync(output, 'EXISTING_CONTENT');
      const result = invoke('render', '--input', input, '--out', output);
      assert.notEqual(result.status, 0, 'An invalid report must not be counted as successful generation');
      assert.equal(readFileSync(output, 'utf8'), 'EXISTING_CONTENT');
    }
  } finally { r.close(); }
});

test('CLI PR command rejects missing and unsafe URLs before generating a report', () => {
  const r = fixture();
  try {
    const output = join(r.path, 'unsafe.html');
    const missing = invoke('pr');
    assert.notEqual(missing.status, 0); assert.match(missing.stderr, /requires.*url/i);
    const unsafe = invoke('pr', '--url', 'https://github.com.evil.invalid/owner/repo/pull/1', '--out', output);
    assert.notEqual(unsafe.status, 0); assert.match(unsafe.stderr, /GitHub|github|URL/i);
    assert.equal(existsSync(output), false);
  } finally { r.close(); }
});
