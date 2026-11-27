import { test, expect, type Page } from '@playwright/test';

const errors: string[] = [];
async function fresh(page: Page) {
  errors.length = 0;
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/overview');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}
test.afterEach(() => { expect(errors, errors.join('\n')).toEqual([]); });

const adminStatus = (page: Page) => page.locator('.detail-head [data-status]');
const empStatus = (page: Page) => page.getByTestId('employee-status');
async function scenario(page: Page, key: string) {
  await page.getByTestId('demo-menu').click();
  await page.getByTestId(`scenario-${key}`).click();
}
async function answer(page: Page, answers: string[]) {
  for (const a of answers) {
    const btn = page.locator(`[data-answer="${a}"]`);
    await expect(btn).toBeEnabled();
    await btn.click();
  }
}
const ticketIdFromUrl = (page: Page) => page.url().split('/').pop()!;
async function asAdmin(page: Page, id: string) { await page.getByTestId('role-admin').click(); await page.goto(`/#/incidents/${id}`); }
async function asEmployee(page: Page, id: string) { await page.getByTestId('role-employee').click(); await page.goto(`/#/my-tickets/${id}`); }
async function kpi(page: Page, testid: string) { return Number(await page.getByTestId(testid).locator('.value').textContent()); }

test('Scenario 1 — employee self-service closes without admin approval; dashboard updates', async ({ page }) => {
  await fresh(page);
  await page.goto('/#/overview?preset=today');
  await expect(page.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  const before = await kpi(page, 'kpi-selfservice');
  await scenario(page, '1');
  await expect(page.getByTestId('ts-prompt')).toHaveText('When did the slowness start?');
  await answer(page, ['TODAY', 'WHOLE']);
  await expect(page.getByTestId('ts-prompt')).toHaveText('Have you restarted your laptop in the last 24 hours?');
  await answer(page, ['NO', 'YES', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'RESOLVED']);
  await expect(empStatus(page)).toHaveText('Resolved');
  await expect(page.getByText('Employee self-service').first()).toBeVisible();
  const id = ticketIdFromUrl(page);
  await asAdmin(page, id);
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'CLOSED');
  await expect(page.locator('[data-approval="NOT_REQUIRED"]')).toBeVisible();
  await page.goto('/#/overview?preset=today');
  await expect(page.getByTestId('kpi-selfservice').locator('.value')).toHaveText(String(before + 1));
});

test('Scenario 2 — failed self-service escalates the same ticket; admin approves; AI executes and verifies', async ({ page }) => {
  await fresh(page);
  await scenario(page, '2');
  await answer(page, ['YES', 'YES', 'YES', 'YES']);
  await expect(empStatus(page)).toHaveText('Sent to IT support');
  const id = ticketIdFromUrl(page);
  await asAdmin(page, id);
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'REVIEW_NEEDED');
  await expect(page.getByText('Is Wi-Fi turned on on your laptop?').first()).toBeVisible();
  await expect(page.getByText('Reset Wi-Fi adapter and renew network settings').first()).toBeVisible();
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('confirm-approve')).toBeDisabled();
  await page.getByTestId('ack').check();
  await page.getByTestId('confirm-approve').click();
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'REMEDIATION');
  await asEmployee(page, id);
  await page.getByTestId('consent-yes').click();
  await expect(empStatus(page)).toHaveText('Resolved', { timeout: 15000 });
  await asAdmin(page, id);
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'CLOSED');
  await expect(page.locator('[data-method="HUMAN_APPROVED"]')).toBeVisible();
  await expect(page.getByTestId('verify-state')).toHaveText('Passed');
});

test('Scenario 3 — unsupported issue resolved manually becomes validated knowledge used for the next similar ticket', async ({ page }) => {
  await fresh(page);
  await scenario(page, '3');
  await answer(page, ['NO', 'COMPLETED', 'COMPLETED', 'PERSISTS']);
  const id = ticketIdFromUrl(page);
  await asAdmin(page, id);
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'UNSUPPORTED');
  await page.getByTestId('resolve-manual').click();
  await page.getByLabel('Root cause *').fill('Outdated dock firmware');
  await page.getByLabel('What you did to fix it *').fill('Updated the dock firmware to 2.4');
  await page.getByLabel('How you verified it *').fill('No flicker for 30 minutes');
  await expect(page.getByTestId('save-knowledge')).toBeChecked();
  await page.getByTestId('k-pattern').fill('external monitor flicker dock');
  await page.getByTestId('k-admin-steps').fill('Push dock firmware 2.4');
  await page.getByTestId('confirm-resolve').click();
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'CLOSED');
  await expect(page.getByTestId('knowledge-status')).toContainText('waiting for validation');
  await page.goto('/#/opportunities');
  await page.getByTestId('review-K-002').click();
  await page.getByTestId('validate-knowledge').click();
  await expect(page.getByTestId('knowledge').locator('tr', { hasText: 'K-002' })).toContainText('Validated');
  await scenario(page, '3b');
  await expect(page.getByText('Fix that worked for a similar issue')).toBeVisible();
  await page.getByTestId('get-help').click();
  const id2 = ticketIdFromUrl(page);
  await asAdmin(page, id2);
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'REVIEW_NEEDED');
  await expect(page.getByText('From validated resolution K-002')).toBeVisible();
});

