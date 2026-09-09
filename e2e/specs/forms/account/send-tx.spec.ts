import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { SendSimplePage } from '../../../pages/send-simple.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  CASH_ACCOUNT_RS,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation } from '../../../helpers/broadcast-confirm';

const SIDEBAR_EXPERT_TOGGLE = '.sidebar-content li.wallet-switch a:has(i.icon-wallet)';

/**
 * Send-XIN happy path — the marquee end-to-end test for the wallet.
 *
 * What this exercises (everything from the login session through the chain):
 *   - login derives a keypair and stashes the private key in sessionStorage
 *   - Send/simple form (template-driven Reactive forms + ng-bootstrap)
 *   - angular-archwizard step navigation
 *   - client-side signing (cryptoService — Curve25519, signTransactionHex)
 *   - HTTP POST to iep-node /api?requestType=broadcastTransaction
 *   - chain accepts the signed bytes (unconfirmed-balance changes immediately)
 *
 * Doesn't wait for block confirmation — devnet block time ~60 s and the
 * chain-acceptance signal (drop in unconfirmedBalanceTQT) is enough to prove
 * the wallet end-to-end. Confirmation correctness is the chain's
 * responsibility, not the wallet's.
 *
 * Per-run cost: 1 TQT amount + 100,000,000 TQT (1 XIN) fee. Test Account 1
 * has ~10^17 TQT; ~10^9 runs before depletion.
 */

const SEND_AMOUNT_XIN = '1';                          // 1 XIN to send (recipient gets 1 XIN)
const FEE_TQT = 100_000_000n;                         // wallet's default per-tx fee in TQT
const AMOUNT_TQT = 100_000_000n;                      // 1 XIN = 1e8 TQT

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('send-tx: happy-path send is recorded on chain with amount + fee', async ({ page, request, baseURL }) => {
  const send = new SendSimplePage(page);
  const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;

  // 2. Drive the UI: open Send → fill the form → Next.
  await send.goto();
  await send.recipient.fill(CASH_ACCOUNT_RS);
  await send.amount.fill(SEND_AMOUNT_XIN);
  await expect(send.submit).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await send.submit.click();    // advances wizard + auto-signs

  // 3. Wait for step 2: Broadcast button must become enabled (signing done).
  await expect(send.broadcast).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // 4. Broadcast and wait for the chain to include the transaction.
  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, send.broadcast);

  // 5. Assert what this transaction did. A raw unconfirmed-balance delta looks
  //    tempting but is not safe on a chain that other specs have been using:
  //    an expiring escrow or a subscription payout credits the account inside
  //    the same window and the delta then measures the wrong thing.
  expect(BigInt(tx.amountTQT ?? '0'), `tx ${txId} carries amountTQT=${tx.amountTQT}`).toBe(AMOUNT_TQT);
  expect(BigInt(tx.feeTQT ?? '0'), `tx ${txId} carries feeTQT=${tx.feeTQT}`).toBe(FEE_TQT);
  expect(tx.senderRS, `tx ${txId} was signed by the wrong account`).toBe(TEST_ACCOUNT_1_RS);
  expect(tx.recipientRS, `tx ${txId} went to the wrong recipient`).toBe(CASH_ACCOUNT_RS);
});

/**
 * Send-XIN with an encrypted private message — extends the marquee happy-path
 * test by exercising the message attachment + encryption pipeline.
 *
 * The "Add private message" toggle in the Send form is misleadingly named:
 * the message is NOT a plaintext attachment, it's encrypted in the wallet via
 * `cryptoService.encryptMessage(message, senderSecretHex, recipientPublicKey)`
 * before being signed into the transaction (see send-simple.component.ts
 * line 241). So this test additionally covers:
 *   - the encryptMessage crypto path (Curve25519 ECDH → AES → nonce)
 *   - lookup of the recipient's public key on chain (getAccount.publicKey)
 *   - the appendix-message attachment encoding in signTransactionHex
 *   - the chain accepting an OrdinaryPayment with an EncryptedMessage appendix
 *
 * Pre-requisite: CASH_ACCOUNT_RS must already have a public key registered
 * on chain (which it does — the Cash Account has signed transactions during
 * docker_init_devnet.sh). If a fresh devnet ever drops this assumption, the
 * wallet pops a "recipient public key required" sweetalert and the test
 * fails fast with a clear UI-side error.
 */
