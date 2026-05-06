import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Funding Monitor — exercises both tabs of the wallet's funding-monitor module:
 *
 *   /wallet/account/funding-monitor/control-funding   (start a monitor)
 *   /wallet/account/funding-monitor/active-monitors   (list / stop)
 *
 * The Start button has 4 disabled gates (control-funding-monitor.component.html):
 *   1. hasLocal === false               → connection mode untrusted
 *   2. !startFundingMonitorForm.valid   → any required field empty / out of bounds
 *   3. fundingMonitorForm.threshold < 10 (now via minValue directive → errors.minValue)
 *   4. fundingMonitorForm.interval  < 10 (same)
 *
 * Each gate now produces a user-visible message: a banner above the form for #1,
 * inline `.input-error` text under each field for the rest. These tests pin the
 * gates so a future regression that silently disables Start (the symptom that
 * triggered this whole pass) fails fast with a clear locator.
 *
 * The dev devnet's iep-node admin password is `node001` (set by docker_init.sh
 * via /run/secrets/ADMIN_PASSWORD); override with E2E_ADMIN_PASSWORD when
 * pointing at a stack with a different password.
 */

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'node001';
const CONTROL_TAB = '#/wallet/account/funding-monitor/control-funding';
const ACTIVE_TAB  = '#/wallet/account/funding-monitor/active-monitors';

