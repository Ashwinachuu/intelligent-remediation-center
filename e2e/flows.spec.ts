import { test, expect, type Page } from '@playwright/test';

const errors: string[] = [];
async function fresh(page: Page) {
  errors.length = 0;
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/overview');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Endpoint remediation overview' })).toBeVisible();
}
const status = (page: Page) => page.locator('.detail-head [data-status]');
async function role(page: Page, r: 'AGENT' | 'ADMIN' | 'MANAGER') { await page.selectOption('#role-select', r); }
async function loadScenario(page: Page, name: string) {
  await page.goto('/#/incidents');
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.detail-head h1')).toBeVisible();
  return (await page.locator('.detail-head h1').textContent())!.trim();
}
test.afterEach(() => { expect(errors, errors.join('\n')).toEqual([]); });

test('1. storage ticket: explain → approve → verified closure → dashboard + audit', async ({ page }) => {
  await fresh(page);
  await page.goto('/#/overview?preset=today');
  await expect(page.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  const before = Number(await page.locator('.kpi', { hasText: 'Human-approved closed' }).locator('.value').textContent());
  await page.getByTestId('create-ticket').click();
  await page.getByRole('dialog').getByLabel('Title *').fill('Disk nearly full on my laptop');
  await page.getByTestId('submit-ticket').click();
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_APPROVAL');
  await expect(page.getByText(/Free disk space 3 GB is below the 10 GB/)).toBeVisible();
  await expect(page.getByText('RB-001 v1')).toBeVisible();
  const id = (await page.locator('.detail-head h1').textContent())!.trim();
  await page.getByTestId('approve').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED', { timeout: 15000 });
  await expect(page.getByText(/Actual verification output/)).toBeVisible();
  await page.goto('/#/overview?preset=today');
  await expect(page.locator('.kpi', { hasText: 'Human-approved closed' }).locator('.value')).toHaveText(String(before + 1));
  await page.goto(`/#/audit?q=${id}`);
  for (const a of ['approved', 'execution started', 'verification passed', 'ticket closed']) await expect(page.locator('td', { hasText: new RegExp(`^${a}$`) }).first()).toBeVisible();
});

test('2. admin enables preapproval → storage auto-closes; medium still needs approval', async ({ page }) => {
  await fresh(page);
  await role(page, 'ADMIN');
  await page.goto('/#/policies');
  await page.getByTestId('preapproval').click();
  await page.getByTestId('confirm-preapproval').click();
  await page.getByLabel('Reason for this version (required)').fill('Pilot preapproval for low-risk catalog runbooks');
  await page.getByTestId('save-policy').click();
  await expect(page.getByText(/Current version: v2/)).toBeVisible();
  await loadScenario(page, 'A · Storage cleanup');
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED', { timeout: 15000 });
  await expect(page.locator('.detail-head').getByText('Auto (policy)')).toBeVisible();
  await loadScenario(page, 'B · Wi-Fi failure');
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_APPROVAL');
});

test('3. Wi-Fi: approve → consent required → employee grants → verified closure', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'B · Wi-Fi failure');
  await expect(page.getByTestId('approve')).toHaveText(/Approve & request consent/);
  await page.getByTestId('approve').click();
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_CONSENT');
  await page.getByTestId('consent-grant').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED', { timeout: 15000 });
});

test('4. high-risk OS: agent blocked → admin approves + schedule → consent → advance → closed', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'C · OS patch');
  await expect(page.getByTestId('approve')).toBeDisabled();
  await expect(page.getByText('HIGH-risk plans require an Admin approver').first()).toBeVisible();
  await role(page, 'ADMIN');
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('confirm-schedule')).toBeDisabled();
  await page.getByTestId('impact-confirm').check();
  await page.getByTestId('confirm-schedule').click();
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_CONSENT');
  await page.getByTestId('consent-grant').click();
  await expect(status(page)).toHaveAttribute('data-status', 'SCHEDULED');
  await page.getByTestId('advance').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED', { timeout: 15000 });
});

test('5. Wi-Fi verification failure → no closure → rollback → escalated, snapshot restored', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'D · Wi-Fi verification failure');
  await page.getByTestId('approve').click();
  await page.getByTestId('consent-grant').click();
  await expect(status(page)).toHaveAttribute('data-status', 'ROLLBACK_AVAILABLE', { timeout: 15000 });
  await expect(page.locator('.detail-head dd', { hasText: /^—$/ }).first()).toBeVisible();
  await page.getByTestId('rollback').click();
  await expect(status(page)).toHaveAttribute('data-status', 'ESCALATED', { timeout: 15000 });
  const row = page.locator('table.change-table tbody tr', { hasText: 'Wi-Fi healthy' });
  await expect(row.locator('td').nth(1)).toHaveText('false');
  await expect(row.locator('td').nth(3)).toHaveText('false');
});

