import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  CASH_ACCOUNT_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Send Deferred XIN wizard (`#/wallet/account/send/deferred`) — expert mode.
 *
 * Creates a phased payment that executes automatically at `currentHeight +
 * deferredHeight` blocks. Distinct from send-secret (which requires a
 * claimant to reveal a pre-image): deferred executes unconditionally when
 * the height is reached, or the sender recovers the funds if the recipient
 * doesn't collect before expiry (chain's automatic RELEASE_PHASED_TRANSACTION).
 *
 * Required fields: recipientRS (required), amount (required, minValue=1).
 * Optional: blockheight (defaults to 1440), private message, public key.
 *
 * What this catches:
 *   - SendDeferredComponent archwizard: Next button gated on `f.invalid`
 *   - `getAndVerifyAccount(sendDeferredForm)` called on Next: recipient
 *     lookup, signing of the PHASED_PAYMENT attachment
 *   - The fa-chevron-right Next button (vs icon-next_arrow used in send-reference)
 *   - PHASED_PAYMENT attachment encoding in signTransactionHex
 *   - Chain accepting a phased payment with phasingVotingModel=0 (height-only)
 *
 * Migration risks:
 *   - sendDeferredForm.deferredHeight initialisation — if undefined it becomes
 *     NaN in the API params and the chain rejects the tx
 *   - The custom minValue="1" validator on amount — same risk as send-simple
 */

const SIDEBAR_EXPERT_TOGGLE = '.sidebar-content li.wallet-switch a:has(i.icon-wallet)';
const ROUTE = '#/wallet/account/send/deferred';
const SEND_AMOUNT_XIN = '1';
const FEE_TQT = 100_000_000n;
const AMOUNT_TQT = 100_000_000n;

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
  // Expert mode exposes the Send tab strip (Simple / Deferred / Reference / Secret)
  await page.locator(SIDEBAR_EXPERT_TOGGLE).first().click();
  await page.waitForTimeout(150);
});

test('send-deferred: Next disabled until required fields filled, enabled after', async ({ page }) => {
  await page.goto(ROUTE);

  const recipientInput = page.locator('input[name="recipientRS"]');
  const amountInput    = page.locator('input[name="amount"]');
  const nextButton     = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(recipientInput, 'send-deferred form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton, 'Next must be disabled while form is empty').toBeDisabled();

  await recipientInput.fill(CASH_ACCOUNT_RS);
  await amountInput.fill(SEND_AMOUNT_XIN);
  await amountInput.blur();

  await expect(
    nextButton,
    'Next did not enable after recipientRS + amount filled — template-driven validators regressed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
});

test('send-deferred: amount below minValue=1 keeps Next disabled', async ({ page }) => {
  await page.goto(ROUTE);

  await page.locator('input[name="recipientRS"]').fill(CASH_ACCOUNT_RS);
  await page.locator('input[name="amount"]').fill('0');
  await page.locator('input[name="amount"]').blur();

  await expect(
    page.locator('button.btn-gradient:has(i.fa-chevron-right)').first(),
    'Next must stay disabled with amount=0 — minValue validator did not fire on send-deferred',
  ).toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS });
});

test('send-deferred: full wizard broadcasts phased payment and unconfirmed balance drops', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const before = await getUnconfirmedBalance(request, apiOrigin, TEST_ACCOUNT_1_RS);

  await page.goto(ROUTE);

  const recipientInput = page.locator('input[name="recipientRS"]');
  const amountInput    = page.locator('input[name="amount"]');
  const nextButton     = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(recipientInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await recipientInput.fill(CASH_ACCOUNT_RS);
  await amountInput.fill(SEND_AMOUNT_XIN);
  await amountInput.blur();
  await expect(nextButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Next calls getAndVerifyAccount() + signs the PHASED_PAYMENT attachment
  await nextButton.click();

  // Step 2 confirm: recipient RS renders in <h4>
  await expect(
    page.locator('h4', { hasText: CASH_ACCOUNT_RS }).first(),
    'Confirm step did not render recipient — archwizard transition broken in send-deferred',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — PHASED_PAYMENT signing failed in send-deferred ' +
    '(deferredHeight may be NaN from uninitialised sendDeferredForm.deferredHeight)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // Phased payments deduct the locked amount from unconfirmedBalance immediately.
  const expectedDelta = AMOUNT_TQT + FEE_TQT;
  const deadline = Date.now() + 30_000;
  let after = before;
  while (Date.now() < deadline) {
    after = await getUnconfirmedBalance(request, apiOrigin, TEST_ACCOUNT_1_RS);
    if (before - after >= expectedDelta) break;
    await page.waitForTimeout(500);
  }

  expect(
    before - after,
    `unconfirmedBalance dropped by ${before - after} TQT, expected at least ${expectedDelta}. ` +
    `The deferred send broadcast may have failed — inspect iep-node logs.`,
  ).toBeGreaterThanOrEqual(expectedDelta);
});

async function getUnconfirmedBalance(
  request: import('@playwright/test').APIRequestContext,
  apiOrigin: string,
  accountRS: string,
): Promise<bigint> {
  const resp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAccount', account: accountRS },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(resp.ok()).toBe(true);
  return BigInt((await resp.json()).unconfirmedBalanceTQT ?? '0');
}
