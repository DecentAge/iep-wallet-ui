import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Create Alias wizard (`#/wallet/aliases/create-alias`) — registers an
 * alias-name → URI mapping on chain. Exercises the ALIAS_ASSIGNMENT
 * subtype (`requestType=setAlias`), which no other test in the suite
 * touches.
 *
 * Migration risks this catches:
 *   - 2-step archwizard with a `<select>`-driven prefix dropdown (the
 *     prefix changes the URI placeholder via `(change)="changePlaceholder"`)
 *   - the ALIAS_ASSIGNMENT subtype attachment encoding inside signTransactionHex
 *   - chain-side alias-name uniqueness validation (returned at the
 *     unsigned-bytes step if the name is already taken)
 *
 * Drives the wizard through Finish + broadcast on devnet, then confirms via
 * `getAlias` that the mapping is persisted on chain. Idempotent across
 * reruns by virtue of the timestamped alias name (uniqueness rule).
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('create-alias: 2-step wizard broadcasts setAlias and is queryable via getAlias', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/aliases/create-alias');

  const aliasName    = page.locator('input[name="name"]');
  const prefixSelect = page.locator('select[name="type"]');
  const aliasURI     = page.locator('input[name="aliaseURI"]');     // [sic] field is named "aliaseURI" in the wallet
  const step1Next    = page.locator('button.btn-gradient:has(i.icon-next_arrow), button.btn-gradient:has-text("Next")').first();

  await expect(aliasName, 'create-alias form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(step1Next).toBeDisabled();

  // Unique alias name per run so re-runs against the same chain don't
  // collide on the chain-side uniqueness check.
  // Chain rule (errorCode 4 if violated): alias names must contain ONLY
  // digits and Latin letters — no hyphens, no underscores.
  const uniqueAlias = `e2ealias${Date.now().toString(36)}`;

  await aliasName.fill(uniqueAlias);
  // Default prefix is fine (Account); leave the dropdown alone to also
  // exercise its initial value rather than overriding it.
  await aliasURI.fill('XIN-WDYP-H647-KPNR-BWWRK');     // a syntactically-valid URI (the test account itself)
  await aliasURI.blur();
  await expect(step1Next).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await step1Next.click();   // calls setAlias() → signs ALIAS_ASSIGNMENT attachment

  // Step 2 confirm renders the entered alias name in <h4>.
  await expect(
    page.locator('h4', { hasText: uniqueAlias }).first(),
    'step-2 confirm did not render the entered alias name — archwizard transition or binding broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish button only enables when validBytes becomes true (setAlias's
  // backend call returned unsigned bytes that signed locally).
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — ALIAS_ASSIGNMENT signing failed (chain rejection?)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Click Finish → wallet POSTs broadcastTransaction → chain returns tx id;
  // poll getTransaction until the tx lands in a block.
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);
  expect(tx.sender, 'broadcast tx sender mismatch — wallet signed under a different account').toBe('11015695257149779925');

  // Verify the alias is queryable on chain by name.
  const aliasResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAlias', aliasName: uniqueAlias },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(aliasResp.ok()).toBe(true);
  const alias = await aliasResp.json();
  expect(
    alias.errorCode,
    `getAlias returned an error after broadcast confirmation (tx ${txId}): ${JSON.stringify(alias)}`,
  ).toBeUndefined();
  expect(alias.aliasName, 'getAlias returned a different alias name').toBe(uniqueAlias);
  expect(alias.accountRS, 'alias registered to the wrong account').toBe(TEST_ACCOUNT_1_RS);
});
