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
  await expect(page.getByText(/Free disk space 3 GB is below the 10 GB/).first()).toBeVisible();
  await expect(page.getByText('RB-001 v1').first()).toBeVisible();
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
  // Multi-step plan: read-only steps auto-run, then the HIGH-risk install pauses for a step approval.
  await expect(status(page)).toHaveAttribute('data-status', 'STEP_APPROVAL', { timeout: 15000 });
  await page.getByTestId('approve-step').click();
  await page.getByTestId('step-impact-confirm').check();
  await page.getByTestId('confirm-step').click();
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
  await expect(page.getByText('No — guidance only (L1)')).toBeVisible();
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
  for (const [label, heading] of [['How it works', 'How it works'], ['Incidents', 'Incidents'], ['Approvals', 'Approvals'], ['Runbook library', 'Runbook library'], ['Opportunities', 'Automation opportunities'], ['Policies', 'Policies'], ['Audit log', 'Audit log'], ['Overview', 'Endpoint remediation overview']]) {
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
  for (const r of ['overview', 'guide', 'incidents', 'approvals', 'policies', 'audit', 'library', 'opportunities']) {
    await page.goto(`/#/${r}`);
    await expect(page.locator('h1').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${r}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Incidents' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Incidents' })).toBeVisible();
});

// ------------------------------------------------------------------------------------------
// Enhancement flows (docs/ENHANCEMENTS.md)
// ------------------------------------------------------------------------------------------
async function demoId(page: Page, scenario: string) {
  return page.evaluate((sc) => { const s = JSON.parse(localStorage.getItem('remediation-center:v1')!); return (Object.values(s.tickets) as { id: string; scenario?: string; demo?: boolean; createdAt: string }[]).filter((t) => t.demo && t.scenario === sc).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].id; }, scenario);
}

test('E1. workspace: prioritized queue item opens the incident at its action', async ({ page }) => {
  await fresh(page);
  await expect(page.getByTestId('workspace-tiles')).toBeVisible();
  const first = page.getByTestId('action-queue').locator('a').first();
  const title = (await first.locator('.aq-title strong').textContent())!.trim();
  await first.click();
  await expect(page.locator('.detail-head h1')).toHaveText(title);
  await expect(page.locator('#action-card')).toBeInViewport();
  await page.goto('/#/overview');
  await page.getByRole('link', { name: /AI remediation in progress/ }).click();
  await expect(page.getByText(/predicate: status ∈ \{Ready, Scheduled/)).toBeVisible();
});

test('E2. preflight blocks execution on low battery and records results', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'B · Wi-Fi failure');
  await page.getByTestId('battery-toggle').click();
  await page.getByTestId('approve').click();
  await page.getByTestId('consent-grant').click();
  await expect(status(page)).toHaveAttribute('data-status', 'WAITING_DEVICE');
  await expect(page.locator('[data-check="battery"]')).toHaveAttribute('data-status', 'FAIL');
  await expect(page.getByTestId('preflight-summary')).toContainText('Blocked');
  await page.getByTestId('battery-toggle').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED', { timeout: 15000 });
  await page.getByRole('tab', { name: /Activity/ }).click();
  await expect(page.getByText('preflight passed').first()).toBeVisible();
  await expect(page.getByText('preflight revalidated').first()).toBeVisible();
});

test('E3. multi-step plan paused at high-risk step: agent blocked, admin approves step', async ({ page }) => {
  await fresh(page);
  const id = await demoId(page, 'I');
  await page.goto(`/#/incidents/${id}`);
  await expect(status(page)).toHaveAttribute('data-status', 'STEP_APPROVAL');
  await expect(page.locator('[data-step="S1"]')).toHaveAttribute('data-step-status', 'done');
  await expect(page.locator('[data-step="S3"]')).toHaveAttribute('data-step-status', 'pause');
  await expect(page.getByTestId('approve-step')).toBeDisabled();
  await role(page, 'ADMIN');
  await page.getByTestId('approve-step').click();
  await expect(page.getByTestId('confirm-step')).toBeDisabled();
  await page.getByTestId('step-impact-confirm').check();
  await page.getByTestId('confirm-step').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED', { timeout: 15000 });
});

test('E4. employee chooses a maintenance window; response syncs to approvals', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'B · Wi-Fi failure');
  await page.getByTestId('approve').click();
  await expect(page.getByText('Simulated employee view')).toBeVisible();
  await page.getByTestId('consent-schedule').click();
  await page.getByTestId('confirm-window').click();
  await expect(status(page)).toHaveAttribute('data-status', 'SCHEDULED');
  await page.getByRole('tab', { name: /Activity/ }).click();
  await expect(page.getByText('employee response').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Remediation' }).click();
  await page.getByTestId('advance').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED', { timeout: 15000 });
});

