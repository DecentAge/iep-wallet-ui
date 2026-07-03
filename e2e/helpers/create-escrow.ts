import { Browser, expect } from '@playwright/test';
import { WelcomePage } from '../pages/welcome.page';
import { DashboardPage } from '../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  CASH_ACCOUNT_RS,
  TEST_ACCOUNT_2_RS,
} from '../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from './broadcast-confirm';

/**
 * Creates a test escrow on-chain using the create-escrow wizard UI.
 *
 * Sender: TEST_ACCOUNT_1, Recipient: CASH_ACCOUNT_RS, Signer: TEST_ACCOUNT_2.
 * Deadline action: Refund (funds return to sender on expiry — safe for tests).
 * Broadcasts and polls until confirmed, then returns the transaction ID which
 * is also the escrow ID used in getEscrowTransaction / sign-escrow / escrow-status.
 *
 * Runs in an isolated browser context so it does not interfere with the
 * test-level page fixture.
 */
export async function createTestEscrow(
  browser: Browser,
  baseURL: string | undefined,
): Promise<string> {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  try {
    const welcome = new WelcomePage(page);
    await welcome.goto();
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await new DashboardPage(page).expectVisible();

    await page.goto('#/wallet/escrow/create-escrow');

    const recipientInput = page.locator('input[name="recipientRS"]');
    await expect(recipientInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    await recipientInput.fill(CASH_ACCOUNT_RS);
    await page.locator('input[name="amount"]').fill('1');
    await page.locator('input[name="escrowDeadline"]').fill('10');
    await page.locator('select[name="type"]').selectOption({ label: 'Refund' });
    await page.locator('input[name="requiredSigners"]').fill('1');
    const signersTextarea = page.locator('textarea[name="signers"]');
    await signersTextarea.fill(TEST_ACCOUNT_2_RS);
    await signersTextarea.blur();

    const nextButton = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
    await expect(nextButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    await nextButton.click();

    const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
    await expect(finishButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const { txId } = await broadcastAndAwaitConfirmation(page, page.request, apiOrigin, finishButton);
    return txId;
  } finally {
    await context.close();
  }
}
