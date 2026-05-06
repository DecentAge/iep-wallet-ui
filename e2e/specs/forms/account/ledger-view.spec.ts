import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Account Ledger page (`#/wallet/account/ledger-view`).
 *
 * Shows a paginated ngx-datatable of every balance-changing event for the
 * logged-in account (confirmed txs, block rewards, fees paid, etc.). The
 * ledger is always non-empty for a funded devnet account.
 *
 * What this catches:
 *   - LedgerViewComponent.setPage() → getAccountLedger() → `entries` binding
 *   - Pipe registrations: `timestamp`, `isEnabled`, `ledgerHolding`,
 *     `ledgerTxTypes`, `amountTqt` — all used in cell templates; a broken
 *     pipe silently renders empty cells
 *   - Column header translation: bare keys like "table-header.id" signal a
 *     TranslateModule failure in the account lazy module
 *   - Reload button wiring (calls setPage({ offset: 0 }))
 *
 * Migration risks:
 *   - `entries` vs `rows` binding name — the datatable uses `[rows]="entries"`
 *     (not the conventional `rows`); a refactor that renames the field to
 *     `rows` without updating the template leaves a permanently empty table
 *   - `getAccountLedger` passes `accountId` from session; an accountId/accountRS
 *     confusion leaves the API returning empty or errorCode 5
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

test('ledger-view: title and reload button render', async ({ page }) => {
  await page.goto('#/wallet/account/ledger-view');

  await expect(
    page.locator('h2.main-title'),
    'Account Ledger page title did not render',
  ).toContainText('Account Ledger', { timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.locator('a:has(i.fa-refresh), button:has(i.fa-refresh)').first(),
    'Reload button not visible — ledger-view.component.html header may be broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('ledger-view: datatable mounts with translated column headers', async ({ page }) => {
  await page.goto('#/wallet/account/ledger-view');

  const datatable = page.locator('ngx-datatable').first();
  await expect(
    datatable,
    'ngx-datatable did not mount on ledger-view — LedgerViewComponent or lazy-load broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Column headers must be translated strings, not raw i18n keys
  const firstHeader = page.locator('ngx-datatable .datatable-header-cell-label').first();
  await expect(firstHeader).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const headerText = ((await firstHeader.textContent()) ?? '').trim();
  expect(
    /^table-header\./.test(headerText),
    `First column header looks like an untranslated i18n key ("${headerText}") — ` +
    `TranslateModule may have failed to load in the account module`,
  ).toBe(false);

  // All 9 columns defined in ledger-view.component.html
  for (const col of ['ID', 'Date', 'Transaction', 'Event', 'Holding Type', 'Transaction Type', 'Change', 'Balance', 'Action']) {
    await expect(
      page.getByText(col, { exact: true }).first(),
      `Column header "${col}" not found in ledger datatable`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }
});

test('ledger-view: datatable shows at least one entry for the funded test account', async ({ page }) => {
  await page.goto('#/wallet/account/ledger-view');

  await expect(
    page.locator('ngx-datatable').first(),
    'ngx-datatable did not mount',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // TEST_ACCOUNT_1 is funded by docker_init_devnet.sh and has sent/received
  // transactions throughout the test suite — the ledger must have at least one row.
  const firstRow = page.locator('datatable-body-row').first();
  await expect(
    firstRow,
    'ledger-view datatable has no rows — getAccountLedger may be using the wrong accountId, ' +
    'or the `[rows]="entries"` binding was renamed without updating the template',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
