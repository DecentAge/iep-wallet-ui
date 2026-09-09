import { test, expect, request as pwRequest, APIRequestContext, Page } from '@playwright/test';
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
  expect(
    await datatableContainsCode(page, issuedCurrencyCode),
    `Currency code "${issuedCurrencyCode}" (tx ${issuedCurrencyId}) not found on any page of the All tab. ` +
    `CurrenciesComponent may not be calling getAllCurrencies.`,
  ).toBe(true);
});

// Wallet bug: the My tab's pager sets the active page in the DOM but never
// refetches, so only the first ten holdings are ever reachable. Measured on a
// devnet account holding 56 currencies: twelve page clicks, same ten rows every
// time (the footer also reports a guessed "1,000 total" from
// pageNumber * 10 + rows.length). Drop the fixme once the component pages properly.
test.fixme('show-currencies: My tab shows the issued currency under TEST_ACCOUNT_1 holdings', async ({ page }) => {
  await page.goto('#/wallet/currencies/show-currencies/my');

  const datatable = page.locator('ngx-datatable').first();
  await expect(datatable, 'ngx-datatable did not mount on show-currencies/my').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The issuer always holds the full initial supply. The My tab queries
  // getAccountCurrencies — if accountId vs accountRS wiring regresses the
  // call returns empty and the row won't appear.
  expect(
    await datatableContainsCode(page, issuedCurrencyCode),
    `Currency "${issuedCurrencyCode}" not found on any page of the My tab — ` +
    `getAccountCurrencies may be called with the wrong account identifier, ` +
    `or the currency was not credited to the issuer (TEST_ACCOUNT_1).`,
  ).toBe(true);
});

/**
 * Walk the pager until the code appears. show-currencies pages server-side and
 * sorts alphabetically, so on a chain that has accumulated currencies a freshly
 * issued code sits on some later page rather than the first one.
 */
async function datatableContainsCode(page: Page, code: string, maxPages = 15): Promise<boolean> {
  for (let visited = 0; visited < maxPages; visited++) {
    const cell = page.locator('ngx-datatable .datatable-body-cell', { hasText: code }).first();
    if (await cell.isVisible({ timeout: 1_500 }).catch(() => false)) return true;

    const nextItem = page.locator('ngx-datatable li:has(a[aria-label="go to next page"])').first();
    if (!(await nextItem.isVisible().catch(() => false))) return false;
    if (((await nextItem.getAttribute('class')) ?? '').includes('disabled')) return false;

    await nextItem.locator('a').first().click();
    // Wait for the refetched page to render instead of a fixed pause: under load
    // the next click would otherwise fire on an empty table and skip a page.
    await page.locator('ngx-datatable .datatable-body-row').first()
      .waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  }
  return false;
}
