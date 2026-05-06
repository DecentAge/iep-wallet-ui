import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Issue Currency wizard (`#/wallet/currencies/issue-currency`) — exercises
 * the Monetary System currency-issuance flow, a third archwizard form
 * alongside Send/Issue-Asset. Currency issuance has its own subtype +
 * attachment encoding (different from issueAsset), so a regression here
 * could be invisible to the existing wizard tests.
 *
 * What this catches:
 *   - 3-step archwizard navigation (details → options → confirm)
 *     with TWO separate `#fN="ngForm"` validation contexts, not one
 *   - template-driven validators specific to currencies: name length 3-10,
 *     code length 3-6, decimals minValue=0/maxValue=4, initialSupply minValue=1
 *   - the auto-derived `maxSupply` field (kept in sync with initialSupply
 *     via `onInitialSupplyChange()`) — a quiet regression target if Angular
 *     change-detection semantics shift after the migration
 *   - client-side signing for the CURRENCY_ISSUANCE subtype
 *
 * Drives the wizard through Finish + broadcast on devnet, then confirms via
 * `getCurrency` that the issued currency is queryable. Idempotent across
 * reruns by virtue of the random uppercase code (chain rule: code must be
 * 3-6 uppercase letters and unique).
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('issue-currency: 3-step wizard broadcasts issueCurrency and getCurrency returns the issued currency', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/currencies/issue-currency');

  // Step 1 — name + code + description.
  const nameInput        = page.locator('input[name="name"]');
  const codeInput        = page.locator('input[name="code"]');
  const descriptionInput = page.locator('textarea[name="description"]');
  const step1Next        = page.locator('button.btn-gradient:has-text("Next"), button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(nameInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(step1Next, 'step-1 Next must be disabled while form is empty').toBeDisabled();

  // Chain rules (chain-side validation, errorCode 4 if violated):
  //   - `name` must contain only digits and Latin letters (3-10 chars)
  //   - `code` must contain only UPPERCASE Latin letters, NO digits (3-6 chars)
  // We pick 5 uppercase letters at random for the code (gives ~12M combos —
  // collision-resistant for practical e2e re-runs against a single devnet).
  const upperLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const uniqueCode = Array.from({ length: 5 }, () => upperLetters[Math.floor(Math.random() * 26)]).join('');
  const uniqueName = `E2E${uniqueCode}`;     // letters only — also satisfies name rules

  await nameInput.fill(uniqueName);
  await codeInput.fill(uniqueCode);
  await descriptionInput.fill('e2e regression test currency — do not broadcast');
  await descriptionInput.blur();
  await expect(step1Next, 'step-1 Next did not enable after all 3 required fields filled').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await step1Next.click();

  // Step 2 — currency type checkboxes (default: none required), decimals,
  // initialSupply. `decimals` and `initialSupply` are the validation-bearing
  // inputs. `maxSupply` is auto-populated from `initialSupply`.
  const decimalsInput      = page.locator('input[name="decimals"]');
  const initialSupplyInput = page.locator('input[name="initialSupply"]');
  const maxSupplyInput     = page.locator('input[name="maxSupply"]');
  const step2Next          = page.locator('button.btn-gradient:has(i.fa-chevron-right)').last();

  await expect(decimalsInput, 'step-2 did not render — archwizard navigation broken').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Tick the first currency-type checkbox ("Exchangeable", flag=1).
  // The wallet sends `type=sum(checked flags)` to the chain — leaving all
  // checkboxes unticked produces type=0, which iep-node rejects (so signing
  // never produces validBytes and the Finish button stays disabled).
  // "Exchangeable" is the simplest — doesn't reveal the reservable section.
  //
  // Bootstrap's `custom-control-inline` pattern leaves the actual <input>
  // at offsetWidth/Height = 0, so Playwright's `.check()` / `.click()`
  // fail actionability checks. Calling the native `HTMLInputElement.click()`
  // via evaluate toggles `checked` AND dispatches the synthetic `change`
  // event, which is what `[(ngModel)]` listens to — exactly what a real
  // user click via the wrapping label produces.
  await page.locator('#option-0').evaluate((el: HTMLInputElement) => el.click());
  await expect(
    page.locator('#option-0'),
    'Exchangeable checkbox did not toggle — change event handling for Bootstrap custom-control inputs may have changed',
  ).toBeChecked();

  await decimalsInput.fill('2');
  await initialSupplyInput.fill('100');
  await initialSupplyInput.blur();

  // The maxSupply input has [attr.disabled]=true and is updated programmatically
  // via onInitialSupplyChange(). Verify it tracked the entered initialSupply.
  await expect(
    maxSupplyInput,
    'maxSupply did not auto-populate from initialSupply — onInitialSupplyChange() ' +
    'binding may have broken after migration',
  ).toHaveValue(/100/, { timeout: DEFAULT_TIMEOUT_MS });

  await expect(step2Next).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await step2Next.click();    // signs the CURRENCY_ISSUANCE attachment

  // Step 3 — confirm step shows entered name + ticker + supplies. Use the
  // entered name as the marker that step 3 rendered.
  await expect(
    page.locator('h4', { hasText: uniqueCode }).first(),
    'after step-2 Next, confirm step did not render — archwizard or signing broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish button — only disabled while validBytes is false. Becoming
  // enabled is the proof signing succeeded.
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — CURRENCY_ISSUANCE signing failed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Toggle "show signed transaction" → verify hex blob is present.
  await page.locator('button.btn-raised:has(i.fa-key)').first().click();
  const signedBytes = page.locator('textarea[name="key"]').first();
  await expect(signedBytes).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const bytesText = ((await signedBytes.inputValue()) ?? '').trim();
  expect(
    /^[0-9a-fA-F]+$/.test(bytesText) && bytesText.length > 100,
    `signed-transaction textarea did not contain a hex blob (got "${bytesText.slice(0, 60)}…")`,
  ).toBe(true);

  // Click Finish → wallet POSTs broadcastTransaction → poll until confirmed.
  // The issueCurrency tx id doubles as the currency id (currencyId == txId).
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  const currencyResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getCurrency', currency: txId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(currencyResp.ok()).toBe(true);
  const currency = await currencyResp.json();
  expect(
    currency.errorCode,
    `getCurrency returned an error after broadcast (tx/currency ${txId}): ${JSON.stringify(currency)}`,
  ).toBeUndefined();
  expect(currency.code, 'on-chain currency code does not match').toBe(uniqueCode);
  expect(currency.name, 'on-chain currency name does not match').toBe(uniqueName);
  expect(currency.decimals, 'on-chain currency decimals do not match').toBe(2);
});
