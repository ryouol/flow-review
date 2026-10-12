import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeSnapshots } from '../src/analyzer.ts';
import { renderReport } from '../src/render.ts';

const base = {
  'entry.ts': 'import { guard } from "./guard";\nimport { wrapper } from "./wrapper";\nimport { shared } from "./shared";\nexport function entry(input: number) {\n  guard(input);\n  return wrapper(input);\n}\nexport function other(input: number) { return shared(input); }\n',
  'guard.ts': 'export function guard(input: number) { if (input < 0) throw new Error("negative input"); }\n',
  'wrapper.ts': 'import { shared } from "./shared";\nexport function wrapper(input: number) { return shared(input); }\n',
  'shared.ts': 'export function shared(input: number) { return input * 2; }\n',
  'settings.json': Array.from({ length: 50 }, (_, i) => `"setting-${i}": false`).join('\n') + '\n',
};
const head = { ...base,
  'entry.ts': 'import { wrapper } from "./wrapper";\nimport { shared } from "./shared";\nexport function entry(input: number) {\n  return wrapper(input + 1);\n}\nexport function other(input: number) { return shared(input + 1); }\n',
  'shared.ts': 'export function shared(input: number) { return input * 3; }\n',
  'settings.json': base['settings.json'].replace('"setting-1": false', '"setting-1": true').replace('"setting-25": false', '"setting-25": true').replace('"setting-48": false', '"setting-48": true'),
};
const report = analyzeSnapshots(base, head, { title: 'Adversarial reader fixture', repository: { name: 'Fixture', base: 'fixture-base', head: 'fixture-head', mergeBase: 'fixture-base', dirty: false } });
const changed = analyzeSnapshots(base, { ...head, 'shared.ts': 'export function shared(input: number) { return input * 4; }\n' }, { title: 'Changed snapshot fixture' });
const hostile = analyzeSnapshots({}, {
  'hostile.ts': 'export function hostile() { return "</script><script>globalThis.__flowReviewXss = true</script><img src=https://example.invalid/x onerror=globalThis.__imgXss=true>"; }\n' + '// ' + 'long_source_value_'.repeat(100) + '\n',
}, { title: '</title><script>globalThis.__titleXss = true</script>' });
// Schema fixture for presentation of acquisition metadata. Real Git metadata is
// independently exercised in git.test.ts with committed objects.
const metadata = analyzeSnapshots({ 'mode.ts': 'export function run() { return 1; }\n' }, { 'mode.ts': 'export function run() { return 2; }' }, { title: 'Metadata display fixture' });
Object.assign(metadata.files[0], { oldPath: 'previous.ts', status: 'renamed', oldMode: '100644', newMode: '100755' });
const empty = analyzeSnapshots({ 'main.ts': 'export function untouched() { return 1; }\n' }, { 'main.ts': 'export function untouched() { return 1; }\n' }, { title: 'Identical revisions' });
const contractBase = { 'tsconfig.json': '{"compilerOptions":{"strictNullChecks":true}}\n', 'lookup.ts': 'export function lookup(found: boolean) {\n  if (found) return "ok";\n  return null;\n}\nexport function caller() { return lookup(false); }\n' };
const contracts = analyzeSnapshots(contractBase, { ...contractBase, 'lookup.ts': 'export function lookup(found: boolean) {\n  if (found) return "ok";\n}\nexport function caller() { return lookup(false); }\n' }, { title: 'Inferred return contract fixture' });
const terminatorSource = 'export function target() { return 1; }\rexport function entry() {\u2028  return target();\u2029}\n';
const terminators = analyzeSnapshots({ 'main.ts': terminatorSource }, { 'main.ts': terminatorSource.replace('return 1', 'return 2') }, { title: 'Literal line separator fixture' });
const unknownSource = 'import { external } from "unavailable-package";\nexport function opaque() { return external(); }\n';
const unknownContract = analyzeSnapshots({ 'main.ts': unknownSource }, { 'main.ts': unknownSource.replace('return external()', 'return external(1)') }, { title: 'Unknown external contract fixture' });
const callerSource = 'export function target(value: number) { return value + 1; }\nexport function callerElsewhere() {\n  const value = target(1);\n  return value;\n}\nexport function callerEdited() { return target(1); }\nexport function untouched() { return target(1); }\n';
const callerSites = analyzeSnapshots({ 'main.ts': callerSource }, { 'main.ts': callerSource.replace('return value + 1', 'return value + 2').replace('return value;', 'return value + 1;').replace('function callerEdited() { return target(1)', 'function callerEdited() { return target(2)') }, { title: 'Caller site provenance fixture' });
const routes = new Map([
  ['/fixture.html', ['text/html', renderReport(report)]],
  ['/fixture.json', ['application/json', JSON.stringify(report)]],
  ['/fixture-changed.html', ['text/html', renderReport(changed)]],
  ['/hostile.html', ['text/html', renderReport(hostile)]],
  ['/metadata.html', ['text/html', renderReport(metadata)]],
  ['/empty.html', ['text/html', renderReport(empty)]],
  ['/contracts.html', ['text/html', renderReport(contracts)]],
  ['/terminators.html', ['text/html', renderReport(terminators)]],
  ['/unknown-contract.html', ['text/html', renderReport(unknownContract)]],
  ['/caller-sites.html', ['text/html', renderReport(callerSites)]],
]);
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const route = routes.get(path);
  if (route) { response.writeHead(200, { 'content-type': `${route[0]}; charset=utf-8` }); response.end(route[1]); return; }
  if (path === '/demo.html') {
    try { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(readFileSync(resolve('reports/demo.html'))); }
    catch { response.writeHead(404); response.end('Generate the demo with npm run demo first.'); }
    return;
  }
  if (path === '/health') { response.writeHead(200); response.end('ok'); return; }
  response.writeHead(404); response.end('Not found');
});
server.listen(4317, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
