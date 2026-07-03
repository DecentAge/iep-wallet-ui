import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Issue-Asset wizard (`#/wallet/assets/issue-asset`) — exercises a second
 * angular-archwizard flow alongside `send-tx.spec.ts` so the migration off
 * archwizard@3 is forced to keep working for more than the Send wizard.
 *
 * What this catches:
 *   - the `aw-wizard` / `aw-wizard-step` / `awNextStep` directive surface
 *     (separate component instances from the Send wizard's, so a regression
 *     could hit one and not the other)
 *   - template-driven validators on a different shape of form (4 required
 *     fields, two with custom `minValue="1"`)
 *   - the client-side signing pipeline for issueAsset transactions
 *     (different requestType than sendMoney; uses the same crypto path but
 *     the param-encoding is asset-specific)
 *
 * Drives the wizard through Finish + broadcast on devnet, then confirms the
 * issued asset via `getAsset`. Idempotent across reruns — the timestamped
 * unique name avoids collisions with prior asset issuances on the same chain.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('issue-asset: wizard broadcasts issueAsset and the asset appears under getAsset', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/assets/issue-asset');

  // Step 1 — the form.
  const nameInput        = page.locator('input[name="name"]');
  const descriptionInput = page.locator('textarea[name="description"]');
  const sharesInput      = page.locator('input[name="shares"]');
  const decimalsInput    = page.locator('input[name="decimals"]');
  const nextButton       = page.locator('button.btn-gradient:has-text("Next"), button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(nameInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton).toBeDisabled();   // all four fields required

  // Tag-style unique-ish name so concurrent reruns don't collide if anyone
  // does broadcast manually after the wizard reaches step 2.
  const uniqueName = `e2e${Date.now().toString(36)}`.slice(0, 10);

  await nameInput.fill(uniqueName);
  await descriptionInput.fill('e2e regression test asset — do not broadcast');
  await sharesInput.fill('100');
  await decimalsInput.fill('2');
  await decimalsInput.blur();

  await expect(
    nextButton,
    'Next button did not enable after all 4 required fields were filled — ' +
    'template-driven validators or the form #f="ngForm" wiring may be broken',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Click Next — fires `issueAsset()` (which signs client-side) and
  // advances the archwizard step. Two outcomes prove the chain worked:
  //   a) the confirm-step content (entered name etc.) becomes visible
  //   b) the Finish button becomes enabled (means validBytes === true,
  //      which only happens after the signed bytes are produced)
  await nextButton.click();

  // The confirm step shows the entered name in an <h4>. That's our marker
  // for "step 2 reached". Wait specifically for that — not just any h4 —
  // so we don't race the layout.
  await expect(
    page.locator('h4', { hasText: uniqueName }).first(),
    'after clicking Next, confirm step did not render the entered asset name — ' +
    'awNextStep or step-2 binding is broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish button — has fa-check icon, only enabled when validBytes === true.
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish (broadcast) button did not enable — client-side signing for ' +
    'issueAsset failed or didn\'t complete in time',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Toggle the "show signed transaction" button and verify the signed-bytes
  // textarea actually contains hex bytes — this is the most direct proof
  // the signing chain produced output.
  const showSignedToggle = page.locator('button.btn-raised:has(i.fa-key)').first();
  await showSignedToggle.click();
  const signedBytes = page.locator('textarea[name="key"]').first();
  await expect(signedBytes).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const bytesText = ((await signedBytes.inputValue()) ?? '').trim();
  expect(
    /^[0-9a-fA-F]+$/.test(bytesText) && bytesText.length > 100,
    `signed-transaction textarea did not contain a hex blob (got "${bytesText.slice(0, 60)}…") — ` +
    `cryptoService.signTransactionHex output may have changed`,
  ).toBe(true);

  // Click Finish → wallet POSTs broadcastTransaction → poll until confirmed.
  // The issueAsset tx id is also the asset id — getAsset is keyed by that id.
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  const assetResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAsset', asset: txId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(assetResp.ok()).toBe(true);
  const asset = await assetResp.json();
  expect(
    asset.errorCode,
    `getAsset returned an error after broadcast (tx/asset ${txId}): ${JSON.stringify(asset)}`,
  ).toBeUndefined();
  expect(asset.name, 'on-chain asset name does not match what was entered').toBe(uniqueName);
  expect(asset.decimals, 'on-chain asset decimals do not match').toBe(2);
});
