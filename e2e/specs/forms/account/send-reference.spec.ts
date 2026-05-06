import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
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
 * Send Reference XIN wizard (`#/wallet/account/send/reference`) — expert mode.
 *
 * Creates a phased payment referenced to a prior transaction's fullHash.
 * `phasingVotingModel=4` is the TRANSACTION voting model in IEP (VoteWeighting.java)
 * — the chain releases the payment when the linked transaction (phasingLinkedFullHash)
 * is confirmed on-chain. An empty phasingLinkedFullHash fails API validation with
 * a 32-byte hash length check, so the beforeAll creates a real reference tx.
 *
 * Required fields: recipientRS (required), amount (required, minValue=1).
 * Optional: blockheight, fullhash (technically required by the chain but not by
 * the Angular form validators), private message, public key.
 *
 * Key structural differences from send-deferred:
 *   - Next button uses `<i class="icon-next_arrow">`, not `fa-chevron-right`.
 *     The locator strategy must use `icon-next_arrow` — using `fa-chevron-right`
 *     would find zero elements and the test would hang.
 *   - Has an extra `input[name="fullhash"]` field not present in send-deferred.
 *   - getAndVerifyAccount() may show an info SweetAlert if CASH_ACCOUNT_RS has
 *     no registered public key — the test dismisses it before clicking Finish.
 *
 * What this catches:
 *   - SendReferenceComponent mounts and the `icon-next_arrow` Next button works
 *   - `f.invalid` gate: recipientRS + amount are the only required validators
 *   - The fullhash field is present (regression: field removed or renamed)
 *   - `getAndVerifyAccount(sendReferencedForm)` call on Next
 *   - TRANSACTION-mode phased payment encoding with phasingLinkedFullHash
 *
 * Migration risks:
 *   - icon-next_arrow is an icomoon icon, not a FontAwesome class — it may be
 *     renamed if the icomoon set is regenerated during migration
 *   - phasingVotingModel=4 (TRANSACTION) always requires a non-empty fullHash —
 *     if the component default changes, the beforeAll setup tx may no longer match
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';
const SIDEBAR_EXPERT_TOGGLE = '.sidebar-content li.wallet-switch a:has(i.icon-wallet)';
const ROUTE = '#/wallet/account/send/reference';
const SEND_AMOUNT_XIN = '1';
const FEE_TQT = 100_000_000n;
const AMOUNT_TQT = 100_000_000n;

// fullHash of a confirmed transaction, used as the linked reference in the wizard
let refTxFullHash: string;
let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  // Broadcast a simple sendMoney so we have a confirmed fullHash to reference
  const params = new URLSearchParams({
    requestType: 'sendMoney',
    recipient: CASH_ACCOUNT_RS,
    amountTQT: '100000000',
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: '100000000',
    deadline: '80',
    broadcast: 'true',
  });
  const resp = await apiCtx.post(API_BASE, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: params.toString(),
  });
  const created = await resp.json();
  if (!created.transaction || created.broadcasted !== true) {
    throw new Error(`send-reference setup tx failed: ${JSON.stringify(created)}`);
  }
  const txId: string = created.transaction;

  // Wait for confirmation, then read fullHash
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const txResp = await apiCtx.get(`${API_BASE}?requestType=getTransaction&transaction=${txId}`);
    const tx = await txResp.json();
    if (tx.block && typeof tx.confirmations === 'number') {
      refTxFullHash = tx.fullHash;
      return;
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  throw new Error(`reference tx ${txId} did not confirm within 60s — devnet forging stalled?`);
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
  await page.locator(SIDEBAR_EXPERT_TOGGLE).first().click();
  await page.waitForTimeout(150);
});

test('send-reference: form mounts with recipientRS, amount, and fullhash inputs', async ({ page }) => {
  await page.goto(ROUTE);

  await expect(
    page.locator('input[name="recipientRS"]'),
    'send-reference form did not mount',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.locator('input[name="amount"]'),
    'Amount input not visible',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The fullhash field is specific to send-reference (not present in send-deferred)
  await expect(
    page.locator('input[name="fullhash"]'),
    'fullhash input not visible — send-reference.component.html may have been modified',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('send-reference: Next button uses icon-next_arrow icon and is disabled until required fields filled', async ({ page }) => {
  await page.goto(ROUTE);

  // send-reference uses icon-next_arrow (icomoon), not fa-chevron-right
  const nextButton = page.locator('button.btn-gradient:has(i.icon-next_arrow)').first();
  await expect(
    page.locator('input[name="recipientRS"]'),
    'form did not mount',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton, 'Next must be disabled while form is empty').toBeDisabled();

  await page.locator('input[name="recipientRS"]').fill(CASH_ACCOUNT_RS);
  await page.locator('input[name="amount"]').fill('1');
  await page.locator('input[name="amount"]').blur();

  await expect(
    nextButton,
    'Next did not enable after recipientRS + amount filled — icon-next_arrow Next button locator ' +
    'may be wrong, or the template-driven validators regressed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
});

test('send-reference: full wizard broadcasts and unconfirmed balance drops', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const before = await getUnconfirmedBalance(request, apiOrigin, TEST_ACCOUNT_1_RS);

  await page.goto(ROUTE);

  const recipientInput = page.locator('input[name="recipientRS"]');
  await expect(recipientInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await recipientInput.fill(CASH_ACCOUNT_RS);
  await page.locator('input[name="amount"]').fill(SEND_AMOUNT_XIN);
  await page.locator('input[name="amount"]').blur();
  // Fill the linked-transaction hash — phasingVotingModel=4 (TRANSACTION) rejects
  // an empty phasingLinkedFullHash (chain validates 32-byte length).
  await page.locator('input[name="fullhash"]').fill(refTxFullHash);

  const nextButton = page.locator('button.btn-gradient:has(i.icon-next_arrow)').first();
  await expect(nextButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await nextButton.click();

  // getAndVerifyAccount() calls getAccountDetails(CASH_ACCOUNT_RS). If the account
  // has no registered public key it fires an info SweetAlert (non-blocking for JS
  // but visually modal). Dismiss it so it does not cover the Finish button.
  const swalOk = page.locator('.swal2-confirm');
  if (await swalOk.isVisible({ timeout: DEFAULT_TIMEOUT_MS }).catch(() => false)) {
    await swalOk.click();
    await expect(swalOk).not.toBeVisible({ timeout: 5_000 });
  }

  // Step 2 confirm: recipient RS must appear in an <h4>
  await expect(
    page.locator('h4', { hasText: CASH_ACCOUNT_RS }).first(),
    'Confirm step did not render recipient — archwizard transition broken in send-reference',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish did not enable — send-reference signing failed. ' +
    'Possible causes: (1) phasingLinkedFullHash validation rejected the hash, ' +
    '(2) createPhasedTransaction inner Observable swallowed, ' +
    `(3) refTxFullHash=${refTxFullHash?.slice(0, 16)}…`,
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

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
    `The send-reference broadcast may have been rejected.`,
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
