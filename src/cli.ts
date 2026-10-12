#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { analyzeRepository } from './git.js';
import { createDemo } from './demo.js';
import { renderReport } from './render.js';
import type { Report } from './model.js';
import { validateReport } from './validate.js';
import { analyzePullRequest } from './github.js';

const usage = `Flow Review — follow changed code, keep every change visible.

Usage:
  flow-review analyze --repo <path> --base <ref> [--head HEAD] [--out reports/review.html] [--title <title>]
  flow-review pr --url https://github.com/owner/repo/pull/123 [--out reports/review.html]
  flow-review demo [--out reports/demo.html]
  flow-review render --input <report.json> [--out reports/review.html]

Analyzes committed Git objects without executing project code. Outputs an offline
HTML reader and a matching JSON report. Local analysis needs no API key or account.
The compare uses merge-base(base, head)..head, like a PR three-dot diff.
The pr command requires GitHub CLI (gh) and fetches pinned Git objects locally.
Uncommitted changes are excluded and disclosed. TypeScript direct calls only;
external/dynamic targets remain explicit boundaries. Node.js 22+ required.
`;

export function runCLI(args: string[]): void {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(usage); return; }
  const command = args[0], opts: Record<string, string> = {};
  const allowed = new Set(['--repo', '--base', '--head', '--out', '--title', '--input', '--url']);
  for (let i = 1; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${args[i]}`);
    opts[args[i].slice(2)] = args[i + 1];
  }
  let report: Report;
  if (command === 'demo') report = createDemo();
  else if (command === 'analyze') {
    if (!opts.base) throw new Error('analyze requires --base <ref>.');
    report = analyzeRepository({ repo: opts.repo ?? '.', base: opts.base, head: opts.head ?? 'HEAD', title: opts.title });
  } else if (command === 'pr') {
    if (!opts.url) throw new Error('pr requires --url https://github.com/owner/repo/pull/number.');
    report = analyzePullRequest(opts.url, opts.title);
  } else if (command === 'render') {
    if (!opts.input) throw new Error('render requires --input <report.json>.');
    report = validateReport(JSON.parse(readFileSync(resolve(opts.input), 'utf8')));
  } else throw new Error(`Unknown command: ${command}`);
  const output = resolve(opts.out ?? `reports/${command === 'demo' ? 'demo' : 'review'}.html`);
  if (!output.endsWith('.html')) throw new Error('--out must end with .html.');
  const jsonPath = output.slice(0, -5) + '.json';
  const html = renderReport(report);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html); writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.files.length} changed files · ${report.coverage.totalHunks} hunks · ${report.units.filter(u => u.changed && u.kind !== 'file').length} changed declarations`);
  console.log(`${report.links.filter(l => l.evidence === 'resolved').length} static links · ${report.coverage.unresolvedCalls} unresolved call sites (both snapshots)`);
  console.log(`Reader: ${output}\nReport: ${jsonPath}`);
  if (report.repository.dirty) console.log('Note: uncommitted changes were excluded.');
}
try { runCLI(process.argv.slice(2)); } catch (error) { console.error(`Flow Review: ${(error as Error).message}`); process.exitCode = 1; }
