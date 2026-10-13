import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const index = resolve('dist/site/index.html');
const archive = resolve('dist/site/downloads/flow-review-cli.tgz');
const port = Number(process.env.FLOW_PREVIEW_PORT ?? 4173);
// This preview exposes only the generated public shell and analyzer distribution.
// It cannot serve workspace paths or private reports.
createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const file = url.pathname === '/' ? index : url.pathname === '/downloads/flow-review-cli.tgz' ? archive : undefined;
  if (!file || request.method !== 'GET') { response.writeHead(404); response.end('Not found'); return; }
  try {
    const content = readFileSync(file);
    response.writeHead(200, { 'Content-Type': file === index ? 'text/html; charset=utf-8' : 'application/gzip', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(content);
  } catch { response.writeHead(503); response.end('Build the reader first'); }
}).listen(port, '127.0.0.1', () => console.log(`Public-shell preview: http://127.0.0.1:${port}`));
