import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  CASH_ACCOUNT_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Create Subscription wizard (`#/wallet/subscriptions/create-subscription`) —
 * sets up a recurring on-chain payment to a recipient at a fixed interval.
 * Exercises the SUBSCRIPTION_CREATION subtype (`requestType=sendMoneySubscription`),
 * which no other test in the suite touches.
 *
 * Migration risks this catches:
 *   - 2-step archwizard with a 3-field template-driven form
 *   - the `interval` input's compound `[minValue]="0.0417" [maxValue]="365"`
 *     validators — the only form in the suite using maxValue, so a regression
 *     in NgModel's bounded-numeric pipeline hits here first
 *   - the SUBSCRIPTION_CREATION subtype attachment encoding inside signTransactionHex
 *
 * Drives the wizard through Finish + broadcast on devnet, then confirms via
 * `getSubscription` that the recurring payment was registered. Each rerun
 * leaves a fresh subscription on chain (no uniqueness constraint), but the
 * test verifies its own broadcast tx and is otherwise idempotent.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('create-subscription: 2-step wizard broadcasts sendMoneySubscription and getSubscription returns it', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/subscriptions/create-subscription');

  const recipientInput = page.locator('input[name="recipient"]');
  const amountInput    = page.locator('input[name="amount"]');
  const intervalInput  = page.locator('input[name="interval"]');
  const nextButton     = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(recipientInput, 'create-subscription form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton, 'Next must be disabled while form is empty').toBeDisabled();

  await recipientInput.fill(CASH_ACCOUNT_RS);
  await amountInput.fill('1');
  // Interval is bounded `[0.0417, 365]` (~1 hour to 365 days). 1 day is a
  // representative value well inside both bounds.
  await intervalInput.fill('1');
  await intervalInput.blur();

  await expect(
    nextButton,
    'Next button did not enable after all 3 required fields were filled — ' +
    'one of the template-driven validators (required / minValue=0.0417 / maxValue=365) regressed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await nextButton.click();   // calls createSubscription() → signs SUBSCRIPTION_CREATION attachment

  // Step 2 confirm view — recipient is rendered in <h4>.
  await expect(
    page.locator('h4', { hasText: CASH_ACCOUNT_RS }).first(),
    'step-2 confirm did not render the entered recipient — archwizard transition broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish button only enables when validBytes becomes true (createSubscription's
  // backend call returned unsigned bytes that signed locally).
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — SUBSCRIPTION_CREATION signing failed (chain rejection?)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Toggle the "show signed transaction" button and verify the textarea
  // actually contains hex bytes — direct proof the signing chain produced
  // output for this subtype.
  await page.locator('button.btn-raised:has(i.fa-key)').first().click();
  const signedBytes = page.locator('textarea[name="key"]').first();
  await expect(signedBytes).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const bytesText = ((await signedBytes.inputValue()) ?? '').trim();
  expect(
    /^[0-9a-fA-F]+$/.test(bytesText) && bytesText.length > 100,
    `signed-transaction textarea did not contain a hex blob (got "${bytesText.slice(0, 60)}…") — ` +
    `cryptoService.signTransactionHex output may have changed`,
  ).toBe(true);

  // Click Finish → wallet POSTs broadcastTransaction → poll until confirmed.
  // The sendMoneySubscription tx id IS the subscription id (for getSubscription).
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  const subResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getSubscription', subscription: txId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(subResp.ok()).toBe(true);
  const sub = await subResp.json();
  expect(
    sub.errorCode,
    `getSubscription returned an error after broadcast (tx ${txId}): ${JSON.stringify(sub)}`,
  ).toBeUndefined();
  expect(sub.recipientRS, 'subscription recipient on chain does not match').toBe(CASH_ACCOUNT_RS);
  // 1 day interval → 86400 s; we filled "1" days, so verify the chain stored it as such.
  expect(Number(sub.frequency), 'subscription interval (frequency) on chain does not match').toBe(86400);
});

test('create-subscription: interval below 0.0417 (~1 hour) keeps Next disabled', async ({ page }) => {
  await page.goto('#/wallet/subscriptions/create-subscription');

  const recipientInput = page.locator('input[name="recipient"]');
  const amountInput    = page.locator('input[name="amount"]');
  const intervalInput  = page.locator('input[name="interval"]');
  const nextButton     = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await recipientInput.fill(CASH_ACCOUNT_RS);
  await amountInput.fill('1');
  // Below the 0.0417 floor — minValue validator must reject.
  await intervalInput.fill('0.01');
  await intervalInput.blur();

  await expect(
    nextButton,
    'Next must stay disabled — interval below the documented 0.0417 (~1 hour) floor ' +
    'should fail the minValue validator',
  ).toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS });
});

test('create-subscription: interval above 365 days keeps Next disabled', async ({ page }) => {
  await page.goto('#/wallet/subscriptions/create-subscription');

  const recipientInput = page.locator('input[name="recipient"]');
  const amountInput    = page.locator('input[name="amount"]');
  const intervalInput  = page.locator('input[name="interval"]');
  const nextButton     = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await recipientInput.fill(CASH_ACCOUNT_RS);
  await amountInput.fill('1');
  // Above the 365-day ceiling — maxValue validator must reject.
  await intervalInput.fill('400');
  await intervalInput.blur();

  await expect(
    nextButton,
    'Next must stay disabled — interval above the 365-day ceiling should fail the maxValue validator',
  ).toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS });
});
