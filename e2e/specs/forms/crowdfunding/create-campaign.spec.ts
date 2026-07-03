import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Create Campaign wizard (`#/wallet/crowdfunding/create-campaign`).
 *
 * 3-step archwizard: step 1 (name/code/desc), step 2 (supply params), step 3
 * (confirm + broadcast). Uses the CURRENCY_ISSUANCE subtype under the hood via
 * `crowdfundingService.issueCurrency`.
 *
 * What this catches:
 *   - Step 1 Next gated on f1.invalid — disabled until name/code/desc filled
 *   - getBlockChainStatus() called on step 1 Next click populates currentHeight
 *     so the issuanceHeight input (step 2) doesn't default to NaN
 *   - createCampaign() called simultaneously with awNextStep on step 2 Next —
 *     if the nested Observable is swallowed, validBytes stays false and Finish
 *     never enables
 *   - Confirmation step shows entered name and code in <h4> elements
 *   - getCurrency API returns the campaign by code after broadcast confirms
 *
 * Migration risks:
 *   - step 2 Next has [disabled]="f2.invalid" — if minReservePerUnitTQT or
 *     reserveSupply validators regress the button never enables
 *   - issuanceHeight has [minValue]="1440" and [maxValue]="43200" — the
 *     default 1440 value must satisfy both bounds or step 2 stays invalid
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

test('create-campaign: step 1 Next disabled until required fields filled', async ({ page }) => {
  await page.goto('#/wallet/crowdfunding/create-campaign');

  const nameInput = page.locator('input[name="name"]');
  await expect(nameInput, 'create-campaign form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const nextStep1 = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await expect(
    nextStep1,
    'Step 1 Next must be disabled when form is empty (f1.invalid)',
  ).toBeDisabled();

  // Fill all three required step-1 fields — name (3-10 chars), code (3-6 upper letters), desc
  await nameInput.fill('TestCamp');
  await page.locator('input[name="code"]').fill('TCFXX');
  await page.locator('textarea[name="desc"]').fill('E2E test campaign description');

  await expect(
    nextStep1,
    'Step 1 Next must enable after name, code, and description are filled',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
});

test('create-campaign: full wizard flow broadcasts and getCurrency returns campaign on chain', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/crowdfunding/create-campaign');

  // Generate a unique code/name to avoid duplicate-code rejection across reruns
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const suffix = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * 26)]).join('');
  const code = 'CF' + suffix;   // 6 uppercase letters, within the 3-6 limit
  const name = 'Camp' + suffix; // 8 letters, within the 3-10 limit

  // Step 1: name, code, description
  const nameInput = page.locator('input[name="name"]');
  await expect(nameInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await nameInput.fill(name);
  await page.locator('input[name="code"]').fill(code);
  await page.locator('textarea[name="desc"]').fill('Automated test campaign description');

  // Next also calls getBlockChainStatus() — populates currentHeight so step 2's
  // issuanceHeight input doesn't become NaN
  const nextStep1 = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await expect(nextStep1).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await nextStep1.click();

  // Wait for step 2 to become interactive
  const reserveSupplyInput = page.locator('input[name="reserveSupply"]');
  await expect(reserveSupplyInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Step 2: supply parameters — issuanceHeight defaults to 1440 (min allowed), leave as-is
  await page.locator('input[name="initialSupply"]').fill('0');
  await reserveSupplyInput.fill('100');
  await page.locator('input[name="minReservePerUnitTQT"]').fill('1');

  // Step 2 Next simultaneously calls createCampaign() and transitions to step 3.
  // nth(1) because both step 1 and step 2 Next buttons are always in the DOM.
  const nextStep2 = page.locator('button.btn-gradient:has(i.fa-chevron-right)').nth(1);
  await expect(
    nextStep2,
    'Step 2 Next did not enable — one of reserveSupply/minReservePerUnitTQT/issuanceHeight validators failed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await nextStep2.click();

  // Step 3 (confirmation) — name and code must appear in <h4> elements
  await expect(
    page.locator('h4', { hasText: name }).first(),
    `Campaign name "${name}" not shown on confirmation step — archwizard transition broken`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('h4', { hasText: code }).first(),
    `Campaign code "${code}" not shown on confirmation step — ngModel binding on campaignForm.code broken`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish enables once createCampaign() resolved and bytes were signed locally (validBytes = true)
  const finishButton = page.locator('button:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish did not enable — createCampaign() signing failed (nested Observable swallowed?)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Toggle signed-transaction display and verify hex was produced
  await page.locator('button:has(i.fa-key)').first().click();
  const signedBytes = page.locator('textarea[name="key"]').first();
  await expect(signedBytes).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const bytesText = ((await signedBytes.inputValue()) ?? '').trim();
  expect(
    /^[0-9a-fA-F]+$/.test(bytesText) && bytesText.length > 100,
    `signed-transaction textarea did not contain a hex blob (got "${bytesText.slice(0, 60)}…") — ` +
    `signTransactionHex output may have changed for CURRENCY_ISSUANCE subtype`,
  ).toBe(true);

  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // Verify the campaign exists on chain by code
  const currencyResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getCurrency', code },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(currencyResp.ok()).toBe(true);
  const currency = await currencyResp.json();
  expect(
    currency.errorCode,
    `getCurrency returned an error for code "${code}" (tx ${txId}): ${JSON.stringify(currency)}`,
  ).toBeUndefined();
  expect(
    currency.code,
    'getCurrency response code does not match submitted code',
  ).toBe(code);
  expect(
    currency.name,
    'getCurrency response name does not match submitted name',
  ).toBe(name);
});