function uniqueProperty(): string {
  return `e2e-fm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('control-funding: empty form keeps Start disabled', async ({ page }) => {
  await page.goto(CONTROL_TAB);

  const startBtn = page.locator('#startFundingMonitorBtn');
  await expect(startBtn, 'Start button must mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  // hasLocal=true (devnet → DEVTESTNET via resolveConnectionMode), so the gate
  // here is the form being invalid (all required fields empty after first load).
  await expect(startBtn, 'Start must be disabled while every required field is empty').toBeDisabled();
});

test('control-funding: required-field errors appear after touching each input', async ({ page }) => {
  await page.goto(CONTROL_TAB);

  // Touch each required field (focus + blur) without filling, to fire the
  // dirty/touched flags that the .input-error blocks gate on.
  for (const name of ['property', 'amount', 'threshold', 'interval', 'adminPassword', 'secretPhrase']) {
    const inp = page.locator(`input[name="${name}"]`);
    await inp.click();
    await inp.blur();
  }

  // Property + adminPassword + secretPhrase: required-only errors.
  await expect(page.getByText(/Account Property is required\./i)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.getByText(/Admin Password is required\./i)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.getByText(/Secret phrase is required\./i)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Amount, threshold, interval default to 0; that triggers the minValue
  // validator (not required), so we expect the boundary message — not
  // "<field> is required".
  await expect(page.getByText(/Amount must be greater than 0\./i)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.getByText(/Threshold must be at least 10\./i)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.getByText(/Interval must be at least 10 blocks\./i)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('control-funding: threshold below 10 keeps error visible until corrected', async ({ page }) => {
  await page.goto(CONTROL_TAB);

  const threshold = page.locator('input[name="threshold"]');
  await threshold.fill('5');
  await threshold.blur();
  await expect(
    page.getByText(/Threshold must be at least 10\./i),
    'sub-10 threshold should show the boundary message',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await threshold.fill('10');
  await threshold.blur();
  await expect(
    page.getByText(/Threshold must be at least 10\./i),
    'message must clear once value reaches the floor',
  ).toBeHidden({ timeout: DEFAULT_TIMEOUT_MS });
});

test('control-funding: interval below 10 keeps error visible until corrected', async ({ page }) => {
  await page.goto(CONTROL_TAB);

  const interval = page.locator('input[name="interval"]');
  await interval.fill('5');
  await interval.blur();
  await expect(page.getByText(/Interval must be at least 10 blocks\./i)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await interval.fill('20');
  await interval.blur();
  await expect(page.getByText(/Interval must be at least 10 blocks\./i)).toBeHidden({ timeout: DEFAULT_TIMEOUT_MS });
});

test('control-funding: a fully valid form starts a monitor and shows the success modal', async ({ page, request, baseURL }) => {
  const property = uniqueProperty();

  await page.goto(CONTROL_TAB);

  await page.locator('input[name="property"]').fill(property);
  await page.locator('input[name="amount"]').fill('100');
  await page.locator('input[name="threshold"]').fill('50');
  await page.locator('input[name="interval"]').fill('20');
  await page.locator('input[name="adminPassword"]').fill(ADMIN_PASSWORD);
  await page.locator('input[name="secretPhrase"]').fill(TEST_ACCOUNT_1_PASSPHRASE);
  await page.locator('input[name="secretPhrase"]').blur();

  const startBtn = page.locator('#startFundingMonitorBtn');
  await expect(startBtn, 'Start should enable once every gate is satisfied').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Capture the network round-trip so we know the chain accepted the call.
  const startResp = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api') &&
      r.request().method() === 'POST' &&
      (r.request().postData() ?? '').includes('requestType=startFundingMonitor'),
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  await startBtn.click();
  const resp = await startResp;
  const body = await resp.json();
  expect(body.errorCode, `startFundingMonitor returned an error: ${JSON.stringify(body)}`).toBeUndefined();
  expect(body.started, 'startFundingMonitor must report started=true').toBe(true);

  // Wallet pops a sweetalert success on a successful start (component .ts:131-149).
  await expect(page.locator('.swal2-container')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('.swal2-title')).toContainText(/success/i);

  // Cross-check via the API: the monitor must show up under getAccountFundingMonitor.
  const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;
  const listResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getFundingMonitor', adminPassword: ADMIN_PASSWORD },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(listResp.ok()).toBe(true);
  const list = await listResp.json();
  const found = (list.monitors ?? []).find((m: any) => m.property === property);
  expect(found, `monitor "${property}" not present in getFundingMonitor response`).toBeTruthy();
});

test('active-monitors: tab renders a datatable + reload control', async ({ page }) => {
  await page.goto(ACTIVE_TAB);
  await expect(page.locator('ngx-datatable'), 'active-monitors should mount the datatable').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('button:has(i.fa-refresh), a:has(i.fa-refresh)').first(),
    'active-monitors should expose a reload control',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('active-monitors: datatable renders rows + stop buttons for monitors registered on this account', async ({ page, request, baseURL }) => {
  const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;

  // Ensure ≥1 monitor exists for the logged-in account. (The chain's monitor
  // list is in-memory per-node and survives across tests within a stack run,
  // but a clean stack might start empty — create one via API in that case so
  // this test is self-sufficient.)
  const ensureProp = `e2e-fm-rowcheck-${Date.now().toString(36)}`;
  const startResp = await request.get(`${apiOrigin}/api`, {
    params: {
      requestType: 'startFundingMonitor',
      property: ensureProp, amount: '100', threshold: '5000000000', interval: '20',
      holdingType: '0', secretPhrase: TEST_ACCOUNT_1_PASSPHRASE, adminPassword: ADMIN_PASSWORD,
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(startResp.ok(), 'API setup: startFundingMonitor must succeed').toBe(true);

  await page.goto(ACTIVE_TAB);
  await expect(page.locator('ngx-datatable')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  // Click the page's own reload control to force a fresh fetch — avoids races
  // with the initial ngOnInit fetch that may have run before our setup call.
  await page.locator('a:has(i.fa-refresh), button:has(i.fa-refresh)').first().click();

  // Pre-existing wallet bug (caught while writing this test, fixed in
  // active-funding-monitor.component.html): the template had two `[rows]`
  // bindings on ngx-datatable — `[rows]="monitors"` followed by
  // `[rows]="properties"`. The component has no `properties` field, so the
  // second binding wins and the table is permanently empty. Removing the
  // duplicate makes the table actually render rows. Asserting at least one
  // row pins that fix.
  await expect(
    page.locator('datatable-body-row').first(),
    'active-monitors datatable did not render any row — the [rows]="monitors" binding may be ' +
    'shadowed by a duplicate `[rows]` attribute again, or the getFundingMonitor service call broke',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Each row exposes a stop button (red ×). Asserting it renders pins the
  // row-template's action-cell binding.
  await expect(
    page.locator('a.btn-outline-danger:has(i.fa-times)').first(),
    'stop-monitor button should render in at least one row',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
