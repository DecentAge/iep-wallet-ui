import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Send Currencies wizard (`#/wallet/currencies/send-currencies`) — drives the
 * two-step transfer form and verifies the CURRENCY_TRANSFER subtype on chain.
 *
 * Setup (beforeAll):
 *   Issues a currency via direct API (TEST_ACCOUNT_1, server-side signing) and
 *   waits for confirmation so the wallet's sendCurrency() call can look it up.
 *
 * What this catches:
 *   - SendCurrenciesComponent's sendCurrency() → CurrenciesService.transferCurrency()
 *     → client-side signing path (was a skeleton before this migration)
 *   - The two required form fields (currencyId, units) + recipientRS validation
 *   - Next button advances the wizard AND fires sendCurrency() (the button had
 *     awNextStep but no (click) handler before this fix)
 *   - validBytes becomes true after signing → Finish button enables
 *   - getAccountCurrencies confirms TEST_ACCOUNT_2 received the units
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';

let issuedCurrencyId: string;
let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  const upperLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const code = Array.from({ length: 5 }, () => upperLetters[Math.floor(Math.random() * 26)]).join('');

  const params = new URLSearchParams({
    requestType: 'issueCurrency',
    name: `E2E${code}`,
    code,
    description: 'e2e send-currencies spec — do not use',
    type: '1',
    initialSupply: '1000',
    maxSupply: '1000',
    decimals: '0',
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
    throw new Error(`issueCurrency setup failed: ${JSON.stringify(created)}`);
  }
  issuedCurrencyId = created.transaction;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const txResp = await apiCtx.get(`${API_BASE}?requestType=getTransaction&transaction=${issuedCurrencyId}`);
    const tx = await txResp.json();
    if (tx.block && typeof tx.confirmations === 'number') return;
    await new Promise(r => setTimeout(r, 1_000));
  }
  throw new Error(`issueCurrency tx ${issuedCurrencyId} did not confirm within 60s`);
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('send-currencies: form mounts with three required fields, Next disabled until all filled', async ({ page }) => {
  await page.goto('#/wallet/currencies/send-currencies');

  const currencyIdInput = page.locator('input[name="currencyId"]');
  const unitsInput      = page.locator('input[name="units"]');
  const recipientInput  = page.locator('input[name="recipientRS"]');
  const nextButton      = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(currencyIdInput, 'send-currencies form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton, 'Next must be disabled while form is empty').toBeDisabled();

  await currencyIdInput.fill(issuedCurrencyId);
  await expect(nextButton, 'Next still disabled after currencyId filled').toBeDisabled();

  await unitsInput.fill('10');
  await expect(nextButton, 'Next still disabled after units filled').toBeDisabled();

  await recipientInput.fill(TEST_ACCOUNT_2_RS);
  await recipientInput.blur();
  await expect(
    nextButton,
    'Next did not enable after all three required fields filled — ' +
    'currencyId, units, or recipientRS validator may have regressed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
});

test('send-currencies: wizard transfers units to TEST_ACCOUNT_2 and getAccountCurrencies confirms receipt', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/currencies/send-currencies');

  const currencyIdInput = page.locator('input[name="currencyId"]');
  const unitsInput      = page.locator('input[name="units"]');
  const recipientInput  = page.locator('input[name="recipientRS"]');
  const nextButton      = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(currencyIdInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await currencyIdInput.fill(issuedCurrencyId);
  await unitsInput.fill('10');
  await recipientInput.fill(TEST_ACCOUNT_2_RS);
  await recipientInput.blur();
  await expect(nextButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await nextButton.click();   // calls sendCurrency() → signs CURRENCY_TRANSFER attachment

  // Step 2: Finish enables once validBytes === true (signing completed).
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish did not enable — CURRENCY_TRANSFER signing failed. ' +
    'sendCurrency() may not have been wired to the Next button (click handler missing), ' +
    'or CurrenciesService.transferCurrency() returned an error for currency ' + issuedCurrencyId,
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // type=5 (Monetary System), subtype=3 (CURRENCY_TRANSFER) in NXT/IEP.
  expect(tx.type, 'confirmed tx wrong type — expected Monetary System (5)').toBe(5);
  expect(tx.subtype, 'confirmed tx wrong subtype — expected CURRENCY_TRANSFER (3)').toBe(3);
  expect(tx.recipientRS, 'transfer recipient on chain does not match TEST_ACCOUNT_2').toBe(TEST_ACCOUNT_2_RS);

  // Verify TEST_ACCOUNT_2 now holds units of the issued currency.
  const acctCurrResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAccountCurrencies', account: TEST_ACCOUNT_2_RS, currency: issuedCurrencyId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(acctCurrResp.ok()).toBe(true);
  const acctCurr = await acctCurrResp.json();
  expect(
    acctCurr.errorCode,
    `getAccountCurrencies returned an error after transfer (tx ${txId}): ${JSON.stringify(acctCurr)}`,
  ).toBeUndefined();
  expect(
    Number(acctCurr.units ?? 0),
    `TEST_ACCOUNT_2 does not hold any units of currency ${issuedCurrencyId} after transfer`,
  ).toBeGreaterThanOrEqual(10);
});
