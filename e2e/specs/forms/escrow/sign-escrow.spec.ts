import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';
import { createTestEscrow } from '../../../helpers/create-escrow';

/**
 * Sign Escrow wizard (`#/wallet/escrow/my-escrow/sign-escrow`).
 *
 * beforeAll creates a fresh escrow from TEST_ACCOUNT_1 with TEST_ACCOUNT_2 as
 * the sole signer. The test logs in as TEST_ACCOUNT_2, navigates to the sign
 * form, selects "release", and broadcasts. The chain state is verified via the
 * confirmed sign-escrow transaction's attachment — the escrow itself is
 * auto-released (removed from chain) once the single required signer votes
 * "release", so getEscrowTransaction would return errorCode 5 afterwards.
 *
 * Migration risks:
 *   - sign-escrow's decision <select> is bound purely via ngModel with no
 *     (change) handler — a two-way binding regression leaves escrow.decision
 *     empty and [disabled]="!escrow.decision" keeps Next permanently disabled
 *   - escrowSign() has a nested Observable (_success.subscribe(result => ...))
 *     — if the inner Observable is swallowed (zone, async pipe, or migration
 *     artifact), validBytes never becomes true and Finish never enables
 *   - a SweetAlert info dialog appears when getAccountDetails(escrowId) returns
 *     errorCode 5 (a tx ID is not an account ID) — the test must dismiss it
 *     before the Finish button is reachable
 */

let escrowId: string;

test.beforeAll(async ({ browser, baseURL }) => {
  escrowId = await createTestEscrow(browser, baseURL);
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_2_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

test('sign-escrow: decision select → Next → broadcast → signer decision recorded on chain', async ({ page, request, baseURL }) => {
  await page.goto(`#/wallet/escrow/my-escrow/sign-escrow?id=${escrowId}`);

  // Step 1: escrow ID rendered as static text, decision select required
  await expect(
    page.locator('h6', { hasText: escrowId }),
    'Escrow ID not shown on sign-escrow step 1 — ?id query param not read by component',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const decisionSelect = page.locator('select[name="type"]');
  await expect(decisionSelect).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const nextButton = page.locator('button:has(i.fa-chevron-right)').first();
  await expect(
    nextButton,
    'Next must be disabled before a decision is selected ([disabled]="!escrow.decision")',
  ).toBeDisabled();

  await decisionSelect.selectOption({ value: 'release' });

  await expect(
    nextButton,
    'Next must enable after selecting a decision',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Click Next: calls escrowSign() (async) AND transitions to step 2 immediately
  // via awNextStep. An info SweetAlert appears because getAccountDetails(escrowId)
  // returns errorCode 5 for a transaction ID (not an account ID). The API call
  // is async so the swal may arrive well after the click — wait up to
  // DEFAULT_TIMEOUT_MS and then dismiss it to unblock the Finish button click.
  await nextButton.click();

  const swalOk = page.locator('.swal2-confirm');
  if (await swalOk.isVisible({ timeout: DEFAULT_TIMEOUT_MS }).catch(() => false)) {
    await swalOk.click();
    await expect(swalOk).not.toBeVisible({ timeout: 5_000 });
  }

  // Step 2: escrow ID and chosen decision must be shown
  await expect(
    page.locator('h4', { hasText: escrowId }).first(),
    'Escrow ID not shown on sign-escrow confirmation step — archwizard transition broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('h4', { hasText: 'release' }).first(),
    'Chosen decision "release" not shown on confirmation step — ngModel binding on decision select broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish button enables once escrowSign() returned unsigned bytes that were
  // signed locally (validBytes = true)
  const finishButton = page.locator('button:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish did not enable — escrowSign() signing failed (nested Observable swallowed?)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Dismiss any swal that arrived after the extended dismiss window above
  // (e.g. a second async response arriving later than DEFAULT_TIMEOUT_MS).
  const swalGuard = page.locator('.swal2-confirm');
  if (await swalGuard.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await swalGuard.click();
    await expect(swalGuard).not.toBeVisible({ timeout: 5_000 });
  }

  // Toggle the signed-transaction display and verify hex bytes were produced
  await page.locator('button:has(i.fa-key)').first().click();
  const signedBytes = page.locator('textarea[name="key"]').first();
  await expect(signedBytes).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const bytesText = ((await signedBytes.inputValue()) ?? '').trim();
  expect(
    /^[0-9a-fA-F]+$/.test(bytesText) && bytesText.length > 100,
    `signed-transaction textarea did not contain a hex blob (got "${bytesText.slice(0, 60)}…") — ` +
    `signTransactionHex output may have changed for ESCROW_SIGN subtype`,
  ).toBe(true);

  // Broadcast and wait for on-chain confirmation.
  // The escrow is auto-released once the single required signer votes "release",
  // so getEscrowTransaction returns "not found" afterwards (the record is gone).
  // Instead we verify the decision directly from the confirmed sign-escrow tx.
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { tx: signTx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  expect(
    signTx.senderRS ?? signTx.sender,
    `Sign-escrow tx sender should be TEST_ACCOUNT_2 (${TEST_ACCOUNT_2_RS})`,
  ).toBe(TEST_ACCOUNT_2_RS);
  expect(
    signTx.attachment?.decision,
    `Sign-escrow tx attachment.decision should be "release" — ` +
    `escrowSign broadcast may have been dropped or attachment shape changed: ${JSON.stringify(signTx)}`,
  ).toBe('release');
});