test('6. unknown crash → no execution → manual resolution → draft, not active', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'E · Unknown crash');
  await expect(status(page)).toHaveAttribute('data-status', 'REVIEW_REQUIRED');
  await expect(page.getByTestId('approve')).toHaveCount(0);
  await page.getByTestId('resolve-manual').click();
  await page.getByLabel('Resolution note (required)').fill('Reset export plugin cache and reinstalled plugin');
  await page.getByLabel('Verification evidence (required)').fill('Exported 5 files without crash');
  await page.getByRole('checkbox', { name: /I verified the fix/ }).check();
  await page.getByTestId('confirm-manual').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED');
  await page.getByRole('button', { name: 'Propose runbook draft' }).click();
  await expect(page).toHaveURL(/#\/library\/RB-/);
  await expect(page.locator('.page-head').getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText('No — diagnostic-only guidance')).toBeVisible();
});

test('7. offline → reconnect → approval required; pause blocks start without mutation', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'F · Offline Wi-Fi');
  await expect(status(page)).toHaveAttribute('data-status', 'WAITING_DEVICE');
  await page.getByRole('button', { name: 'Simulate device reconnect' }).click();
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_APPROVAL');
  await role(page, 'ADMIN');
  await page.goto('/#/policies');
  await page.getByRole('switch', { name: /Master pause/ }).check();
  await page.getByLabel('Reason for this version (required)').fill('Change freeze');
  await page.getByTestId('save-policy').click();
  await loadScenario(page, 'A · Storage cleanup');
  await expect(status(page)).toHaveAttribute('data-status', 'REVIEW_REQUIRED');
  await expect(page.getByText(/Automation paused by policy/).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(page.locator('.kv dd', { hasText: '3 GB' })).toBeVisible();
});

test('8. reopen closed incident → dashboard updates, execution audit retained', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'A · Storage cleanup');
  await page.getByTestId('approve').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED', { timeout: 15000 });
  const url = page.url();
  await page.goto('/#/overview?preset=today');
  await expect(page.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  const other = page.locator('.bar-list a', { hasText: 'Other open / reopened' }).locator('.n');
  const before = Number(await other.textContent());
  await page.goto(url);
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.getByLabel('Reason (required)').fill('Disk filled again');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(status(page)).toHaveAttribute('data-status', 'REOPENED');
  await page.getByRole('tab', { name: /Activity/ }).click();
  await expect(page.getByText('execution started')).toBeVisible();
  await page.goto('/#/overview?preset=today');
  await expect(other).toHaveText(String(before + 1));
});

test('9. manager read-only; policy change invalidates pending approval; refresh preserves state', async ({ page }) => {
  await fresh(page);
  const id = await loadScenario(page, 'B · Wi-Fi failure');
  const url = page.url();
  await role(page, 'MANAGER');
  await expect(page.getByTestId('approve')).toBeDisabled();
  await expect(page.getByTestId('create-ticket')).toBeDisabled();
  await role(page, 'AGENT');
  await page.getByTestId('approve').click();
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_CONSENT');
  await role(page, 'ADMIN');
  await page.goto('/#/policies');
  await page.getByLabel('Approval expiry (min)').fill('45');
  await page.getByLabel('Reason for this version (required)').fill('Shorter approval window');
  await expect(page.getByText(/outstanding approval\(s\) will be invalidated/)).toBeVisible();
  await page.getByTestId('save-policy').click();
  await page.goto(url);
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_APPROVAL');
  await page.reload();
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_APPROVAL');
  await expect(page.locator('.detail-head h1')).toHaveText(id);
  await page.goto('/#/approvals?tab=expired');
  await expect(page.getByText(/Plan changed/).first()).toBeVisible();
});

test('10. every route navigates, filters reset, mobile usable, no console errors', async ({ page }) => {
  await fresh(page);
  for (const [label, heading] of [['Incidents', 'Incidents'], ['Approvals', 'Approvals'], ['Runbook library', 'Runbook library'], ['Opportunities', 'Automation opportunities'], ['Policies', 'Policies'], ['Audit log', 'Audit log'], ['Overview', 'Endpoint remediation overview']]) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  await page.goto('/#/library/RB-004');
  await expect(page.getByRole('heading', { name: 'RB-004 v1' })).toBeVisible();
  await page.goto('/#/nowhere');
  await expect(page.getByText('Page not found')).toBeVisible();
  // metric drill-down + filters
  await page.goto('/#/overview');
  await page.locator('.kpi', { hasText: 'Auto-closed' }).click();
  await expect(page.getByText(/predicate: status = Closed AND path = Auto/)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Endpoint remediation overview' })).toBeVisible();
  await page.goto('/#/incidents');
  await page.getByLabel('Status').selectOption('ESCALATED');
  await expect(page).toHaveURL(/status=ESCALATED/);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/status=/);
  // mobile
  await page.setViewportSize({ width: 375, height: 812 });
  for (const r of ['overview', 'incidents', 'approvals', 'policies', 'audit', 'library', 'opportunities']) {
    await page.goto(`/#/${r}`);
    await expect(page.locator('h1').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${r}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Incidents' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
});
