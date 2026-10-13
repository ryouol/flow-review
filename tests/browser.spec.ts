import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function openUnit(page: Page, name: string, path: string) {
  const nav = page.getByRole('navigation', { name: 'Change navigation', exact: true });
  await expect(nav).toBeVisible();
  const target = nav.getByRole('button', { name: `Open ${name}`, exact: true });
  if (!await target.isVisible()) await nav.getByRole('button', { name: `Toggle file ${path}`, exact: true }).click();
  await target.click();
}
const peek = (page: Page) => page.getByRole('complementary', { name: 'Declaration peek', exact: true });
const lineProgress = (page: Page) => page.getByLabel('Changed line progress', { exact: true });

test('public entry waits for a demo or local report and imports private data without network requests', async ({ page, request }) => {
  const external: string[] = [];
  page.on('request', event => { if (!event.url().startsWith('http://127.0.0.1:4317') && !event.url().startsWith('data:')) external.push(event.url()); });
  await page.goto('/public-entry.html');
  await expect(page.getByTestId('code-line')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try demo', exact: true }).click();
  await openUnit(page, 'submitOrder', 'src/checkout.ts');
  await expect(page.getByTestId('code-line').first()).toBeVisible();
  const fixture = await (await request.get('/fixture.json')).body();
  await page.getByLabel('Import report JSON', { exact: true }).setInputFiles({ name: 'private-review.json', mimeType: 'application/json', buffer: fixture });
  await openUnit(page, 'entry', 'entry.ts');
  await expect(page.getByRole('article', { name: 'entry source', exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test('standalone report runs from disk without a server or network connection', async ({ page, context }) => {
  const network: string[] = [];
  page.on('request', request => { if (/^https?:/i.test(request.url())) network.push(request.url()); });
  await context.setOffline(true);
  await page.goto(pathToFileURL(resolve('reports/demo.html')).href);
  await openUnit(page, 'submitOrder', 'src/checkout.ts');
  await page.getByRole('button', { name: 'Raw file diff', exact: true }).click();
  await expect(page.getByTestId('raw-hunk').first()).toBeVisible();
  expect(network).toEqual([]);
});

test('one hierarchical navigator opens unique symbols and defaults to before/after split', async ({ page }) => {
  await page.goto('/fixture.html');
  const nav = page.getByRole('navigation', { name: 'Change navigation', exact: true });
  await expect(nav).toHaveCount(1);
  await openUnit(page, 'entry', 'entry.ts');
  await expect(nav.getByRole('button', { name: 'Open entry', exact: true })).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Code revision' }).getByRole('button', { name: 'Both', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="code-line"][data-side="base"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="code-line"][data-side="head"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Raw file diff', exact: true }).click();
  await expect(page.getByTestId('raw-hunk').first()).toBeVisible();
});

test('opening code does not mark it reviewed; explicit reading state survives reload', async ({ page }) => {
  await page.goto('/fixture.html'); await openUnit(page, 'entry', 'entry.ts');
  await expect(page.getByRole('button', { name: 'Mark reviewed: entry', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark reviewed: entry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark unread: entry', exact: true })).toBeVisible();
  await page.reload(); await openUnit(page, 'entry', 'entry.ts');
  await expect(page.getByRole('button', { name: 'Mark unread: entry', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review menu', exact: true }).click();
  await page.getByRole('button', { name: 'Reset reading state', exact: true }).click();
  await page.getByRole('button', { name: 'Clear marks and notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark reviewed: entry', exact: true })).toBeVisible();
});

test('review state is isolated by report snapshot after loading changed contents', async ({ page }) => {
  await page.goto('/fixture.html'); await openUnit(page, 'entry', 'entry.ts');
  await page.getByRole('button', { name: 'Mark reviewed: entry', exact: true }).click();
  await page.goto('/fixture-changed.html'); await openUnit(page, 'entry', 'entry.ts');
  await expect(page.getByRole('button', { name: 'Mark reviewed: entry', exact: true })).toBeVisible();
});

test('removed guard and unchanged wrapper stay navigable through one replaceable peek', async ({ page }) => {
  await page.goto('/fixture.html'); await openUnit(page, 'entry', 'entry.ts');
  await page.getByRole('button', { name: /^Peek guard.*from before line/ }).click();
  await expect(peek(page)).toHaveCount(1);
  await expect(peek(page).getByText('guard', { exact: true })).toBeVisible();
  await expect(peek(page).getByTestId('code-line').filter({ hasText: 'negative input' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Peek guard.*from after line/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Peek wrapper.*from after line/ }).click();
  await expect(peek(page)).toHaveCount(1);
  await expect(peek(page).getByText('guard', { exact: true })).toHaveCount(0);
  await expect(peek(page).getByText('wrapper', { exact: true })).toBeVisible();
  await peek(page).getByRole('button', { name: /^Peek shared.*from after line/ }).click();
  await expect(peek(page)).toHaveCount(1);
  await expect(peek(page).getByText('wrapper', { exact: true })).toHaveCount(0);
  await expect(peek(page).getByText('shared', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'entry source', exact: true })).toBeVisible();
  await expect(peek(page).getByTestId('code-line').filter({ hasText: 'input * 3' }).first()).toBeVisible();
  await peek(page).getByRole('button', { name: 'Back in peek', exact: true }).click();
  await expect(peek(page).getByText('wrapper', { exact: true })).toBeVisible();
});

test('peek keyboard close restores its originating call without review credit', async ({ page }) => {
  await page.goto('/fixture.html'); await openUnit(page, 'entry', 'entry.ts');
  const origin = page.getByRole('button', { name: /^Peek wrapper.*from after line/ });
  await origin.focus(); await origin.press('Enter');
  await expect(peek(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0); await expect(origin).toBeFocused();
  await expect(page.getByRole('button', { name: 'Mark reviewed: entry', exact: true })).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Search changes', exact: true })).toBeFocused();
});

test('search keeps non-code changes discoverable and raw file shows every original hunk', async ({ page, request }) => {
  await page.goto('/fixture.html');
  await page.getByRole('textbox', { name: 'Search changes' }).fill('settings.json');
  await page.getByRole('button', { name: 'Open file settings.json', exact: true }).click();
  const report = await (await request.get('/fixture.json')).json();
  const file = report.files.find((f: { path: string }) => f.path === 'settings.json');
  expect(file.hunks.length).toBe(3);
  await expect(page.getByTestId('raw-hunk')).toHaveCount(file.hunks.length);
  for (const hunk of file.hunks) await expect(page.locator(`[data-testid="raw-hunk"][data-hunk-id="${hunk.id}"]`)).toHaveCount(1);
  for (const index of [1, 25, 48]) await expect(page.getByTestId('code-line').filter({ hasText: `"setting-${index}": true` }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark file reviewed: settings.json', exact: true })).toBeVisible();
});

test('revision controls filter source and calls on their original side', async ({ page }) => {
  await page.goto('/fixture.html'); await openUnit(page, 'entry', 'entry.ts');
  const revision = page.getByRole('group', { name: 'Code revision' });
  await revision.getByRole('button', { name: 'After', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Peek guard/ })).toHaveCount(0);
  await expect(page.getByTestId('code-line').filter({ hasText: 'guard(input)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Peek wrapper.*from after line/ })).toBeVisible();
  await revision.getByRole('button', { name: 'Before', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Peek guard.*from before line/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Peek wrapper.*from after line/ })).toHaveCount(0);
  await expect(page.getByTestId('code-line').filter({ hasText: 'wrapper(input + 1)' })).toHaveCount(0);
});

test('shared callee has one edited-line census across different peek paths', async ({ page, request }) => {
  const report = await (await request.get('/fixture.json')).json();
  const sharedId = report.units.find((unit: { name: string }) => unit.name === 'shared').id;
  const sharedEdits = report.edits.filter((edit: { unitId: string }) => edit.unitId === sharedId).length;
  expect(sharedEdits).toBeGreaterThan(0);
  await page.goto('/fixture.html'); await openUnit(page, 'entry', 'entry.ts');
  await page.getByRole('button', { name: /^Peek wrapper.*from after line/ }).click();
  await peek(page).getByRole('button', { name: /^Peek shared.*from after line/ }).click();
  await peek(page).getByRole('button', { name: 'Open target shared', exact: true }).click();
  await page.getByRole('button', { name: 'Mark reviewed: shared', exact: true }).click();
  await expect(lineProgress(page)).toHaveText(`${sharedEdits} / ${report.edits.length} changed lines reviewed`);
  await openUnit(page, 'other', 'entry.ts');
  await page.getByRole('button', { name: /^Peek shared.*from after line/ }).click();
  await peek(page).getByRole('button', { name: 'Open target shared', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark unread: shared', exact: true })).toBeVisible();
  await expect(lineProgress(page)).toHaveText(`${sharedEdits} / ${report.edits.length} changed lines reviewed`);
});

test('identical revisions show an empty report rather than unrelated unchanged source', async ({ page }) => {
  await page.goto('/empty.html');
  await expect(page.getByRole('heading', { name: 'No changes in this report', exact: true })).toBeVisible();
  await expect(page.getByTestId('code-line')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Change navigation' }).getByRole('button', { name: /^Open / })).toHaveCount(0);
  await expect(lineProgress(page)).toHaveText('0 / 0 changed lines reviewed');
});

test('inferred return contracts expose untouched caller source evidence', async ({ page }) => {
  await page.goto('/contracts.html'); await openUnit(page, 'lookup', 'lookup.ts');
  await page.getByRole('button', { name: 'Contract & callers', exact: true }).click();
  await expect(page.getByText('Inferred return type', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Untouched callers/).first()).toBeVisible();
  await page.getByRole('button', { name: /^Open caller caller from after line/ }).click();
  await expect(page.getByRole('article', { name: 'caller source', exact: true })).toBeVisible();
  await expect(page.getByTestId('code-line').filter({ hasText: 'lookup(false)' }).first()).toBeVisible();
});

test('literal CR and Unicode separators retain one LF line per split pane', async ({ page }) => {
  await page.goto('/terminators.html'); await openUnit(page, 'target', 'main.ts');
  await page.getByRole('button', { name: 'Contract & callers', exact: true }).click();
  await page.getByRole('button', { name: 'Open caller entry from after line 1', exact: true }).click();
  const entry = page.getByRole('article', { name: 'entry source', exact: true });
  await expect(entry.getByTestId('code-line')).toHaveCount(2);
  await expect(entry.locator('[data-testid="code-line"][data-side="base"]')).toHaveAttribute('data-old-line', '1');
  await expect(entry.locator('[data-testid="code-line"][data-side="head"]')).toHaveAttribute('data-new-line', '1');
  await entry.getByRole('button', { name: 'Peek target from after line 1', exact: true }).click();
  await expect(peek(page).getByText('target', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Raw file diff', exact: true }).first().click();
  for (const control of ['[CR]', '[U+2028]', '[U+2029]']) await expect(page.getByText(control, { exact: true }).first()).toBeVisible();
});

test('unknown external return contract remains visibly unknown', async ({ page }) => {
  await page.goto('/unknown-contract.html'); await openUnit(page, 'opaque', 'main.ts');
  await page.getByRole('button', { name: 'Contract & callers', exact: true }).click();
  await expect(page.getByText('Contract unknown', { exact: true }).first()).toBeVisible();
});

test('next unreviewed navigation does not credit any changed lines', async ({ page }) => {
  await page.goto('/fixture.html'); await openUnit(page, 'entry', 'entry.ts');
  await page.getByRole('button', { name: 'Mark reviewed: entry', exact: true }).click();
  const before = await lineProgress(page).textContent();
  await page.getByRole('button', { name: 'Next unreviewed', exact: true }).click();
  await expect(lineProgress(page)).toHaveText(before!);
  await expect(page.getByRole('button', { name: 'Mark unread: entry', exact: true })).toHaveCount(0);
});

test('caller census distinguishes a modified source line from a caller changed elsewhere', async ({ page }) => {
  await page.goto('/caller-sites.html'); await openUnit(page, 'target', 'main.ts');
  await page.getByRole('button', { name: 'Contract & callers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open caller callerElsewhere from after line 3', exact: true }).getByText('Caller changed elsewhere', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open caller callerEdited from after line 6', exact: true }).getByText('Call-site line edited', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open caller untouched from after line 7', exact: true }).getByText('Call-site line untouched', { exact: true })).toBeVisible();
});

test('raw metadata stays visible and requires one separate explicit review credit', async ({ page }) => {
  await page.goto('/metadata.html'); await openUnit(page, 'run', 'mode.ts');
  await page.getByRole('button', { name: 'Mark reviewed: run', exact: true }).click();
  const progress = page.getByLabel('Review progress', { exact: true }).getByRole('progressbar');
  const before = Number(await progress.getAttribute('value'));
  await page.getByRole('button', { name: 'Open file mode.ts', exact: true }).click();
  const raw = page.getByRole('article', { name: 'mode.ts raw diff', exact: true });
  await expect(raw.getByText('previous.ts → mode.ts', { exact: true })).toBeVisible();
  await expect(raw.getByText('Mode 100644 → 100755', { exact: true })).toBeVisible();
  await expect(raw.getByText('No final newline after', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark file reviewed: mode.ts', exact: true }).click();
  await expect(progress).toHaveAttribute('value', String(before + 1));
  await expect(page.getByRole('button', { name: 'Mark file unread: mode.ts', exact: true })).toBeVisible();
});

test('valid reports import and malformed imports preserve the current report', async ({ page, request }) => {
  await page.goto('/demo.html');
  const fixture = await (await request.get('/fixture.json')).body();
  await page.getByLabel('Import report JSON', { exact: true }).setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: fixture });
  await openUnit(page, 'entry', 'entry.ts');
  for (const content of ['{invalid json', JSON.stringify({ schemaVersion: 1, files: [{ path: 'fake.ts' }] })]) {
    await page.getByLabel('Import report JSON', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(content) });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Change navigation' }).getByRole('button', { name: 'Open entry', exact: true })).toBeVisible();
  }
});

test('hostile source remains readable without execution or external requests', async ({ page }) => {
  const external: string[] = [], errors: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4317') && !request.url().startsWith('data:')) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/hostile.html'); await openUnit(page, 'hostile', 'hostile.ts');
  await expect(page.getByTestId('code-line').filter({ hasText: '__flowReviewXss' }).first()).toBeVisible();
  expect(await page.evaluate(() => ({ source: (globalThis as any).__flowReviewXss, title: (globalThis as any).__titleXss, img: (globalThis as any).__imgXss }))).toEqual({ source: undefined, title: undefined, img: undefined });
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('mobile file navigation is keyboard operable and long source cannot overflow the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/hostile.html');
  const toggle = page.getByRole('button', { name: 'Toggle files', exact: true });
  const nav = page.getByRole('navigation', { name: 'Change navigation', exact: true });
  await toggle.focus(); await toggle.press('Enter'); await expect(nav).toBeVisible();
  await page.keyboard.press('Escape'); await expect(nav).toBeHidden(); await expect(toggle).toBeFocused();
  await toggle.press('Enter');
  const file = nav.getByRole('button', { name: 'Open file hostile.ts', exact: true });
  await file.focus(); await file.press('Enter');
  await expect(nav).toBeHidden(); await expect(page.getByTestId('raw-hunk').first()).toBeVisible();
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 2);
});

test('context dialog traps keyboard focus and Escape returns to its opener', async ({ page }) => {
  await page.goto('/contracts.html'); await openUnit(page, 'lookup', 'lookup.ts');
  const origin = page.getByRole('button', { name: 'Contract & callers', exact: true });
  await origin.focus(); await origin.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Contract & callers', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0); await expect(origin).toBeFocused();
});

test('ambiguous string, comment and repeated call tokens use literal source plus line affordances', async ({ page, request }) => {
  const report = await (await request.get('/ambiguous-calls.json')).json();
  await page.goto('/ambiguous-calls.html');
  for (const item of [{ name: 'stringCollision', line: 2, calls: 1 }, { name: 'commentCollision', line: 3, calls: 1 }, { name: 'repeated', line: 4, calls: 2 }]) {
    await openUnit(page, item.name, 'main.ts');
    const row = page.getByRole('article', { name: `${item.name} source`, exact: true }).locator(`[data-testid="code-line"][data-side="head"][data-new-line="${item.line}"]`);
    const controls = row.getByTestId('call-link');
    await expect(controls).toHaveCount(item.calls);
    await expect(row.locator('[data-testid="call-link"][data-placement="inline"]')).toHaveCount(0);
    for (let index = 0; index < item.calls; index++) {
      await expect(controls.nth(index)).toHaveAttribute('data-placement', 'line');
      await expect(controls.nth(index)).toHaveAttribute('data-side', 'head');
      await expect(controls.nth(index)).toHaveAttribute('data-line', String(item.line));
    }
    const literal = await row.locator('code').evaluate(element => {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[data-placement="line"]').forEach(control => control.remove());
      return copy.textContent;
    });
    expect(literal).toBe(report.files.find((file: { path: string }) => file.path === 'main.ts').head.split('\n')[item.line - 1]);
    await controls.first().click();
    await expect(peek(page)).toHaveCount(1);
    await expect(peek(page).getByText('target', { exact: true })).toBeVisible();
    await peek(page).getByRole('button', { name: 'Close peek', exact: true }).click();
    await expect(page.getByRole('button', { name: `Mark reviewed: ${item.name}`, exact: true })).toBeVisible();
  }
});

test('promoting a short target and returning restores the caller revision and both scroll coordinates', async ({ page }) => {
  await page.goto('/long-caller.html'); await openUnit(page, 'longCaller', 'main.ts');
  await page.getByRole('group', { name: 'Code revision' }).getByRole('button', { name: 'Before', exact: true }).click();
  const pane = page.getByRole('article', { name: 'longCaller source', exact: true }).getByRole('region', { name: 'before source', exact: true }).locator('.source-scroll');
  await pane.evaluate(element => { element.scrollTop = 240; element.scrollLeft = 220; });
  await page.getByRole('button', { name: 'Peek target from before line 15', exact: true }).click();
  const position = await pane.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }));
  expect(position.top).toBeGreaterThan(0); expect(position.left).toBeGreaterThan(0);
  await peek(page).getByRole('button', { name: 'Open target target', exact: true }).click();
  await expect(page.getByRole('article', { name: 'target source', exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Code revision' }).getByRole('button', { name: 'After', exact: true }).click();
  await page.getByRole('button', { name: 'Back to previous source', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Code revision' }).getByRole('button', { name: 'Before', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => pane.evaluate((element, expected) => Math.abs(element.scrollTop - expected), position.top)).toBeLessThanOrEqual(1);
  await expect.poll(() => pane.evaluate((element, expected) => Math.abs(element.scrollLeft - expected), position.left)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Mark reviewed: longCaller', exact: true })).toBeVisible();
});
