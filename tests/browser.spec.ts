import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('standalone report runs from disk without a server or network connection', async ({ page, context }) => {
  const network: string[] = [];
  page.on('request', request => { if (/^https?:/i.test(request.url())) network.push(request.url()); });
  await context.setOffline(true);
  await page.goto(pathToFileURL(resolve('reports/demo.html')).href);
  await page.getByRole('button', { name: /^Start at / }).first().click();
  await page.getByRole('button', { name: 'Raw file diff', exact: true }).first().click();
  await expect(page.getByTestId('raw-hunk').first()).toBeVisible();
  expect(network).toEqual([]);
});

test('demo is a usable report with flow starts, file ledger and raw diffs', async ({ page }) => {
  await page.goto('/demo.html');
  await expect(page.getByRole('navigation', { name: 'Flow navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Change ledger' })).toBeVisible();
  const starts = page.getByRole('button', { name: /^Start at / });
  await expect(starts.first()).toBeVisible();
  await starts.first().click();
  await expect(page.getByRole('group', { name: 'Code revision' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Raw file diff', exact: true }).first().click();
  await expect(page.getByTestId('raw-hunk').first()).toBeVisible();
});

test('opening code does not mark it reviewed; explicit reading state survives reload', async ({ page }) => {
  await page.goto('/fixture.html');
  await page.getByRole('button', { name: 'Start at entry', exact: true }).click();
  const reviewed = page.getByRole('button', { name: 'Mark reviewed: entry', exact: true });
  await expect(reviewed).toBeVisible();
  await reviewed.click();
  await expect(page.getByRole('button', { name: 'Mark unread: entry', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Start at entry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark unread: entry', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset reading state', exact: true }).click();
  await page.getByRole('button', { name: 'Clear marks and notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark reviewed: entry', exact: true })).toBeVisible();
});

test('review state is isolated by report snapshot after loading changed contents', async ({ page }) => {
  await page.goto('/fixture.html');
  await page.getByRole('button', { name: 'Start at entry', exact: true }).click();
  await page.getByRole('button', { name: 'Mark reviewed: entry', exact: true }).click();
  // Loading a different report into the same origin must not reuse the old snapshot state.
  await page.goto('/fixture-changed.html');
  await page.getByRole('button', { name: 'Start at entry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark reviewed: entry', exact: true })).toBeVisible();
});

test('deleted guard opens from before side; unchanged wrapper leads to inline changed callee', async ({ page }) => {
  await page.goto('/fixture.html');
  await page.getByRole('button', { name: 'Start at entry', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Expand guard.*from before line/ })).toBeVisible();
  await page.getByRole('button', { name: /^Expand guard.*from before line/ }).click();
  await expect(page.getByRole('article', { name: 'guard source', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark reviewed: entry', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Expand guard.*from after line/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Expand wrapper.*from after line/ }).click();
  await expect(page.getByRole('article', { name: 'wrapper source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Expand shared.*from after line/ }).click();
  await expect(page.getByRole('button', { name: 'Mark reviewed: shared', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark reviewed: entry', exact: true })).toBeVisible();
  await expect(page.getByTestId('code-line').filter({ hasText: 'input * 3' }).first()).toBeVisible();
});

test('search keeps non-code changes discoverable and raw file shows every distant hunk', async ({ page, request }) => {
  await page.goto('/fixture.html');
  await page.getByRole('textbox', { name: 'Search changes' }).fill('settings.json');
  await expect(page.getByRole('button', { name: 'Open file settings.json', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open file settings.json', exact: true }).click();
  const report = await (await request.get('/fixture.json')).json();
  const file = report.files.find((f: { path: string }) => f.path === 'settings.json');
  expect(file.hunks.length).toBe(3);
  await expect(page.getByTestId('raw-hunk')).toHaveCount(file.hunks.length);
  for (const index of [1, 25, 48]) await expect(page.getByText(`"setting-${index}": true`, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark file reviewed: settings.json', exact: true }).first()).toBeVisible();
});

test('revision controls filter source lines and their call links on the same side', async ({ page }) => {
  await page.goto('/fixture.html');
  await page.getByRole('button', { name: 'Start at entry', exact: true }).click();
  const revision = page.getByRole('group', { name: 'Code revision' });
  await revision.getByRole('button', { name: 'After', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Expand guard/ })).toHaveCount(0);
  await expect(page.getByTestId('code-line').filter({ hasText: 'guard(input)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Expand wrapper.*from after line/ })).toBeVisible();
  await revision.getByRole('button', { name: 'Before', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Expand guard.*from before line/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Expand wrapper.*from after line/ })).toHaveCount(0);
  await expect(page.getByTestId('code-line').filter({ hasText: 'wrapper(input + 1)' })).toHaveCount(0);
});

test('shared callee has one edited-line census across multiple reading paths', async ({ page, request }) => {
  const report = await (await request.get('/fixture.json')).json();
  const sharedId = report.units.find((unit: { name: string }) => unit.name === 'shared').id;
  const sharedEdits = report.edits.filter((edit: { unitId: string }) => edit.unitId === sharedId).length;
  expect(sharedEdits).toBeGreaterThan(0);
  await page.goto('/fixture.html');
  await page.getByRole('button', { name: 'Start at entry', exact: true }).click();
  await page.getByRole('button', { name: /^Expand wrapper.*from after line/ }).click();
  await page.getByRole('button', { name: /^Expand shared.*from after line/ }).click();
  await page.getByRole('button', { name: 'Mark reviewed: shared', exact: true }).click();
  await expect(page.getByLabel('Changed line progress', { exact: true })).toHaveText(`${sharedEdits} / ${report.edits.length} changed lines reviewed`);
  await page.getByRole('button', { name: 'Start at other', exact: true }).click();
  await page.getByRole('button', { name: /^Expand shared.*from after line/ }).click();
  await expect(page.getByRole('button', { name: 'Mark unread: shared', exact: true })).toBeVisible();
  await expect(page.getByLabel('Changed line progress', { exact: true })).toHaveText(`${sharedEdits} / ${report.edits.length} changed lines reviewed`);
});

test('identical revisions show an empty report rather than unrelated unchanged source', async ({ page }) => {
  await page.goto('/empty.html');
  await expect(page.getByRole('heading', { name: 'No changes in this report', exact: true })).toBeVisible();
  await expect(page.getByTestId('code-line')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Start at / })).toHaveCount(0);
  await expect(page.getByLabel('Changed line progress', { exact: true })).toHaveText('0 / 0 changed lines reviewed');
});

test('inferred return contracts expose untouched caller source evidence', async ({ page }) => {
  await page.goto('/contracts.html');
  await page.getByRole('button', { name: 'Start at lookup', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Contract & callers/ }).first().click();
  await expect(page.getByText(/Inferred/).first()).toBeVisible();
  await expect(page.getByText(/Untouched callers/).first()).toBeVisible();
  const caller = page.getByRole('button', { name: /^Open caller caller from after line/ });
  await expect(caller).toBeVisible();
  await caller.click();
  await expect(page.getByRole('article', { name: 'caller source', exact: true })).toBeVisible();
  await expect(page.getByTestId('code-line').filter({ hasText: 'lookup(false)' }).first()).toBeVisible();
});

test('literal CR and Unicode separators retain one source line and same-line call provenance', async ({ page }) => {
  await page.goto('/terminators.html');
  await page.getByRole('button', { name: 'Start at target', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Contract & callers/ }).first().click();
  await page.getByRole('button', { name: 'Open caller entry from after line 1', exact: true }).click();
  const entry = page.getByRole('article', { name: 'entry source', exact: true });
  await expect(entry.getByTestId('code-line')).toHaveCount(1);
  await expect(entry.getByTestId('code-line')).toHaveAttribute('data-old-line', '1');
  await expect(entry.getByTestId('code-line')).toHaveAttribute('data-new-line', '1');
  await expect(entry.getByRole('button', { name: 'Expand target from after line 1', exact: true })).toBeVisible();
  await entry.getByRole('button', { name: 'Expand target from after line 1', exact: true }).click();
  await expect(page.getByRole('article', { name: 'target source', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Raw file diff', exact: true }).first().click();
  for (const control of ['[CR]', '[U+2028]', '[U+2029]']) await expect(page.getByText(control, { exact: true }).first()).toBeVisible();
});

test('unknown external return contract is labeled as unknown in the reader', async ({ page }) => {
  await page.goto('/unknown-contract.html');
  await page.getByRole('button', { name: 'Start at opaque', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Contract & callers/ }).first().click();
  await expect(page.getByText('Contract unknown', { exact: true }).first()).toBeVisible();
});

test('next unreviewed navigation leaves explicit changed-line review state untouched', async ({ page }) => {
  await page.goto('/fixture.html');
  await page.getByRole('button', { name: 'Start at entry', exact: true }).click();
  await page.getByRole('button', { name: 'Mark reviewed: entry', exact: true }).click();
  const before = await page.getByLabel('Changed line progress', { exact: true }).textContent();
  await page.getByRole('button', { name: 'Next unreviewed', exact: true }).click();
  await expect(page.getByLabel('Changed line progress', { exact: true })).toHaveText(before!);
  await expect(page.getByRole('button', { name: 'Mark unread: entry', exact: true })).toHaveCount(0);
});

test('caller census distinguishes an edited call site from a caller changed elsewhere', async ({ page }) => {
  await page.goto('/caller-sites.html');
  await page.getByRole('button', { name: 'Start at target', exact: true }).click();
  await page.locator('summary').filter({ hasText: /^Contract & callers/ }).first().click();
  await expect(page.getByRole('button', { name: 'Open caller callerElsewhere from after line 3', exact: true }).getByText('Caller changed elsewhere', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open caller callerEdited from after line 6', exact: true }).getByText('Call-site line edited', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open caller untouched from after line 7', exact: true }).getByText('Call-site line untouched', { exact: true })).toBeVisible();
});

test('rename, permissions and final-newline metadata stay visible in the raw file reader', async ({ page }) => {
  await page.goto('/metadata.html');
  await page.getByRole('button', { name: 'Open file mode.ts', exact: true }).click();
  const raw = page.getByRole('article', { name: 'mode.ts raw diff', exact: true });
  await expect(raw.getByText('previous.ts → mode.ts', { exact: true })).toBeVisible();
  await expect(raw.getByText('Mode 100644 → 100755', { exact: true })).toBeVisible();
  await expect(raw.getByText('No final newline after', { exact: true })).toBeVisible();
});

test('valid report imports; malformed reports fail visibly without losing current report', async ({ page, request }) => {
  await page.goto('/demo.html');
  const fixture = await (await request.get('/fixture.json')).body();
  await page.getByLabel('Import report JSON', { exact: true }).setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: fixture });
  await expect(page.getByRole('button', { name: 'Start at entry', exact: true })).toBeVisible();
  for (const content of ['{invalid json', JSON.stringify({ schemaVersion: 1, files: [{ path: 'fake.ts' }] })]) {
    await page.getByLabel('Import report JSON', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(content) });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start at entry', exact: true })).toBeVisible();
  }
});

test('hostile source stays readable, does not execute and causes no external requests', async ({ page }) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4317') && !request.url().startsWith('data:')) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/hostile.html');
  await page.getByRole('button', { name: 'Start at hostile', exact: true }).click();
  await expect(page.getByTestId('code-line').filter({ hasText: '__flowReviewXss' }).first()).toBeVisible();
  expect(await page.evaluate(() => ({ source: (globalThis as any).__flowReviewXss, title: (globalThis as any).__titleXss, img: (globalThis as any).__imgXss }))).toEqual({ source: undefined, title: undefined, img: undefined });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('narrow screen contains long code in scrollable panels without page-wide overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/hostile.html');
  await page.getByRole('button', { name: 'Start at hostile', exact: true }).click();
  await page.getByRole('button', { name: 'Raw file diff', exact: true }).first().click();
  await expect(page.getByTestId('raw-hunk').first()).toBeVisible();
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 2);
});
