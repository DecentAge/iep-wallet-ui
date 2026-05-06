import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_ID,
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Account Lessors page (`#/wallet/account/lessors`) — lists accounts that
 * have leased their effective forging balance to the currently logged-in
 * account (the lessee). The logged-in account gains forging weight from the
 * lessors once `Constants.LEASING_DELAY` blocks have elapsed after the
 * leaseBalance tx confirms.
 *
 * Why two accounts are needed:
 *   - The lessor submits a `leaseBalance` tx pointing to the lessee.
 *   - The lessors page is only interesting when at least one other account
 *     has leased to us — an empty table proves nothing about the data pipeline.
 *   - TEST_ACCOUNT_2 is the ideal lessor: funded, non-genesis, non-forging,
 *     clean state across devnet resets.
 *
 * LEASING_DELAY on devnet:
 *   Constants.LEASING_DELAY is 10 on devnet (vs 1440 on mainnet). This is set
 *   via ConstantsConfigHelper.PROPERTY_LEASING_DELAY and allows e2e tests to
 *   verify active leases within a single test run (~30s at 3s/block).
 *
 * Setup (beforeAll):
 *   1. Creates a leaseBalance from TEST_ACCOUNT_2 → TEST_ACCOUNT_1 (period=1440,
 *      valid since 1440 >= devnet minimum of 10).
 *   2. Waits up to 60s for the tx to confirm (appear in a block).
 *   3. Waits up to 90s for the lease to become active — polls until
 *      getAccount(TEST_ACCOUNT_2_RS).currentLessee === TEST_ACCOUNT_1_ID,
 *      which means LEASING_DELAY blocks have elapsed and the lease is live.
 *
 * Migration risks this catches:
 *   - LessorsComponent's getAccountLessors() → AccountService.getAccountLessors()
 *     → getAccount?includeLessors=true wiring
 *   - ngx-datatable with lessorRS hyperlink column + pipe-based computed columns
 *     (lessorsDaysLeft, lessorsPercentage)
 *   - The accountId-vs-accountRS switch: the component reads accountId from
 *     session and passes it to getAccountLessors — a regression would pass
 *     the wrong identifier and return an empty list
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';

let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  // Issue leaseBalance from TEST_ACCOUNT_2 (lessor) → TEST_ACCOUNT_1 (lessee).
  // period=1440 satisfies the chain minimum (Constants.LEASING_DELAY=10 on devnet).
  const params = new URLSearchParams({
    requestType: 'leaseBalance',
    recipient: TEST_ACCOUNT_1_ID,
    period: '1440',
    secretPhrase: TEST_ACCOUNT_2_PASSPHRASE,
    feeTQT: '100000000',
    deadline: '80',
    broadcast: 'true',
  });
  const leaseResp = await apiCtx.post(API_BASE, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: params.toString(),
  });
  const lease = await leaseResp.json();
  if (!lease.transaction || lease.broadcasted !== true) {
    throw new Error(`leaseBalance setup failed: ${JSON.stringify(lease)}`);
  }

  // Phase 1: wait for the leaseBalance tx to confirm (appear in a block).
  const confirmDeadline = Date.now() + 60_000;
  while (Date.now() < confirmDeadline) {
    const txResp = await apiCtx.get(`${API_BASE}?requestType=getTransaction&transaction=${lease.transaction}`);
    const tx = await txResp.json();
    if (tx.block && typeof tx.confirmations === 'number') break;
    await new Promise(r => setTimeout(r, 1_000));
  }

  // Phase 2: wait for LEASING_DELAY blocks to elapse so the lease becomes
  // active. On devnet LEASING_DELAY=10 (≈30s at 3s/block).
  //
  // Note: getAccount(lessor).currentLessee is set as soon as the leaseBalance
  // tx confirms — it comes from AccountLease.currentLesseeId, not from the
  // live active_lessee_id field. The lessors datatable uses getAccountLessors
  // which queries Account.active_lessee_id, set only when AFTER_BLOCK_APPLY
  // fires at currentLeasingHeightFrom. Poll getAccountLessors(TEST_ACCOUNT_1)
  // so we wait for the correct event.
  const activateDeadline = Date.now() + 90_000;
  while (Date.now() < activateDeadline) {
    const lessorsResp = await apiCtx.get(`${API_BASE}?requestType=getAccountLessors&account=${TEST_ACCOUNT_1_ID}`);
    const lessorsData = await lessorsResp.json();
    if (Array.isArray(lessorsData.lessors) && lessorsData.lessors.length > 0) return;
    await new Promise(r => setTimeout(r, 2_000));
  }
  throw new Error(
    `getAccountLessors for TEST_ACCOUNT_1 returned no lessors within 90s — ` +
    `active_lessee_id was not set on TEST_ACCOUNT_2 after LEASING_DELAY=10 blocks. ` +
    `Check iep-node was rebuilt with LEASING_DELAY=10 in DEVNET_PROPERTIES.`
  );
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('lessors: page mounts with ngx-datatable and translated column headers', async ({ page }) => {
  await page.goto('#/wallet/account/lessors');

  const datatable = page.locator('ngx-datatable').first();
  await expect(
    datatable,
    'ngx-datatable did not mount on the lessors page — LessorsComponent or lazy-load broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Column headers are translated via pipe — a bare key like "table-header.account"
  // proves the i18n bundle or the pipe failed.
  const firstHeader = page.locator('ngx-datatable .datatable-header-cell-label').first();
  await expect(firstHeader).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const headerText = ((await firstHeader.textContent()) ?? '').trim();
  expect(
    /^table-header\./.test(headerText),
    `first column header looks like an untranslated i18n key ("${headerText}") — ` +
    `@ngx-translate bundle may have failed to load in the account module`,
  ).toBe(false);
});

test('lessors: datatable shows TEST_ACCOUNT_2 as active lessor after LEASING_DELAY blocks', async ({ page }) => {
  // beforeAll waited for the lease to become active (currentLessee set on TEST_ACCOUNT_2).
  // The lessors page calls getAccountLessors(TEST_ACCOUNT_1_ID) which uses
  // getAccount?includeLessors=true; active leases appear as rows in the datatable.
  await page.goto('#/wallet/account/lessors');

  const datatable = page.locator('ngx-datatable').first();
  await expect(datatable, 'lessors datatable did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The Lessor column renders TEST_ACCOUNT_2_RS as a hyperlink in the row.
  // Its presence proves: leaseBalance tx was accepted, LEASING_DELAY elapsed,
  // and the component's getAccountLessors() → datatable pipeline is working.
  const lessorCell = page.locator('ngx-datatable .datatable-body-cell', { hasText: TEST_ACCOUNT_2_RS }).first();
  await expect(
    lessorCell,
    `TEST_ACCOUNT_2 (${TEST_ACCOUNT_2_RS}) not visible as a lessor row in the datatable. ` +
    `beforeAll waited for the lease to become active — if this fails, check that ` +
    `iep-node was rebuilt with LEASING_DELAY=10 in DEVNET_PROPERTIES and that ` +
    `LessorsComponent correctly calls getAccountLessors with TEST_ACCOUNT_1's accountId.`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
