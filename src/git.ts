import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { analyzeSnapshots, fileDiff, hash, isSource, accountChangedLines } from './analyzer.js';
import type { ChangedFile, Report, Unit, Hunk } from './model.js';

interface Entry { mode: string; type: string; oid: string; path: string }
interface Change { modeOld: string; modeNew: string; status: string; path: string; oldPath?: string }
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_BLOB = 8 * 1024 * 1024;
function git(repo: string, args: string[], input?: string, trustedLazyFetch = false): Buffer {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.suppressBlankEmpty=false', '-c', 'diff.relative=false', '--no-replace-objects', ...(trustedLazyFetch ? [] : ['--no-lazy-fetch']), '--literal-pathspecs', '--no-pager', '-C', repo, ...args], {
      input, maxBuffer: MAX_BYTES + MAX_BLOB, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: trustedLazyFetch ? '0' : '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`Git ${args[0]} failed${stderr ? `: ${stderr}` : ''}`);
  }
}
export function parseGitHunks(file: string, patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined, oldLine = 0, newLine = 0;
  for (const row of patch.split('\n')) {
    const match = row.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (match) {
      current = { id: `h-${hash(file)}-${hunks.length}`, oldStart: Number(match[1]), oldLines: Number(match[2] ?? 1), newStart: Number(match[3]), newLines: Number(match[4] ?? 1), lines: [] };
      oldLine = current.oldStart; newLine = current.newStart; hunks.push(current); continue;
    }
    if (!current || ![' ', '+', '-'].includes(row[0])) continue;
    const kind = row[0] === '+' ? 'add' : row[0] === '-' ? 'remove' : 'context';
    if (oldLine >= current.oldStart + current.oldLines && newLine >= current.newStart + current.newLines) { current = undefined; continue; }
    current.lines.push({ kind, text: row.slice(1), ...(kind !== 'add' ? { oldLine: oldLine++ } : {}), ...(kind !== 'remove' ? { newLine: newLine++ } : {}) });
  }
  return hunks;
}
function revision(repo: string, ref: string): string {
  if (!ref || ref.startsWith('-')) throw new Error('Revision must be a commit or ref, not an option.');
  return git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).toString().trim();
}
function tree(repo: string, rev: string): Map<string, Entry> {
  return new Map(git(repo, ['ls-tree', '-r', '-z', rev]).toString().split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t');
    const [mode, type, oid] = row.slice(0, tab).split(' '), file = row.slice(tab + 1);
    return [file, { mode, type, oid, path: file }];
  }));
}
function changes(repo: string, base: string, head: string): Change[] {
  const fields = git(repo, ['diff', '--raw', '-z', '-M', '--ignore-submodules=none', '--no-ext-diff', '--no-textconv', base, head, '--']).toString().split('\0');
  const result: Change[] = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const metadata = fields[i++].slice(1).split(' '), first = fields[i++];
    const [modeOld, modeNew, , , status] = metadata;
    if (status.startsWith('R') || status.startsWith('C')) result.push({ modeOld, modeNew, status, oldPath: first, path: fields[i++] });
    else result.push({ modeOld, modeNew, status, path: first });
  }
  return result;
}
function acquire(repo: string, entries: Map<string, Entry>, wanted: Set<string>, trustedLazyFetch: boolean): Record<string, string> {
  const selected = [...entries.values()].filter(e => wanted.has(e.path));
  const blobs = [...new Set(selected.filter(e => e.type === 'blob').map(e => e.oid))];
  if (!blobs.length) return Object.fromEntries(selected.map(e => [e.path, `Subproject commit ${e.oid}\n`]));
  const checked = git(repo, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], blobs.join('\n') + '\n', trustedLazyFetch).toString().trim().split('\n');
  let total = 0;
  for (const line of checked) {
    const [, type, sizeText] = line.split(' '), size = Number(sizeText);
    if (type !== 'blob' || !Number.isFinite(size)) throw new Error('Could not read complete Git objects.');
    if (size > MAX_BLOB) throw new Error(`A required Git blob exceeds the ${MAX_BLOB / 1024 / 1024} MiB limit. Report was not generated; no changes were silently omitted.`);
    total += size;
  }
  if (total > MAX_BYTES) throw new Error('Required source snapshot exceeds 48 MiB. Report was not generated; narrow the repository or revision range.');
  const raw = git(repo, ['cat-file', '--batch'], blobs.join('\n') + '\n', trustedLazyFetch);
  const decoded = new Map<string, string>();
  let offset = 0;
  for (const oid of blobs) {
    const end = raw.indexOf(10, offset), header = raw.subarray(offset, end).toString().split(' '), size = Number(header[2]);
    if (header[0] !== oid || header[1] !== 'blob' || !Number.isFinite(size)) throw new Error('Git object stream was incomplete.');
    const bytes = raw.subarray(end + 1, end + 1 + size);
    if (bytes.length !== size) throw new Error('Git object content was truncated.');
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { content = '\0'; }
    decoded.set(oid, content);
    offset = end + 1 + size + 1;
  }
  return Object.fromEntries(selected.map(e => [e.path, e.type === 'commit' ? `Subproject commit ${e.oid}\n` : decoded.get(e.oid)!]));
}

