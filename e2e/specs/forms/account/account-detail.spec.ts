import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Account Detail (`#/wallet/account/detail`) — pins the wallet's display of
 * a logged-in user's chain identity and balances.
 *
 * Migration risks this catches:
 *   - the `amountTqt` pipe (formats balance figures) — pure formatting code
 *     that often gets touched in pipe API rewrites between Angular majors
 *   - the binding chain `getAccount → component.account → templates`
 *   - any layout regression that hides the balances behind a broken collapse
 *     panel (this view uses several ngb-popover instances)
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('account-detail: displays the logged-in account RS', async ({ page }) => {
  await page.goto('#/wallet/account/detail');

  // The accountRS is rendered in an <h4> right under the page title.
  // Match by text content rather than DOM position to survive layout tweaks.
  const accountRsCell = page.locator('h4', { hasText: TEST_ACCOUNT_1_RS }).first();
  await expect(
    accountRsCell,
    `account/detail should display ${TEST_ACCOUNT_1_RS} for the logged-in user`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('account-detail: displays a non-zero confirmed balance', async ({ page }) => {
  await page.goto('#/wallet/account/detail');

  // The confirmed-balance row is the first <h4> that contains "XIN" — the
  // amountTqt pipe formats numbers as "1,234.56 XIN". A funded test account
  // must show > 0.
  const balanceLines = page.locator('h4').filter({ hasText: /\bXIN\b/ });
  // First match is the confirmed-balance figure.
  const firstBalance = balanceLines.first();
  await expect(firstBalance).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const txt = (await firstBalance.textContent()) ?? '';
  // Strip everything but digits to assert the numeric portion is non-zero.
  const digits = txt.replace(/[^\d]/g, '');
  expect(
    BigInt(digits || '0') > 0n,
    `confirmed balance shown on account/detail is zero (text = "${txt.trim()}") — ` +
    `Test Account 1 should have funds; the binding may have broken`,
  ).toBe(true);
});
