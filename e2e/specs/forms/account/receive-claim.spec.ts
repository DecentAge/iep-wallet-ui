import { createHash } from 'node:crypto';
import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Claim Secret Transaction tab (`#/wallet/account/receive-tab/claim`) — expert mode.
 *
 * The counterpart to the Send Secret / HTLC flow: the recipient reveals the
 * pre-image of the SHA-256 hash that was committed on-chain in the send-secret
 * phased payment. The ClaimComponent calls `accountService.approveTransactions(
 * publicKey, fullHash, fee, secretText)` which triggers `approveTransaction`
 * with `revealedSecret=secretText & revealedSecretIsText=true`.
 *
 * beforeAll:
 *   Creates a phased sendMoney from TEST_ACCOUNT_1 → TEST_ACCOUNT_2 with
 *   phasingVotingModel=5 (BY_HASH / SHA-256) and a known plaintext secret.
 *   Waits for confirmation, then reads the confirmed tx's `fullHash` — this
 *   is the value the claim form needs in the "Transaction Full Hash" input.
 *
 * Test:
 *   Logs in as TEST_ACCOUNT_2 (the recipient/claimant), enables expert mode,
 *   navigates to the Claim tab, fills fullHash + secretText, clicks the
 *   fa-user-secret button to trigger signing, and broadcasts.
 *
 * What this catches:
 *   - ClaimComponent mounts in the expert Receive tab strip
 *   - `confirmControlledTransaction(fullHash, secretText)` →
 *     `accountService.approveTransactions()` → unsigned bytes → sign → validBytes
 *   - The Finish button appears only when `*ngIf="validBytes"` (not always present)
 *   - `accountService.approveTransactions` passes `transactionFullHash` (not txId)
 *     and `revealedSecretIsText=true` to the API
 *
 * Migration risks:
 *   - ClaimComponent uses `function` syntax for `confirmControlledTransaction`
 *     (not an arrow function/class method) — `this` binding breaks under strict
 *     mode or if minification changes the prototype chain
 *   - The Finish button uses `btn-primary`, not `btn-gradient` — a style
 *     refactor that renames the class silently hides the broadcast trigger
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';
const SIDEBAR_EXPERT_TOGGLE = '.sidebar-content li.wallet-switch a:has(i.icon-wallet)';

// Fixed secret per suite run — we own both sides of the hash
const SECRET_TEXT = `e2e-claim-secret-${Date.now().toString(36)}`;
const SECRET_HASH_HEX = createHash('sha256').update(SECRET_TEXT, 'utf8').digest('hex');

let txFullHash: string;
let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  // Current height — phasingFinishHeight must be well ahead of the test
  const statusResp = await apiCtx.get(`${API_BASE}?requestType=getBlockchainStatus`);
  const status = await statusResp.json();
  const currentHeight: number = (status.numberOfBlocks ?? 0) - 1;

  // Create phased sendMoney (send-secret / HTLC) from TEST_ACCOUNT_1 → TEST_ACCOUNT_2
  // phasingVotingModel=5 = BY_HASH (SHA-256 hashed secret)
  const params = new URLSearchParams({
    requestType: 'sendMoney',
    recipient: TEST_ACCOUNT_2_RS,
    amountTQT: '100000000',             // 1 XIN locked until claimed or height reached
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: '100000000',
    deadline: '80',
    broadcast: 'true',
    phased: 'true',
    phasingFinishHeight: String(currentHeight + 1440),
    phasingVotingModel: '5',            // BY_HASH
    phasingHashedSecret: SECRET_HASH_HEX,
    phasingHashedSecretAlgorithm: '2',  // SHA-256
    phasingQuorum: '1',
    phasingMinBalance: '0',
    phasingMinBalanceModel: '0',
  });
  const resp = await apiCtx.post(API_BASE, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: params.toString(),
  });
  const created = await resp.json();
  if (!created.transaction || created.broadcasted !== true) {
    throw new Error(`send-secret setup failed: ${JSON.stringify(created)}`);
  }
  const txId: string = created.transaction;

  // Wait for confirmation + read fullHash
  // `approveTransactions` uses transactionFullHash, not the txId
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const txResp = await apiCtx.get(`${API_BASE}?requestType=getTransaction&transaction=${txId}`);
    const tx = await txResp.json();
    if (tx.block && typeof tx.confirmations === 'number') {
      txFullHash = tx.fullHash;
      return;
    }
    await new Promise(r => setTimeout(r, 1_000));
  }
  throw new Error(`send-secret tx ${txId} did not confirm within 60s — devnet forging stalled?`);
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  // Log in as TEST_ACCOUNT_2 — the HTLC recipient who claims the funds
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_2_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
  // Claim tab is expert-only: enable expert mode before navigating
  await page.locator(SIDEBAR_EXPERT_TOGGLE).first().click();
  await page.waitForTimeout(150);
});

test('receive-claim: Claim tab mounts with fullHash and secretText inputs', async ({ page }) => {
  await page.goto('#/wallet/account/receive-tab/claim');

  // The Claim tab title comes from the component's card-header
  await expect(
    page.locator('h3.card-title', { hasText: /Claim Secret Transaction/i }).first(),
    'Claim Secret Transaction title not visible — ClaimComponent or expert Receive tab broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.locator('input[name="transaction_hash"]'),
    'Transaction full hash input not mounted',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.locator('input[name="secret_text"]'),
    'Secret text input not mounted',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.locator('span.btn-primary:has(i.fa-user-secret), div:has(i.fa-user-secret)').first(),
    'fa-user-secret claim button not visible',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('receive-claim: filling fullHash + secret and clicking claim enables Finish button, then broadcasts', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/account/receive-tab/claim');

  await expect(
    page.locator('input[name="transaction_hash"]'),
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await page.locator('input[name="transaction_hash"]').fill(txFullHash);
  await page.locator('input[name="secret_text"]').fill(SECRET_TEXT);

  // Clicking the fa-user-secret button calls confirmControlledTransaction()
  // → approveTransactions() → signs → validBytes=true → Finish button appears
  await page.locator('i.fa-user-secret').first().click();

  // Finish button is inside *ngIf="validBytes", so it's not in DOM until signing succeeds
  const finishButton = page.locator('button.btn-primary:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not appear — confirmControlledTransaction() signing failed. ' +
    'Possible causes: (1) this binding broken (function keyword not arrow), ' +
    '(2) approveTransaction API rejected fullHash or secretText, ' +
    `(3) secret hash mismatch (hash=${SECRET_HASH_HEX.slice(0, 16)}…, txFullHash=${txFullHash.slice(0, 16)}…)`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(finishButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Broadcast the claim → chain releases the 1 XIN to TEST_ACCOUNT_2
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // The confirmed claim tx must come from TEST_ACCOUNT_2 (the claimant)
  expect(
    tx.senderRS ?? tx.sender,
    'claim tx sender should be TEST_ACCOUNT_2',
  ).toBe(TEST_ACCOUNT_2_RS);
});