test('E5. shared network incident: correlate, link, resolve parent, verify each recovery', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('cluster-banner').click();
  await page.getByTestId('link-shared').click();
  await expect(page.getByText(/linked and endpoint remediation paused/)).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'REVIEW_REQUIRED');
  const child = page.url();
  await page.getByRole('link', { name: /^INC-\d+$/ }).filter({ has: page.locator('strong') }).first().click();
  await expect(page.locator('.detail-head h1')).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'ESCALATED');
  await page.getByTestId('resolve-manual').click();
  await page.getByLabel('Resolution note (required)').fill('Rebooted faulty access point on Floor 2');
  await page.getByLabel('Verification evidence (required)').fill('AP healthy; 12 clients reassociated');
  await page.getByRole('checkbox', { name: /I verified the fix/ }).check();
  await page.getByTestId('confirm-manual').click();
  await page.goto(child);
  await expect(status(page)).toHaveAttribute('data-status', 'REVIEW_REQUIRED');
  await page.getByTestId('verify-recovery').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED');
});

test('E6. AI draft lifecycle and maturity promotion require administrator validation', async ({ page }) => {
  await fresh(page);
  await loadScenario(page, 'E · Unknown crash');
  await page.getByTestId('resolve-manual').click();
  await page.getByLabel('Resolution note (required)').fill('Reset export plugin cache');
  await page.getByLabel('Verification evidence (required)').fill('Exported 5 files');
  await page.getByRole('checkbox', { name: /I verified the fix/ }).check();
  await page.getByTestId('confirm-manual').click();
  await page.getByRole('button', { name: 'Propose runbook draft' }).click();
  await expect(page.getByText('AI-generated (simulated)')).toBeVisible();
  await expect(page.getByTestId('submit-review')).toBeDisabled();
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await page.getByLabel('Tested scenario').fill('Scenario E replay in simulator');
  await page.getByTestId('save-draft').click();
  await page.getByTestId('submit-review').click();
  await expect(page.getByTestId('publish')).toBeDisabled();
  await role(page, 'ADMIN');
  await page.getByTestId('publish').click();
  await page.getByLabel('Review note').fill('Reviewed with desktop SMEs');
  await page.getByTestId('confirm-publish').click();
  await expect(page.getByText('No — guidance only (L1)')).toBeVisible();
  await page.goto('/#/library/RB-003');
  await page.getByTestId('promote').click();
  await page.getByLabel('Documented reason (required)').fill('3 supervised runs, all verified');
  await page.getByTestId('confirm-maturity').click();
  await expect(page.getByText('L3 · Policy-based autonomous').first()).toBeVisible();
});

test('E7. business impact recalculates from configurable assumptions', async ({ page }) => {
  await fresh(page);
  const row = page.getByTestId('impact-table').locator('tr', { hasText: 'IT operational cost savings' });
  const before = await row.locator('td').nth(1).textContent();
  await role(page, 'MANAGER');
  await page.getByTestId('open-assumptions').click();
  await page.getByTestId('hourly-cost').fill('80');
  await page.getByTestId('save-assumptions').click();
  await expect(row.locator('td').nth(1)).not.toHaveText(before!);
  await expect(page.getByText('Estimated', { exact: true })).toBeVisible();
});

test('E8. How it works: every path is listed with a real example or a live try-it', async ({ page }) => {
  await fresh(page);
  await page.getByRole('link', { name: 'How it works →' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'How it works' })).toBeVisible();
  const rows = page.locator('tr[data-example]');
  expect(await rows.count()).toBe(20);
  // Each row either links to a seeded example ticket or offers a live way to try it.
  for (let i = 0; i < 20; i++) expect(await rows.nth(i).locator('a, button, .muted').count()).toBeGreaterThan(0);
  await page.locator('tr[data-example="rollback-fail"]').getByRole('link').click();
  await expect(status(page)).toHaveAttribute('data-status', 'CLOSED');
  await page.getByRole('tab', { name: /Activity/ }).click();
  await expect(page.getByText('rollback failed').first()).toBeVisible();
  await page.goto('/#/guide');
  await page.locator('tr[data-example="verify-fail-rollback"]').getByRole('button', { name: /Try it/ }).click();
  await expect(status(page)).toHaveAttribute('data-status', 'AWAITING_APPROVAL');
  await expect(page.locator('.detail-head')).toContainText('Demo scenario D');
});
