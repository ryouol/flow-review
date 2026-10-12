import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePullRequestURL } from '../src/github.js';

test('GitHub PR parser returns a canonical narrow HTTPS URL', () => {
  assert.deepEqual(parsePullRequestURL('https://github.com/honojs/hono/pull/5547'), { owner: 'honojs', repo: 'hono', number: 5547, url: 'https://github.com/honojs/hono/pull/5547' });
  assert.deepEqual(parsePullRequestURL('https://github.com/example-org/repo.name/pull/1/'), { owner: 'example-org', repo: 'repo.name', number: 1, url: 'https://github.com/example-org/repo.name/pull/1' });
});

test('GitHub PR parser rejects ambiguous hosts, credentials, options and non-PR paths', () => {
  for (const value of [
    'http://github.com/owner/repo/pull/1',
    'https://github.com.evil.invalid/owner/repo/pull/1',
    'https://github.com@evil.invalid/owner/repo/pull/1',
    'https://user:pass@github.com/owner/repo/pull/1',
    'https://github.com/owner/repo/pull/1?head=evil',
    'https://github.com/owner/repo/pull/1#files',
    'https://github.com/owner/repo/issues/1',
    'https://github.com/owner/repo/pull/0',
    'https://github.com/owner/repo/pull/-1',
    'https://github.com/owner/repo/pull/1.5',
    'https://github.com/owner/repo/pull/9007199254740992',
    'https://github.com/owner/repo/pull/1/files',
    'https://github.com/owner/repo/pull/1;touch%20/tmp/sentinel',
    '--upload-pack=malicious-command',
    'file:///owner/repo/pull/1',
  ]) assert.throws(() => parsePullRequestURL(value), /GitHub|pull|URL|invalid/i, value);
});
