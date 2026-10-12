import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analyzeSnapshots } from '../src/analyzer.js';
import { renderReport } from '../src/render.js';

test('hostile source cannot terminate the report payload or add executable markup', () => {
  const source = 'export function hostile() { return "</script><script>globalThis.__flowReviewXss = true</script><img src=x onerror=alert(1)>"; }\n';
  const report = analyzeSnapshots({}, { 'hostile.ts': source }, { title: '</title><script>globalThis.__titleXss = true</script>' });
  const html = renderReport(report);
  assert.doesNotMatch(html, /<script>globalThis\.__flowReviewXss/);
  assert.doesNotMatch(html, /<script>globalThis\.__titleXss/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.ok(html.includes('flowReviewXss'), 'Escaping must preserve readable source contents');
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i, 'Reports must bundle scripts and styles');
});

test('rendered payload preserves final-newline differences exactly', () => {
  const before = 'export function run() { return 1; }\n';
  const after = before.slice(0, -1);
  const html = renderReport(analyzeSnapshots({ 'main.ts': before }, { 'main.ts': after }));
  const payload = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(payload, 'Generated reader includes a JSON payload');
  const report = JSON.parse(payload);
  assert.equal(report.files[0].base, before);
  assert.equal(report.files[0].head, after);
});

test('script CSP authorizes the exact escaped inline bundle without unsafe-inline', () => {
  const html = renderReport(analyzeSnapshots({}, { 'main.ts': 'export function run() { return 1; }\n' }));
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
  assert.ok(policy, 'Offline report has a content security policy');
  const scriptPolicy = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1];
  assert.ok(scriptPolicy);
  assert.doesNotMatch(scriptPolicy, /unsafe-inline/);
  const emittedBundle = html.match(/<script>([\s\S]*?)<\/script><\/body>/)?.[1];
  assert.ok(emittedBundle, 'Capture the bytes actually emitted, after script-tag escaping');
  const exactHash = createHash('sha256').update(emittedBundle).digest('base64');
  assert.ok(scriptPolicy.includes(`'sha256-${exactHash}'`), 'CSP hash must match the actual rendered JavaScript bytes');
});
