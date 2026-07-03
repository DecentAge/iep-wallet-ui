import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Show Currencies page (`#/wallet/currencies/show-currencies`) — parent
 * component with All / My tab strip, each tab backed by CurrenciesComponent
 * (ngx-datatable + getAllCurrencies / getAccountCurrencies).
 *
 * Setup (beforeAll):
 *   Issues a currency via direct API (server-side signing) with a random
 *   uppercase code to avoid collisions across reruns. Waits for the
 *   issueCurrency tx to confirm so the currency appears in getAllCurrencies.
 *
 * What this catches:
 *   - Tab strip renders and both routerLinks resolve
 *   - CurrenciesComponent datatable mounts and column headers are translated
 *     (not bare i18n keys like "table-header.ticker")
 *   - getAllCurrencies → "All" tab shows the issued currency by code
 *   - getAccountCurrencies → "My" tab shows the same currency under
 *     TEST_ACCOUNT_1's holdings (issuer always holds the initial supply)
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';

let issuedCurrencyCode: string;
let issuedCurrencyId: string;
let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  const upperLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  issuedCurrencyCode = Array.from({ length: 5 }, () =>
    upperLetters[Math.floor(Math.random() * 26)],
  ).join('');
  const currencyName = `E2E${issuedCurrencyCode}`;

  const params = new URLSearchParams({
    requestType: 'issueCurrency',
    name: currencyName,
    code: issuedCurrencyCode,
    description: 'e2e show-currencies spec — do not use',
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

test('show-currencies: tab strip renders with All and My links', async ({ page }) => {
  await page.goto('#/wallet/currencies/show-currencies/all');

  const allTab = page.locator('a.nav-link', { hasText: /^All$/i }).first();
  const myTab  = page.locator('a.nav-link', { hasText: /^My$/i }).first();

  await expect(
    allTab,
    '"All" nav-link not visible — ShowCurrenciesComponent or lazy-load broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(myTab).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('show-currencies: All tab datatable mounts with translated column headers', async ({ page }) => {
  await page.goto('#/wallet/currencies/show-currencies/all');

  const datatable = page.locator('ngx-datatable').first();
  await expect(
    datatable,
    'ngx-datatable did not mount on show-currencies/all',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const firstHeader = page.locator('ngx-datatable .datatable-header-cell-label').first();
  await expect(firstHeader).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const headerText = ((await firstHeader.textContent()) ?? '').trim();
  expect(
    /^table-header\./.test(headerText),
    `first column header looks like an untranslated i18n key ("${headerText}") — ` +
    `@ngx-translate bundle may have failed to load in the currencies module`,
  ).toBe(false);
});

test('show-currencies: All tab shows issued currency by code', async ({ page }) => {
  await page.goto('#/wallet/currencies/show-currencies/all');

  // The Ticker column renders the code as a hyperlink inside a datatable cell.
  const codeCell = page.locator('ngx-datatable .datatable-body-cell', { hasText: issuedCurrencyCode }).first();
  await expect(
    codeCell,
    `Currency code "${issuedCurrencyCode}" (tx ${issuedCurrencyId}) not found in the All tab datatable. ` +
    `CurrenciesComponent may not be calling getAllCurrencies, or the datatable pagination skips page 0.`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('show-currencies: My tab shows the issued currency under TEST_ACCOUNT_1 holdings', async ({ page }) => {
  await page.goto('#/wallet/currencies/show-currencies/my');

  const datatable = page.locator('ngx-datatable').first();
  await expect(datatable, 'ngx-datatable did not mount on show-currencies/my').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The issuer always holds the full initial supply. The My tab queries
  // getAccountCurrencies — if accountId vs accountRS wiring regresses the
  // call returns empty and the row won't appear.
  const codeCell = page.locator('ngx-datatable .datatable-body-cell', { hasText: issuedCurrencyCode }).first();
  await expect(
    codeCell,
    `Currency "${issuedCurrencyCode}" not found in My tab — ` +
    `getAccountCurrencies may be called with the wrong account identifier, ` +
    `or the currency was not credited to the issuer (TEST_ACCOUNT_1).`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
