import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  CASH_ACCOUNT_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { createTestEscrow } from '../../../helpers/create-escrow';

/**
 * My Escrow list page (`#/wallet/escrow/my-escrow`).
 *
 * beforeAll creates one escrow on-chain so there is guaranteed data in the
 * list. Tests then verify the page structure and that the created escrow's
 * recipient appears as a datatable row.
 *
 * Migration risks:
 *   - getAccountEscrowTransactions API wiring and `escrows` array mapping
 *     in MyEscrowComponent.setPage() — a key rename or response shape change
 *     yields an empty table
 *   - escrowRole pipe renders the sender/signer distinction — a broken pipe
 *     shows empty Role cells
 *   - ngx-datatable column binding (`prop="recipientRS"`, `prop="senderRS"`,
 *     `prop="deadlineAction"`, `prop="amountTQT"`) — a typo in prop silently
 *     shows empty cells that could mask a data regression
 */

let escrowId: string;

test.beforeAll(async ({ browser, baseURL }) => {
  escrowId = await createTestEscrow(browser, baseURL);
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
  await page.goto('#/wallet/escrow/my-escrow');
});

test('my-escrow: page title and datatable column headers render', async ({ page }) => {
  await expect(
    page.locator('h2.main-title'),
    'MY ESCROW page title did not render',
  ).toContainText('MY ESCROW', { timeout: DEFAULT_TIMEOUT_MS });

  // All seven columns defined in my-escrow.component.html
  for (const header of ['Role', 'Expires', 'Deadline', 'Sender', 'Amount', 'Recipient', 'Actions']) {
    await expect(
      page.getByText(header, { exact: true }).first(),
      `Column header "${header}" not found in datatable`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }
});

test('my-escrow: created escrow appears in list with correct recipient and deadline action', async ({ page }) => {
  // The escrow created in beforeAll has CASH_ACCOUNT_RS as recipient and
  // deadline action "REFUND". Both must be visible in the datatable row.
  await expect(
    page.getByText(CASH_ACCOUNT_RS).first(),
    `Recipient ${CASH_ACCOUNT_RS} not found in my-escrow table — ` +
    `getAccountEscrowTransactions may not be returning new escrow (id: ${escrowId})`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.getByText('REFUND').first(),
    'Deadline action "REFUND" not found in my-escrow table — deadlineAction column binding broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