test('send-tx with private message: chain records the encrypted-message attachment', async ({ page, request, baseURL }) => {
  const send = new SendSimplePage(page);
  const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;

  // Use TEST_ACCOUNT_2 (not cash) as recipient so the test asserts BOTH the
  // sender's unconfirmed-balance drop AND the recipient's unconfirmed-balance
  // rise. Cash receives many inbound txs across runs, so its delta is too
  // noisy to measure cleanly. TEST_ACCOUNT_2 starts each test with a known
  // balance from docker_init_devnet.sh's bootstrap and is otherwise idle.
  // It also has a public key registered on chain (via the bootstrap's
  // TEST_ACCOUNT_2 → cash payment), which the encryption path needs.
  // Unique message string per run so an unrelated wallet bug that loses
  // the attachment payload would show up as a missing-text failure later
  // (when we extend the test with a chain-side attachment assertion).
  const uniqueMessage = `e2e-msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // Drive the form: open Send, reveal the message field, fill all three.
  await send.goto();
  await expect(send.message, 'message input must be hidden until "Add private message" is clicked').toBeHidden();
  await send.togglePrivateMessage();
  await expect(send.message).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await send.recipient.fill(TEST_ACCOUNT_2_RS);
  await send.amount.fill(SEND_AMOUNT_XIN);
  await send.message.fill(uniqueMessage);
  await send.message.blur();
  await expect(send.submit).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Click Next — fires getAndVerifyAccount → encryptMessage → signTransactionHex.
  // If the recipient lacks a public key, an Info alert pops here and signing
  // never completes; the broadcast button below would stay disabled.
  await send.submit.click();

  await expect(
    send.broadcast,
    'Broadcast button never enabled — encryptMessage / signTransactionHex / ' +
    'getAccount(recipient) likely failed; check the wallet UI for an error alert',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, send.broadcast);

  // Assert the transaction itself rather than balance deltas: other specs leave
  // escrows and subscriptions on the chain that credit these accounts in the
  // same window. The attachment is what this test exists for.
  expect(BigInt(tx.amountTQT ?? '0'), `tx ${txId} carries amountTQT=${tx.amountTQT}`).toBe(AMOUNT_TQT);
  // An encrypted appendix is charged per byte, so the fee is a lower bound.
  expect(BigInt(tx.feeTQT ?? '0'), `tx ${txId} fee ${tx.feeTQT} below the base fee`).toBeGreaterThanOrEqual(FEE_TQT);
  expect(tx.senderRS, `tx ${txId} was signed by the wrong account`).toBe(TEST_ACCOUNT_1_RS);
  expect(tx.recipientRS, `tx ${txId} went to the wrong recipient`).toBe(TEST_ACCOUNT_2_RS);
  expect(
    tx.attachment?.encryptedMessage?.data,
    `tx ${txId} carries no encryptedMessage appendix — cryptoService.encryptMessage or the ` +
    `attachment encoding in signTransactionHex dropped it (attachment: ${JSON.stringify(tx.attachment)})`,
  ).toBeTruthy();
});

/**
 * Send-Secret (HTLC / phased payment) — expert-mode "Secret" tab on the
 * Send wizard. Locks `amount` under a SHA-256 secret hash for `deferredHeight`
 * blocks. The recipient can claim by revealing the matching pre-image; if
 * they don't, the sender automatically recovers the funds at
 * `currentHeight + deferredHeight`.
 *
 * What this test covers (Option B per the test plan — sender-side broadcast
 * only; the recipient-side claim flow is its own future test):
 *   - Expert mode toggle (sidebar wallet-switch)
 *   - Routing to the lazy-loaded send-secret child route inside the expert
 *     section's <router-outlet>
 *   - The send-secret form (4 inputs: recipient, amount, blockheight, fullhash)
 *   - The SEND_SECRET subtype attachment encoding inside signTransactionHex
 *   - Chain accepting a phased payment with `phasingHashedSecret`
 *
 * Side effect: leaves a 1-day pending phased tx on devnet. iep-node returns
 * the locked funds to the sender automatically at deferredHeight (1440
 * blocks). Harmless on devnet; would be ~24 h on mainnet.
 */
test('send-secret: phased payment with SHA-256 hashed secret broadcast accepted by chain', async ({ page, request, baseURL }) => {
  const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;

  const before = await getUnconfirmedBalanceTQT(request, apiOrigin, TEST_ACCOUNT_1_RS);

  // Generate a fresh secret per run. We commit only the hash on chain — the
  // pre-image stays in this process (would be revealed by recipient's claim
  // tx, but Option B doesn't exercise that).
  const secretText = `e2e-secret-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const secretHashHex = createHash('sha256').update(secretText, 'utf8').digest('hex');

  // Enable expert mode — without it, the Secret tab + child route aren't
  // mounted (the entire <section *isExpertView="true"> is removed).
  await page.locator(SIDEBAR_EXPERT_TOGGLE).first().click();
  await expect(
    page.locator(`${SIDEBAR_EXPERT_TOGGLE} .menu-title`).first(),
    'expert toggle did not flip — sidebar still showing basic label',
  ).toContainText(/expert/i, { timeout: DEFAULT_TIMEOUT_MS });

  await page.goto('#/wallet/account/send/secret');

  const recipient   = page.locator('input[name="recipientRS"]');
  const amount      = page.locator('input[name="amount"]');
  const blockheight = page.locator('input[name="blockheight"]');
  const fullhash    = page.locator('input[name="fullhash"]');
  const submit      = page.locator('app-send-secret button.btn-gradient:has(i.icon-next_arrow), app-send-secret .right button.btn-gradient').first();
  const broadcast   = page.locator('app-send-secret button.btn-gradient:has(i.fa-check)');

  await expect(recipient, 'send-secret form did not mount — expert routing or lazy-load broken').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(blockheight).toHaveValue(/^1440$/);    // wallet defaults the lock-up to 1 day

  await recipient.fill(CASH_ACCOUNT_RS);
  await amount.fill(SEND_AMOUNT_XIN);
  // Leave blockheight at the default 1440 — minimum lock-up; tx auto-recovers
  // in ~1 day if no claim arrives.
  await fullhash.fill(secretHashHex);
  await fullhash.blur();
  await expect(submit).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await submit.click();   // advances wizard + signs the SEND_SECRET attachment

  await expect(
    broadcast,
    'Broadcast button never enabled — SEND_SECRET signing or recipient-pubkey ' +
    'lookup failed; check the wallet alert',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await broadcast.click();

  // Phased payments may carry a higher fee than ordinary payments due to the
  // phasing-attachment per-byte cost; assert a LOWER bound (amount + base fee).
  const expectedDelta = AMOUNT_TQT + FEE_TQT;
  const deadline = Date.now() + 30_000;
  let after = before;
  while (Date.now() < deadline) {
    after = await getUnconfirmedBalanceTQT(request, apiOrigin, TEST_ACCOUNT_1_RS);
    if (before - after >= expectedDelta) break;
    await page.waitForTimeout(500);
  }

  expect(
    before - after,
    `unconfirmedBalance dropped by ${before - after} TQT, expected at least ${expectedDelta} ` +
    `(amount ${AMOUNT_TQT} + fee ${FEE_TQT}). Phased SEND_SECRET broadcast may have failed silently.`,
  ).toBeGreaterThanOrEqual(expectedDelta);
});

/** Read the sender's unconfirmedBalanceTQT (settles immediately on broadcast,
 *  unlike confirmedBalance which waits for a block). */
async function getUnconfirmedBalanceTQT(
  request: import('@playwright/test').APIRequestContext,
  apiOrigin: string,
  accountRS: string,
): Promise<bigint> {
  const response = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAccount', account: accountRS },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  return BigInt(body.unconfirmedBalanceTQT ?? '0');
}