test('Scenario 4 — approved fix fails verification; rollback; incident stays open; audit has the sequence', async ({ page }) => {
  await fresh(page);
  await scenario(page, '4');
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'REVIEW_NEEDED');
  const id = ticketIdFromUrl(page);
  const displayId = (await page.locator('.detail-head h1').textContent())!.trim();
  await page.getByTestId('approve').click();
  await page.getByTestId('ack').check();
  await page.getByTestId('confirm-approve').click();
  await asEmployee(page, id);
  await page.getByTestId('consent-yes').click();
  await asAdmin(page, id);
  await expect(page.getByTestId('verify-state')).toHaveText('Failed', { timeout: 15000 });
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'MANUAL');
  await page.getByTestId('rollback').click();
  await expect(page.locator('div.small', { hasText: 'Rollback by' })).toContainText('Previous settings restored', { timeout: 15000 });
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'MANUAL');
  await page.goto(`/#/audit?q=${displayId}`);
  for (const a of ['approved', 'employee consent granted', 'verification failed', 'rollback started', 'rollback completed']) await expect(page.locator('td', { hasText: new RegExp(`^${a}$`) }).first()).toBeVisible();
});

test('Scenario 5 — employee reopens a resolved ticket; admin worklist updates', async ({ page }) => {
  await fresh(page);
  await scenario(page, '5');
  await expect(empStatus(page)).toHaveText('Resolved');
  const id = ticketIdFromUrl(page);
  await page.getByTestId('reopen').click();
  await page.getByLabel(/What’s still wrong/).fill('Disk full again after lunch');
  await page.getByTestId('confirm-reopen').click();
  await expect(empStatus(page)).toHaveText('Sent to IT support');
  await page.getByTestId('role-admin').click();
  await page.goto('/#/workspace?q=INVESTIGATION');
  await expect(page.getByTestId('action-queue').locator('a', { hasText: 'Low disk space warning' })).toContainText('reopened');
  await page.goto(`/#/incidents/${id}`);
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'REOPENED');
  await page.getByTestId('rediagnose').click();
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'REVIEW_NEEDED');
});

test('Admin can reject or investigate instead of approving; nothing executes', async ({ page }) => {
  await fresh(page);
  await page.goto('/#/approvals');
  await page.getByTestId('approval-queue').locator('tbody tr').first().click();
  await page.getByTestId('reject').click();
  await page.getByLabel('Reason (required)').fill('Change freeze');
  await page.getByTestId('confirm-decision').click();
  await expect(adminStatus(page)).toHaveAttribute('data-status', 'MANUAL');
  await expect(page.locator('[data-approval="REJECTED"]')).toBeVisible();
  await page.goto('/#/approvals');
  await expect(page.getByText('No fixes are waiting for approval')).toBeVisible();
});

test('KPI drill-downs reconcile; settings and audit filters work', async ({ page }) => {
  await fresh(page);
  const total = await kpi(page, 'kpi-total');
  await page.getByTestId('kpi-total').click();
  await expect(page.getByText(`${total} incident${total === 1 ? '' : 's'}`, { exact: true })).toBeVisible();
  await page.goto('/#/overview');
  const manual = await kpi(page, 'kpi-manual');
  await page.getByTestId('kpi-manual').click();
  await expect(page.getByTestId('incident-table').locator('tbody tr')).toHaveCount(manual);
  await page.goto('/#/settings');
  await page.getByTestId('threshold').fill('90');
  await page.getByTestId('settings-reason').fill('Stricter during pilot');
  await page.getByTestId('save-settings').click();
  await expect(page.locator('li', { hasText: /v2 ·.*threshold 90%/ })).toBeVisible();
  await page.goto('/#/audit');
  await page.getByLabel('Action').selectOption('AI_SETTINGS_CHANGED');
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('Every route works for both roles; mobile layouts have no horizontal overflow', async ({ page }) => {
  await fresh(page);
  for (const [label, heading] of [['My Workspace', 'My Workspace'], ['Incidents', 'Incidents'], ['Approvals', 'Approvals'], ['Opportunities', 'Opportunities'], ['Audit Logs', 'Audit Logs'], ['AI Settings', 'AI Settings'], ['Overview', 'Overview']]) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  await page.getByTestId('role-employee').click();
  await expect(page.getByRole('heading', { level: 1, name: 'My tickets' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Raise a Ticket' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Raise a ticket' })).toBeVisible();
  await page.goto('/#/nowhere');
  await expect(page.getByText('Page not found')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  for (const r of ['raise', 'my-tickets']) { await page.goto(`/#/${r}`); await expect(page.locator('h1').first()).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), r).toBeLessThanOrEqual(1); }
  await page.getByTestId('role-admin').click();
  for (const r of ['overview', 'workspace', 'incidents', 'approvals', 'opportunities', 'audit', 'settings']) { await page.goto(`/#/${r}`); await expect(page.locator('h1').first()).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), r).toBeLessThanOrEqual(1); }
});

test('Two tabs stay in sync without warnings', async ({ page, context }) => {
  await fresh(page);
  const other = await context.newPage();
  await other.goto('/#/approvals');
  const rows = other.getByTestId('approval-queue').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await page.goto('/#/approvals');
  await page.getByTestId('approval-queue').locator('tbody tr').first().click();
  await page.getByTestId('reject').click();
  await page.getByLabel('Reason (required)').fill('Change freeze');
  await page.getByTestId('confirm-decision').click();
  await expect(other.getByText('No fixes are waiting for approval')).toBeVisible();
  await expect(page.getByText(/open in another tab/)).toHaveCount(0);
  await expect(other.getByText(/open in another tab/)).toHaveCount(0);
  await other.close();
});

test('Phone navigation drawer closes on Escape and when tapping the current page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await fresh(page);
  const sidebar = page.locator('aside.sidebar');
  await page.getByLabel('Open navigation').click();
  await expect(sidebar).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(sidebar).not.toHaveClass(/open/);
  await page.getByLabel('Open navigation').click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Overview' }).click();
  await expect(sidebar).not.toHaveClass(/open/);
});
