import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeRepository } from './git.js';
import type { Report } from './model.js';

export function parsePullRequestURL(value: string): { owner: string; repo: string; number: number; url: string } {
  const match = value.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/);
  if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..' || !Number.isSafeInteger(Number(match[3]))) throw new Error('Expected https://github.com/owner/repo/pull/number (no query, fragment, or credentials).');
  return { owner: match[1], repo: match[2], number: Number(match[3]), url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` };
}

export function analyzePullRequest(url: string, title?: string): Report {
  const pr = parsePullRequestURL(url);
  let metadata: { title: string; base: { sha: string }; head: { sha: string }; changed_files: number };
  try {
    metadata = JSON.parse(execFileSync('gh', ['api', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch { throw new Error('Could not read this PR with GitHub CLI. Install gh, sign in with gh auth login, and verify access. Nothing was uploaded.'); }
  if (!/^[a-f0-9]{40}$/.test(metadata.base?.sha ?? '') || !/^[a-f0-9]{40}$/.test(metadata.head?.sha ?? '') || typeof metadata.title !== 'string') throw new Error('GitHub returned invalid snapshot metadata.');
  const cache = mkdtempSync(join(tmpdir(), 'flow-review-pr-'));
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'maintenance.auto=false', ...args], {
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  try {
    git(['init', '--bare', cache]);
    // Let authenticated gh configure the transport for this temporary repository only.
    // The existing account remains untouched; credentials are never read or persisted.
    git(['-C', cache, 'remote', 'add', 'origin', `https://github.com/${pr.owner}/${pr.repo}.git`]);
    const fetch = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', '-C', cache, 'fetch', '--no-tags', '--filter=blob:none', 'origin', metadata.base.sha, metadata.head.sha];
    git(fetch);
    // Lazy blob fetch uses the same approved GitHub destination and gh credential helper.
    git(['-C', cache, 'config', 'credential.helper', '!gh auth git-credential']);
    const report = analyzeRepository({ repo: cache, base: metadata.base.sha, head: metadata.head.sha, trustedLazyFetch: true, title: title ?? `${pr.owner}/${pr.repo} #${pr.number} · ${metadata.title}` });
    report.repository.name = `${pr.owner}/${pr.repo}`;
    if (Number.isSafeInteger(metadata.changed_files) && report.files.length !== metadata.changed_files) report.diagnostics.push({ side: 'head', message: 'GitHub file-count metadata differs from the pinned Git comparison. The report shows the acquired Git snapshot; the PR may have changed during generation.' });
    return report;
  } catch (error) {
    const message = (error as Error).message;
    throw new Error(`PR analysis failed: ${message}. No report was generated.`);
  } finally { rmSync(cache, { recursive: true, force: true }); }
}
