import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Report } from './model.js';
import { validateReport } from './validate.js';

export function safeJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function renderReport(report: Report): string {
  validateReport(report);
  const script = readFileSync(fileURLToPath(new URL('../dist/web/client.js', import.meta.url)), 'utf8');
  const css = readFileSync(fileURLToPath(new URL('../dist/web/client.css', import.meta.url)), 'utf8');
  const executable = script.replace(/<\/script/gi, '<\\/script');
  const digest = createHash('sha256').update(executable).digest('base64');
  const title = report.title.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${title} · Flow Review</title><style>${css}</style></head><body><div id="root"></div><script id="report-data" type="application/json">${safeJSON(report)}</script><script>${executable}</script></body></html>`;
}