export function analyzeRepository({ repo, base, head = 'HEAD', title, trustedLazyFetch = false }: { repo: string; base: string; head?: string; title?: string; trustedLazyFetch?: boolean }): Report {
  repo = resolve(repo);
  const bare = git(repo, ['rev-parse', '--is-bare-repository']).toString().trim() === 'true';
  const root = bare ? repo : git(repo, ['rev-parse', '--show-toplevel']).toString().trim();
  const baseSha = revision(repo, base), headSha = revision(repo, head);
  const bases = git(repo, ['merge-base', '--all', baseSha, headSha]).toString().trim().split('\n').filter(Boolean);
  if (bases.length !== 1) throw new Error('Multiple merge bases are not supported. Choose an explicit ancestor as --base; no report was generated.');
  const mergeBase = bases[0];
  const inventory = changes(repo, mergeBase, headSha), oldTree = tree(repo, mergeBase), newTree = tree(repo, headSha);
  const wanted = new Set([...oldTree.keys(), ...newTree.keys()].filter(file => isSource(file) || /(?:^|\/)tsconfig[^/]*\.json$/.test(file) || /\.d\.(?:ts|mts|cts)$/.test(file)));
  inventory.forEach(c => { wanted.add(c.path); if (c.oldPath) wanted.add(c.oldPath); });
  const before = acquire(repo, oldTree, wanted, trustedLazyFetch), after = acquire(repo, newTree, wanted, trustedLazyFetch);
  let url: string | undefined;
  try {
    const remote = git(repo, ['config', '--get', 'remote.origin.url']).toString().trim();
    const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (match) url = `https://github.com/${match[1]}`;
  } catch { /* A local repository needs no remote. */ }
  const report = analyzeSnapshots(before, after, { title: title ?? `${basename(root)} · ${base} → ${head}`, repository: {
    name: basename(root), ...(url ? { url } : {}), base: baseSha, head: headSha, mergeBase,
    dirty: !bare && !!git(repo, ['status', '--porcelain', '--untracked-files=no']).length,
  } });
  const output: ChangedFile[] = [];
  for (const change of inventory) {
    let file = report.files.find(f => f.path === change.path);
    const oldFile = change.oldPath ? report.files.find(f => f.path === change.oldPath) : undefined;
    if (change.oldPath) {
      const oldText = before[change.oldPath], newText = after[change.path];
      const binary = (oldText ?? '').includes('\0') || (newText ?? '').includes('\0');
      const hunks = binary ? [] : fileDiff(change.path, oldText ?? '', newText ?? '');
      const related = report.units.filter(u => u.changed && (u.path === change.path || u.path === change.oldPath));
      // A Git file rename is certain; matching declarations across it remains a reading convenience.
      // Keep old/new units separate instead of asserting semantic equivalence.
      for (const unit of related) unit.hunkIds = hunks.filter(h => h.lines.some(l =>
        l.kind === 'remove' && unit.base && l.oldLine !== undefined && l.oldLine >= unit.base.startLine && l.oldLine <= unit.base.endLine ||
        l.kind === 'add' && unit.head && l.newLine !== undefined && l.newLine >= unit.head.startLine && l.newLine <= unit.head.endLine)).map(h => h.id);
      file = { id: `f-${hash(change.path)}`, path: change.path, oldPath: change.oldPath, status: 'renamed', binary, hunks,
        additions: hunks.flatMap(h => h.lines).filter(l => l.kind === 'add').length, deletions: hunks.flatMap(h => h.lines).filter(l => l.kind === 'remove').length,
        ...(!binary && oldText !== undefined ? { base: oldText } : {}), ...(!binary && newText !== undefined ? { head: newText } : {}), unitIds: related.map(u => u.id) };
      if (oldFile) report.files = report.files.filter(f => f.id !== oldFile.id);
    }
    if (!file) {
      const unit: Unit = { id: `u-file-${hash(change.path)}`, name: basename(change.path), path: change.path, kind: 'file', changed: true, exported: false, hunkIds: [], markers: ['Metadata change'] };
      report.units.push(unit);
      file = { id: `f-${hash(change.path)}`, path: change.path, status: 'modified', additions: 0, deletions: 0, binary: false, hunks: [], unitIds: [unit.id] };
    }
    file.oldMode = change.modeOld; file.newMode = change.modeNew;
    // The original Git diff, not a second diff algorithm, defines review lines.
    if (!file.binary) {
      const patch = git(repo, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--submodule=short', '--ignore-submodules=none', '-M', mergeBase, headSha, '--', ...(change.oldPath ? [change.oldPath] : []), change.path]).toString();
      file.hunks = parseGitHunks(change.path, patch);
      file.additions = file.hunks.flatMap(h => h.lines).filter(l => l.kind === 'add').length;
      file.deletions = file.hunks.flatMap(h => h.lines).filter(l => l.kind === 'remove').length;
    }
    if (change.status.startsWith('T')) file.status = 'type-changed';
    if (file.oldMode !== file.newMode) {
      for (const unit of report.units.filter(u => file!.unitIds.includes(u.id))) unit.markers = [...new Set([...unit.markers, `Mode ${file.oldMode} → ${file.newMode}`])];
    }
    output.push(file);
  }
  report.files = output;
  report.edits = accountChangedLines(output, report.units);
  report.id = hash(`${mergeBase}:${headSha}:${url ?? root}:${report.analysis.toolVersion}:${report.analysis.typescriptVersion}`);
  report.coverage.changedFiles = output.length;
  report.coverage.totalHunks = output.reduce((n, f) => n + f.hunks.length, 0);
  const validHunks = new Set(output.flatMap(f => f.hunks.map(h => h.id)));
  report.coverage.mappedHunks = new Set(report.units.flatMap(u => u.hunkIds).filter(id => validHunks.has(id))).size;
  if (report.coverage.mappedHunks !== report.coverage.totalHunks) throw new Error('Internal change accounting failed; report was not generated.');
  return report;
}
