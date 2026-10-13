import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Report } from './model.js';
import { validateReport } from './validate.js';

export function safeJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function renderDocument({ report, demo, online }: { report?: Report; demo?: Report; online?: boolean }): string {
  if (report) validateReport(report);
  if (demo) validateReport(demo);
  const script = readFileSync(fileURLToPath(new URL('../dist/web/client.js', import.meta.url)), 'utf8');
  const css = readFileSync(fileURLToPath(new URL('../dist/web/client.css', import.meta.url)), 'utf8');
  const executable = script.replace(/<\/script/gi, '<\\/script');
  const digest = createHash('sha256').update(executable).digest('base64');
  const title = (report?.title ?? 'Open a review').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
  const payload = report ? `<script id="report-data" type="application/json"${demo ? ' data-demo="true"' : ''}>${safeJSON(report)}</script>` : '';
  const sample = !report && demo ? `<script id="demo-data" type="application/json">${safeJSON(demo)}</script>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${title} · Flow Review</title><style>${css}</style></head><body><div id="root"${online ? ' data-online="true"' : ''}></div>${payload}${sample}<script>${executable}</script></body></html>`;
}
export function renderReport(report: Report, options: { demo?: boolean } = {}): string {
  return renderDocument({ report, ...(options.demo ? { demo: report } : {}) });
}
export function renderReader(demo: Report): string { return renderDocument({ demo, online: true }); }
