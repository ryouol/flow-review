import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, renameSync, unlinkSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { analyzeRepository } from '../src/git.js';

function repo() {
  const path = mkdtempSync(join(tmpdir(), 'flow-review-test-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Fixture Author');
  git('config', 'user.email', 'fixture@example.invalid');
  const write = (name: string, data: string | Buffer) => { mkdirSync(dirname(join(path, name)), { recursive: true }); writeFileSync(join(path, name), data); };
  const commit = (message: string) => { git('add', '--all'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', message); return git('rev-parse', 'HEAD'); };
  return { path, git, write, commit, close: () => rmSync(path, { recursive: true, force: true }) };
}

test('Git acquisition inventories binary, rename, delete, mode and non-ASCII paths', () => {
  const r = repo();
  try {
    r.write('main.ts', 'export function run() { return 1; }\n');
    r.write('remove.txt', 'delete me\n');
    r.write('old name.ts', 'export function same() { return 42; }\n');
    r.write('binary.bin', Buffer.from([0, 1, 2, 3]));
    r.write('runner.sh', '#!/bin/sh\nexit 0\n');
    r.write('配置/naïve file.ts', 'export function unicode() { return "before"; }\n');
    const base = r.commit('base');
    r.write('main.ts', 'export function run() { return 2; }\n');
    unlinkSync(join(r.path, 'remove.txt'));
    renameSync(join(r.path, 'old name.ts'), join(r.path, 'new name.ts'));
    r.write('binary.bin', Buffer.from([0, 9, 8, 7]));
    chmodSync(join(r.path, 'runner.sh'), 0o755);
    r.write('配置/naïve file.ts', 'export function unicode() { return "after"; }\n');
    r.write('settings.json', '{"feature":true}\n');
    const head = r.commit('head');
    const report = analyzeRepository({ repo: r.path, base, head });
    assert.deepEqual(report.files.map(f => f.path).sort(), ['main.ts', 'remove.txt', 'new name.ts', 'binary.bin', 'runner.sh', '配置/naïve file.ts', 'settings.json'].sort());
    assert.equal(report.files.find(f => f.path === 'remove.txt')!.status, 'deleted');
    const rename = report.files.find(f => f.path === 'new name.ts')!;
    assert.equal(rename.status, 'renamed');
    assert.equal(rename.oldPath, 'old name.ts');
    assert.equal(report.files.find(f => f.path === 'binary.bin')!.binary, true);
    const mode = report.files.find(f => f.path === 'runner.sh')!;
    assert.equal(mode.oldMode, '100644');
    assert.equal(mode.newMode, '100755');
    assert.equal(report.coverage.changedFiles, 7);
    assert.equal(report.repository.head, head);
    assert.equal(report.coverage.complete, true);
  } finally { r.close(); }
});

test('merge-base semantics omit target-only changes and record dirty work without analyzing it', () => {
  const r = repo();
  try {
    r.write('main.ts', 'export function run() { return 1; }\n');
    const ancestor = r.commit('common');
    r.git('checkout', '-b', 'feature');
    r.write('main.ts', 'export function run() { return 2; }\n');
    const head = r.commit('feature change');
    r.git('checkout', 'main');
    r.write('target-only.json', '{"target":true}\n');
    const target = r.commit('target change');
    r.write('main.ts', 'export function run() { throw new Error("dirty must not appear"); }\n');
    const report = analyzeRepository({ repo: r.path, base: target, head });
    assert.equal(report.repository.mergeBase, ancestor);
    assert.equal(report.repository.dirty, true);
    assert.deepEqual(report.files.map(f => f.path), ['main.ts']);
    assert.match(report.files[0]!.head!, /return 2/);
    assert.doesNotMatch(report.files[0]!.head!, /dirty must not appear/);
  } finally { r.close(); }
});

test('all distant hunks survive acquisition including unsupported non-code edits', () => {
  const r = repo();
  try {
    const oldLines = Array.from({ length: 90 }, (_, i) => `line ${i + 1}`);
    r.write('notes.txt', oldLines.join('\n') + '\n');
    const base = r.commit('base');
    const newLines = [...oldLines];
    for (const index of [1, 44, 87]) newLines[index] = `EDIT AT ${index + 1}`;
    r.write('notes.txt', newLines.join('\n') + '\n');
    const head = r.commit('distant edits');
    const report = analyzeRepository({ repo: r.path, base, head });
    const file = report.files[0]!;
    assert.equal(file.hunks.length, 3);
    assert.equal(report.coverage.totalHunks, 3);
    assert.deepEqual(file.hunks.flatMap(h => h.lines.filter(l => l.kind === 'add').map(l => l.text)), ['EDIT AT 2', 'EDIT AT 45', 'EDIT AT 88']);
    assert.equal(file.additions, 3);
    assert.equal(file.deletions, 3);
  } finally { r.close(); }
});

test('symlink objects are read as object contents, never followed into private files', () => {
  const r = repo();
  const outside = mkdtempSync(join(tmpdir(), 'flow-review-outside-'));
  try {
    writeFileSync(join(outside, 'private.txt'), 'PRIVATE_SENTINEL_DO_NOT_READ');
    r.write('link.ts', 'export const value = 1;\n');
    const base = r.commit('base');
    unlinkSync(join(r.path, 'link.ts'));
    symlinkSync(join(outside, 'private.txt'), join(r.path, 'link.ts'));
    const head = r.commit('symlink');
    const report = analyzeRepository({ repo: r.path, base, head });
    assert.equal(report.files[0]!.status, 'type-changed');
    assert.equal(report.files[0]!.newMode, '120000');
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SENTINEL_DO_NOT_READ/);
  } finally { r.close(); rmSync(outside, { recursive: true, force: true }); }
});

test('invalid revisions fail explicitly instead of fabricating empty successful reports', () => {
  const r = repo();
  try {
    r.write('main.ts', 'export const value = 1;\n');
    r.commit('base');
    assert.throws(() => analyzeRepository({ repo: r.path, base: 'not-a-real-ref', head: 'HEAD' }), /revision|ref|resolve|unknown|invalid|ambiguous|Git|git/i);
    assert.throws(() => analyzeRepository({ repo: r.path, base: '--help', head: 'HEAD' }));
  } finally { r.close(); }
});

test('configured external diff and text converters cannot execute during review', () => {
  const r = repo();
  const outside = mkdtempSync(join(tmpdir(), 'flow-review-execution-'));
  try {
    const sentinel = join(outside, 'executed.txt');
    const executable = join(outside, 'hostile-driver');
    writeFileSync(executable, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'EXECUTED');\nprocess.stdout.write('UNTRUSTED CONVERSION');\n`);
    chmodSync(executable, 0o755);
    r.git('config', 'diff.external', executable);
    r.git('config', 'diff.fixture.textconv', executable);
    r.write('.gitattributes', '*.ts diff=fixture\n');
    r.write('main.ts', 'export function run() { return 1; }\n');
    const base = r.commit('base');
    r.write('main.ts', 'export function run() { return 2; }\n');
    const head = r.commit('head');
    const report = analyzeRepository({ repo: r.path, base, head });
    assert.equal(existsSync(sentinel), false, 'Reviewing a repository must not execute its configured diff programs');
    assert.match(report.files.find(f => f.path === 'main.ts')!.head!, /return 2/);
    assert.doesNotMatch(JSON.stringify(report), /UNTRUSTED CONVERSION/);
  } finally { r.close(); rmSync(outside, { recursive: true, force: true }); }
});

test('oversized required blob fails with an explicit limit rather than a partial success', () => {
  const r = repo();
  try {
    r.write('main.ts', 'export function run() { return 1; }\n');
    const base = r.commit('base');
    r.write('large.txt', Buffer.alloc(8 * 1024 * 1024 + 1, 65));
    const head = r.commit('oversized file');
    assert.throws(() => analyzeRepository({ repo: r.path, base, head }), /limit|exceed|too large/i);
  } finally { r.close(); }
});

test('NUL-delimited inventory preserves tabs and newlines in filenames', () => {
  const r = repo();
  try {
    const name = 'odd\tfile\nname.ts';
    r.write(name, 'export function odd() { return 1; }\n');
    const base = r.commit('base');
    r.write(name, 'export function odd() { return 2; }\n');
    const head = r.commit('head');
    const report = analyzeRepository({ repo: r.path, base, head });
    assert.equal(report.files[0]!.path, name);
    assert.equal(report.units.find(u => u.name === 'odd')!.path, name);
    assert.match(report.files[0]!.head!, /return 2/);
  } finally { r.close(); }
});

test('bare repositories can be reviewed without creating or executing a working tree', () => {
  const r = repo();
  const holder = mkdtempSync(join(tmpdir(), 'flow-review-bare-'));
  try {
    r.write('main.ts', 'export function run() { return 1; }\n');
    const base = r.commit('base');
    r.write('main.ts', 'export function run() { return 2; }\n');
    const head = r.commit('head');
    const bare = join(holder, 'fixture.git');
    execFileSync('git', ['clone', '--bare', '--no-hardlinks', r.path, bare], { stdio: 'pipe' });
    const report = analyzeRepository({ repo: bare, base, head });
    assert.equal(report.repository.dirty, false);
    assert.equal(report.repository.base, base);
    assert.equal(report.repository.head, head);
    assert.equal(report.files[0]!.path, 'main.ts');
    assert.match(report.files[0]!.head!, /return 2/);
    assert.equal(existsSync(join(bare, 'main.ts')), false);
  } finally { r.close(); rmSync(holder, { recursive: true, force: true }); }
});

// Independent patch oracle: consume each Git hunk by its declared row counts,
// then retain every changed row and its original snapshot coordinate.
function gitChangedRows(patch: string) {
  const rows = patch.split('\n');
  const edits: { side: 'base' | 'head'; line: number; text: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rows[i]!);
    if (!header) continue;
    let oldLine = Number(header[1]), newLine = Number(header[3]);
    let oldRemaining = Number(header[2] ?? 1), newRemaining = Number(header[4] ?? 1);
    while ((oldRemaining || newRemaining) && ++i < rows.length) {
      const row = rows[i]!;
      if (row.startsWith('\\')) continue;
      if (row.startsWith('-')) { edits.push({ side: 'base', line: oldLine++, text: row.slice(1) }); oldRemaining--; }
      else if (row.startsWith('+')) { edits.push({ side: 'head', line: newLine++, text: row.slice(1) }); newRemaining--; }
      else if (row.startsWith(' ')) { oldLine++; newLine++; oldRemaining--; newRemaining--; }
      else assert.fail(`Unexpected row in native Git hunk: ${row}`);
    }
    assert.equal(oldRemaining, 0); assert.equal(newRemaining, 0);
  }
  return edits;
}

test('native Git is the raw changed-row oracle for repeated braces and blank-line alignments', () => {
  const r = repo();
  try {
    const before = Array.from({ length: 30 }, (_, i) => ['{', '', i % 3 === 0 ? '  alpha' : '  beta', '}', '', '']).flat();
    r.write('repeated.txt', before.join('\n') + '\n');
    const base = r.commit('base');
    const after = [...before];
    after.splice(8, 7); after.splice(31, 0, '', '}', '{', '  inserted', ''); after.splice(93, 9, '{', '', '  changed', '}', '');
    r.write('repeated.txt', after.join('\n') + '\n');
    const head = r.commit('head');
    const patch = execFileSync('git', ['--literal-pathspecs', '-C', r.path, 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', base, head, '--', 'repeated.txt'], { encoding: 'utf8', stdio: 'pipe' });
    const expected = gitChangedRows(patch);
    assert.ok(expected.length > 10);
    const report = analyzeRepository({ repo: r.path, base, head });
    const file = report.files.find(file => file.path === 'repeated.txt')!;
    const actual = file.hunks.flatMap(hunk => hunk.lines.filter(line => line.kind !== 'context').map(line => ({ side: line.kind === 'remove' ? 'base' : 'head', line: (line.kind === 'remove' ? line.oldLine : line.newLine)!, text: line.text })));
    assert.deepEqual(actual, expected, 'Raw rows must follow Git alignment, including repeated blank and brace lines');
    assert.deepEqual(report.edits.filter(edit => edit.fileId === file.id).map(edit => ({ side: edit.side, line: edit.line, text: edit.text })), expected, 'Canonical ownership must use those same native rows');
    const numstat = r.git('diff', '--numstat', '--no-ext-diff', '--no-textconv', base, head, '--', 'repeated.txt').split('\t');
    assert.equal(file.additions, Number(numstat[0])); assert.equal(file.deletions, Number(numstat[1]));
  } finally { r.close(); }
});

test('wildcard-looking filenames select one literal Git file rather than expanding pathspecs', () => {
  const r = repo();
  try {
    const exact = 'wild*[x].txt', sibling = 'wildAx.txt';
    r.write(exact, 'EXACT before\n'); r.write(sibling, 'SIBLING before\n');
    const base = r.commit('base');
    r.write(exact, 'EXACT after\n'); r.write(sibling, 'SIBLING after\n');
    const head = r.commit('head');
    const report = analyzeRepository({ repo: r.path, base, head });
    assert.equal(report.files.length, 2);
    const file = report.files.find(file => file.path === exact)!;
    assert.deepEqual(file.hunks.flatMap(hunk => hunk.lines.filter(line => line.kind !== 'context').map(line => line.text)), ['EXACT before', 'EXACT after']);
    assert.equal(file.additions, 1); assert.equal(file.deletions, 1);
    assert.equal(report.edits.filter(edit => edit.fileId === file.id).some(edit => edit.text.includes('SIBLING')), false);
  } finally { r.close(); }
});

test('ambiguous criss-cross merge bases are refused rather than chosen arbitrarily', () => {
  const r = repo();
  try {
    r.write('main.ts', 'export function run() { return 1; }\n');
    const root = r.commit('root');
    const tree = r.git('rev-parse', `${root}^{tree}`);
    const leftParent = r.git('commit-tree', tree, '-p', root, '-m', 'left branch');
    const rightParent = r.git('commit-tree', tree, '-p', root, '-m', 'right branch');
    const left = r.git('commit-tree', tree, '-p', leftParent, '-p', rightParent, '-m', 'left merges right');
    const right = r.git('commit-tree', tree, '-p', rightParent, '-p', leftParent, '-m', 'right merges left');
    assert.equal(r.git('merge-base', '--all', left, right).split('\n').length, 2, 'Fixture really has multiple best common ancestors');
    assert.throws(() => analyzeRepository({ repo: r.path, base: left, head: right }), /multiple|ambiguous|merge.?base|criss.?cross/i);
  } finally { r.close(); }
});

test('repository custom diff drivers cannot execute while native raw hunks are acquired', () => {
  const r = repo();
  const outside = mkdtempSync(join(tmpdir(), 'flow-review-custom-diff-'));
  try {
    const sentinel = join(outside, 'executed.txt'), driver = join(outside, 'diff-driver');
    writeFileSync(driver, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'EXECUTED');\nprocess.stdout.write('HOSTILE CUSTOM DIFF');\n`);
    chmodSync(driver, 0o755);
    r.git('config', 'diff.fixture.command', driver);
    r.write('.gitattributes', '*.txt diff=fixture\n');
    r.write('notes.txt', 'BEFORE\n');
    const base = r.commit('base');
    r.write('notes.txt', 'AFTER\n');
    const head = r.commit('head');
    const report = analyzeRepository({ repo: r.path, base, head });
    assert.equal(existsSync(sentinel), false);
    const file = report.files.find(file => file.path === 'notes.txt')!;
    assert.deepEqual(file.hunks.flatMap(hunk => hunk.lines.filter(line => line.kind !== 'context').map(line => line.text)), ['BEFORE', 'AFTER']);
    assert.equal(report.edits.length, 2);
  } finally { r.close(); rmSync(outside, { recursive: true, force: true }); }
});

test('replace objects cannot substitute different source behind pinned commit IDs', () => {
  const r = repo();
  try {
    r.write('main.ts', 'export function run() { return 1; }\n');
    const base = r.commit('base');
    r.write('main.ts', 'export function run() { return 2; }\n');
    const head = r.commit('head');
    r.write('main.ts', 'export function run() { return 999999; }\n');
    r.git('add', '--all');
    const replacement = r.git('commit-tree', r.git('write-tree'), '-p', base, '-m', 'replacement source');
    r.git('replace', head, replacement);
    assert.match(r.git('show', `${head}:main.ts`), /999999/, 'Fixture replacement really alters ordinary object lookup');
    const report = analyzeRepository({ repo: r.path, base, head });
    assert.equal(report.repository.head, head);
    assert.match(report.files[0]!.head!, /return 2/);
    assert.doesNotMatch(JSON.stringify(report), /999999/);
  } finally { r.close(); }
});

test('local promised objects fail explicitly without executing lazy-fetch transport', () => {
  const r = repo();
  const outside = mkdtempSync(join(tmpdir(), 'flow-review-promisor-'));
  try {
    r.write('main.ts', 'export function run() { return 1; }\n');
    const base = r.commit('base');
    r.write('main.ts', 'export function run() { return 2; }\n');
    const head = r.commit('head');
    const missingBlob = r.git('rev-parse', `${head}:main.ts`);
    const sentinel = join(outside, 'transport-executed'), transport = join(outside, 'controlled-transport');
    writeFileSync(transport, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'EXECUTED');\nprocess.exit(1);\n`);
    chmodSync(transport, 0o755);
    r.git('config', 'core.repositoryformatversion', '1');
    r.git('config', 'extensions.partialclone', 'origin');
    r.git('config', 'remote.origin.url', 'ssh://fixture.invalid/repository.git');
    r.git('config', 'remote.origin.promisor', 'true');
    r.git('config', 'remote.origin.partialclonefilter', 'blob:none');
    r.git('config', 'core.sshCommand', transport);
    rmSync(join(r.path, '.git', 'objects', missingBlob.slice(0, 2), missingBlob.slice(2)));
    // This controlled helper cannot connect anywhere. The positive control
    // proves an ordinary lookup would execute the configured lazy transport.
    assert.throws(() => r.git('cat-file', '-e', missingBlob));
    assert.equal(existsSync(sentinel), true);
    unlinkSync(sentinel);
    assert.throws(() => analyzeRepository({ repo: r.path, base, head }), /object|missing|read|Git|git/i);
    assert.equal(existsSync(sentinel), false, 'Local review must not run promised-object transport');
  } finally { r.close(); rmSync(outside, { recursive: true, force: true }); }
});

test('gitlink changes retain matching Subproject commit raw rows and complete source text', () => {
  const r = repo();
  try {
    r.write('notes.txt', 'before\n');
    const firstObject = r.commit('initial object');
    r.git('update-index', '--add', '--cacheinfo', '160000', firstObject, 'vendor/module');
    r.git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'base gitlink');
    const base = r.git('rev-parse', 'HEAD');
    r.git('update-index', '--cacheinfo', '160000', base, 'vendor/module');
    r.write('notes.txt', 'after\n'); r.git('add', '--', 'notes.txt');
    r.git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'changed gitlink and text');
    const head = r.git('rev-parse', 'HEAD');
    r.git('config', 'diff.ignoreSubmodules', 'all');
    r.git('config', 'diff.submodule', 'log');
    r.git('config', 'diff.suppressBlankEmpty', 'true');
    const report = analyzeRepository({ repo: r.path, base, head });
    const file = report.files.find(file => file.path === 'vendor/module')!;
    assert.equal(file.oldMode, '160000'); assert.equal(file.newMode, '160000');
    assert.equal(file.base, `Subproject commit ${firstObject}\n`);
    assert.equal(file.head, `Subproject commit ${base}\n`);
    assert.deepEqual(file.hunks.flatMap(hunk => hunk.lines.filter(line => line.kind !== 'context').map(line => line.text)), [`Subproject commit ${firstObject}`, `Subproject commit ${base}`]);
    assert.equal(report.edits.filter(edit => edit.fileId === file.id).length, 2);
  } finally { r.close(); }
});
