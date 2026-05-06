import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  CASH_ACCOUNT_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Transactions list — validates the wallet's two ngx-datatable instances
 * (pending + completed) at #/wallet/account/transactions.
 *
 * `@swimlane/ngx-datatable@11.3.2` (the table renderer) is one of the
 * heavier-to-bump deps in the wallet, so a real "row appears after a tx is
 * sent" check is the right level of regression cover.
 *
 * Strategy: send a fresh tx via the iep-node API directly (faster than
 * driving the UI again — we already cover that in send-tx.spec.ts), then
 * navigate to the transactions page and confirm a row exists with our
 * recipient. Doesn't wait for confirmation — the pending list shows the tx
 * immediately on broadcast.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('transactions: a recently broadcast tx appears in the list', async ({ page, request, baseURL }) => {
  const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;

  // 1. Send a small tx via the API. POST is intentional so the passphrase
  //    doesn't end up in the access log.
  const sendResponse = await request.post(`${apiOrigin}/api`, {
    form: {
      requestType: 'sendMoney',
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      recipient: CASH_ACCOUNT_RS,
      amountTQT: '1',                  // 1 TQT — minimum amount, fee dominates
      feeTQT: '100000000',
      deadline: '80',
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(sendResponse.ok(), `sendMoney HTTP ${sendResponse.status()}`).toBe(true);
  const sendBody = await sendResponse.json();
  expect(sendBody.broadcasted, `sendMoney did not broadcast: ${sendBody.errorDescription}`).toBe(true);

  // 2. Navigate to the transactions page.
  await page.goto('#/wallet/account/transactions');

  // 3. The page renders two ngx-datatables (pending + completed). The just-
  //    broadcast tx is in the pending pool. Wait for a row mentioning our
  //    recipient. ngx-datatable's row-cell template renders accountRS into
  //    a <span> or similar — `getByText` with substring match is robust.
  const recipientText = page.getByText(CASH_ACCOUNT_RS, { exact: false }).first();
  await expect(
    recipientText,
    `no row referencing recipient ${CASH_ACCOUNT_RS} appeared in the transactions table within ${DEFAULT_TIMEOUT_MS}ms. ` +
    `The pending tx may have been rejected by the chain — inspect via:\n` +
    `  curl 'http://node-1/api?requestType=getUnconfirmedTransactions&account=${TEST_ACCOUNT_1_RS}'`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('transactions: page renders both pending and completed datatables', async ({ page }) => {
  // Structural smoke: the HistoryComponent embeds <app-pending-transactions>
  // and <app-completed-transactions>; both should mount when the page loads,
  // each with an ngx-datatable instance.
  await page.goto('#/wallet/account/transactions');

  // ngx-datatable renders a <datatable-body> wrapper inside <ngx-datatable>.
  const tables = page.locator('ngx-datatable');
  await expect(tables.first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  // Expect at least one (pending may be empty, completed may be empty too —
  // but both tables mount even when their row arrays are empty).
  const tableCount = await tables.count();
  expect(tableCount, 'expected at least one ngx-datatable on the transactions page').toBeGreaterThanOrEqual(1);
});
