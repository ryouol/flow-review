import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { createDemo } from '../src/demo.js';
import { validateReport } from '../src/validate.js';

function filesBelow(root: string, prefix = ''): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesBelow(join(root, entry.name), relative) : [relative];
  }).sort();
}

function rawTarEntries(archive: Buffer): { name: string; regular: boolean }[] {
  const tar = gunzipSync(archive);
  const result: { name: string; regular: boolean }[] = [];
  const field = (header: Buffer, offset: number, length: number) => header.subarray(offset, offset + length).toString('utf8').split('\0')[0]!.trim();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const prefix = field(header, 345, 155), name = field(header, 0, 100);
    const sizeField = field(header, 124, 12);
    assert.match(sizeField || '0', /^[0-7]+$/, 'Distribution uses ordinary octal TAR sizes');
    const size = parseInt(sizeField || '0', 8);
    assert.ok(Number.isSafeInteger(size) && offset + 512 + size <= tar.length, 'TAR payload is complete');
    result.push({ name: prefix ? `${prefix}/${name}` : name, regular: header[156] === 0 || header[156] === 48 });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}

test('public export contains only synthetic entry data and the isolated dependency-free CLI package', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'flow-review-site-export-'));
  try {
    const sentinel = 'PRIVATE_REPORT_SENTINEL_8bcf5eb711';
    mkdirSync(join(scratch, 'reports', 'private'), { recursive: true });
    writeFileSync(join(scratch, 'reports', 'private', 'review.html'), `<html>${sentinel}</html>`);
    writeFileSync(join(scratch, 'reports', 'private', 'review.json'), JSON.stringify({ privateSource: sentinel }));
    writeFileSync(join(scratch, '.env'), `PRIVATE_MARKER=${sentinel}\n`);
    const output = join(scratch, 'site');
    execFileSync(process.execPath, [resolve('scripts/build-site.mjs'), '--out', output], { cwd: scratch, encoding: 'utf8', stdio: 'pipe' });
    assert.deepEqual(filesBelow(output), ['downloads/flow-review-cli.tgz', 'index.html', 'vercel.json']);
    const html = readFileSync(join(output, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /id="report-data"/, 'Public entry must not open an embedded repository report');
    const demoPayload = html.match(/<script id="demo-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(demoPayload, 'Public entry includes an explicit synthetic Try demo payload');
    const demo = validateReport(JSON.parse(demoPayload));
    const expected = createDemo();
    assert.equal(demo.id, expected.id);
    assert.deepEqual(demo.repository, expected.repository);
    assert.deepEqual(demo.files, expected.files);
    assert.deepEqual(demo.units, expected.units);
    assert.deepEqual(demo.links, expected.links);
    assert.deepEqual(demo.edits, expected.edits);
    assert.equal(html.includes(sentinel), false);
    assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i);
    const config = JSON.parse(readFileSync(join(output, 'vercel.json'), 'utf8'));
    const httpPolicy = config.headers.flatMap((rule: { headers: { key: string; value: string }[] }) => rule.headers).find((header: { key: string }) => header.key.toLowerCase() === 'content-security-policy')?.value;
    const metaPolicy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    assert.ok(metaPolicy);
    assert.equal(httpPolicy, `${metaPolicy}; frame-ancestors 'none'`, 'HTTP and offline executable policies must authorize the same script bytes');
    assert.match(httpPolicy, /connect-src 'none'/);

    const archive = join(output, 'downloads', 'flow-review-cli.tgz');
    const rawEntries = rawTarEntries(readFileSync(archive));
    assert.ok(rawEntries.every(entry => !entry.name.split('/').some(part => part.startsWith('._'))), 'TAR must not carry hidden AppleDouble or Finder metadata entries');
    assert.deepEqual(rawEntries.filter(entry => entry.regular).map(entry => entry.name).sort(), ['package/README.txt', 'package/THIRD-PARTY-NOTICES.txt', 'package/dist/cli.js', 'package/dist/web/client.css', 'package/dist/web/client.js', 'package/package.json']);
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', stdio: 'pipe' }).split('\n').filter(name => name && !name.endsWith('/')).sort();
    assert.deepEqual(entries, ['package/README.txt', 'package/THIRD-PARTY-NOTICES.txt', 'package/dist/cli.js', 'package/dist/web/client.css', 'package/dist/web/client.js', 'package/package.json']);
    const extracted = join(scratch, 'extracted'); mkdirSync(extracted);
    execFileSync('tar', ['-xzf', archive, '-C', extracted], { stdio: 'pipe' });
    const packageDir = join(extracted, 'package');
    const packageJSON = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(packageJSON.dependencies ?? {}), [], 'Installed CLI must require no dependency install');
    assert.ok(packageJSON.bin, 'Package exposes a runnable CLI');
    for (const entry of entries) assert.equal(readFileSync(join(extracted, entry), 'utf8').includes(sentinel), false);
    const cli = join(packageDir, 'dist', 'cli.js');
    const help = execFileSync(process.execPath, [cli, '--help'], { cwd: packageDir, encoding: 'utf8', stdio: 'pipe' });
    assert.match(help, /Flow Review/);
    const demoOutput = join(scratch, 'isolated-demo.html');
    execFileSync(process.execPath, [cli, 'demo', '--out', demoOutput], { cwd: packageDir, encoding: 'utf8', stdio: 'pipe' });
    const archiveDemo = validateReport(JSON.parse(readFileSync(demoOutput.replace(/\.html$/, '.json'), 'utf8')));
    assert.equal(archiveDemo.id, expected.id);
    assert.deepEqual(archiveDemo.files, expected.files);
    assert.match(readFileSync(demoOutput, 'utf8'), /<!doctype html>/i);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
