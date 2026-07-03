import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  CASH_ACCOUNT_RS,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Create Escrow wizard (`#/wallet/escrow/create-escrow`) — locks XIN under a
 * signers/deadline contract that releases on the deadline action (Refund /
 * Release / Split). Exercises the ESCROW_CREATION subtype, which no other
 * test in the suite touches.
 *
 * Migration risks this catches:
 *   - 2-step archwizard with FIVE required template-driven validators on the
 *     same form (recipientRS, amount, escrowDeadline, type, requiredSigners,
 *     signers) — more validators than any other form in the suite, so a
 *     `[disabled]="f.invalid"` regression hits here first.
 *   - the `<select name="type">` deadline-action dropdown bound via ngModel
 *     (different from create-poll's voting-model select since it has no
 *     `(change)` handler — purely two-way bound)
 *   - the ESCROW_CREATION subtype attachment encoding inside signTransactionHex
 *
 * Drives the wizard through Finish + broadcast on devnet, then confirms via
 * `getEscrowTransaction` that the escrow contract was created on chain. Each
 * rerun leaves a fresh escrow tx (no uniqueness constraint), but the test
 * verifies its own broadcast and is otherwise idempotent. Refund-on-deadline
 * means devnet automatically returns the locked funds — no cleanup needed.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('create-escrow: 2-step wizard broadcasts createEscrow and getEscrowTransaction returns it', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/escrow/create-escrow');

  const recipientInput      = page.locator('input[name="recipientRS"]');
  const amountInput         = page.locator('input[name="amount"]');
  const deadlineInput       = page.locator('input[name="escrowDeadline"]');
  const decisionSelect      = page.locator('select[name="type"]');
  const requiredSignersInput = page.locator('input[name="requiredSigners"]');
  const signersTextarea     = page.locator('textarea[name="signers"]');
  const nextButton          = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(recipientInput, 'create-escrow form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton, 'Next must be disabled while form is empty').toBeDisabled();

  await recipientInput.fill(CASH_ACCOUNT_RS);
  await amountInput.fill('1');
  await deadlineInput.fill('10');
  // Decision Model defaults to "Select" (empty value); the form is invalid
  // until a real option is chosen. "Refund" returns funds to the sender on
  // deadline, the safest choice for a test-only escrow.
  await decisionSelect.selectOption({ label: 'Refund' });
  await requiredSignersInput.fill('1');
  // TEST_ACCOUNT_2 is a funded non-genesis account created by docker_init_devnet.sh —
  // stable across reruns and semantically correct as an independent signer.
  // Using the test account itself would allow self-approval, defeating the signers' purpose.
  await signersTextarea.fill(TEST_ACCOUNT_2_RS);
  await signersTextarea.blur();

  await expect(
    nextButton,
    'Next button did not enable after all 6 required fields were filled — ' +
    'one of the template-driven validators (required / minValue=1 / select-default) regressed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await nextButton.click();   // calls createEscrow() → signs ESCROW_CREATION attachment

  // Step 2 confirm view — the recipient is rendered in <h4>.
  await expect(
    page.locator('h4', { hasText: CASH_ACCOUNT_RS }).first(),
    'step-2 confirm did not render the entered recipient — archwizard transition broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish button only enables when validBytes becomes true (createEscrow's
  // backend call returned unsigned bytes that signed locally).
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — ESCROW_CREATION signing failed (chain rejection?)',
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
  // The createEscrow tx id is also the escrow id (queryable via getEscrowTransaction).
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  const escrowResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getEscrowTransaction', escrow: txId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(escrowResp.ok()).toBe(true);
  const escrow = await escrowResp.json();
  expect(
    escrow.errorCode,
    `getEscrowTransaction returned an error after broadcast (tx ${txId}): ${JSON.stringify(escrow)}`,
  ).toBeUndefined();
  expect(escrow.recipientRS, 'escrow recipient on chain does not match').toBe(CASH_ACCOUNT_RS);
  expect(escrow.requiredSigners ?? escrow.requireSigners, 'requiredSigners on chain does not match').toBe(1);
});
