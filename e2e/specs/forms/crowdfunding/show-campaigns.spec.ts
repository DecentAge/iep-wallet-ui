import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { createTestCampaign } from '../../../helpers/create-campaign';

/**
 * Show Campaigns page (`#/wallet/crowdfunding/show-campaigns`).
 *
 * beforeAll creates a fresh campaign via the wizard UI so there is guaranteed
 * data in both the All and My tabs. Tests verify page structure, translated
 * column headers, and that the created campaign's code appears in the datatable.
 *
 * What this catches:
 *   - ShowCampaignsComponent tab strip (All / My routerLinks) and title render
 *   - CampaignsComponent datatable mounts and column headers are translated
 *     (not bare i18n keys — regression from a failed TranslateModule import)
 *   - getAllCampaigns response mapped to `rows` — a shape change (currencies →
 *     something else) yields an empty datatable
 *   - "MY Campaigns" heading visible when campaignType==='MY'
 *   - getAccountCurrencies scope — My tab only shows campaigns issued by
 *     TEST_ACCOUNT_1, so the code created in beforeAll must appear there too
 *     (the issuer always holds the initial supply even when initialSupply=0)
 *
 * Migration risks:
 *   - CampaignsComponent.setPage() maps `response.currencies` — any API key
 *     rename silently produces an empty table
 *   - campaignType route data (`data.campaignType === 'MY'`) — a missing `data`
 *     in the child route definition makes the heading conditional never true
 */

let campaignCode: string;

test.beforeAll(async ({ browser, baseURL }) => {
  const info = await createTestCampaign(browser, baseURL);
  campaignCode = info.code;
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

test('show-campaigns: title and All/My tab strip render', async ({ page }) => {
  await page.goto('#/wallet/crowdfunding/show-campaigns/all');

  await expect(
    page.locator('h2.main-title'),
    'Show Campaigns page title did not render',
  ).toContainText('Show Campaigns', { timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.locator('a.nav-link', { hasText: /^All$/i }).first(),
    '"All" nav-link not visible — ShowCampaignsComponent or lazy-load broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.locator('a.nav-link', { hasText: /My/i }).first(),
    '"My" nav-link not visible',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('show-campaigns: All tab datatable mounts with translated column headers', async ({ page }) => {
  await page.goto('#/wallet/crowdfunding/show-campaigns/all');

  const datatable = page.locator('ngx-datatable').first();
  await expect(
    datatable,
    'ngx-datatable did not mount on show-campaigns/all',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The first header must be a translated string, not a raw i18n key like "table-header.ticker"
  const firstHeader = page.locator('ngx-datatable .datatable-header-cell-label').first();
  await expect(firstHeader).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const headerText = ((await firstHeader.textContent()) ?? '').trim();
  expect(
    /^table-header\./.test(headerText),
    `First column header looks like an untranslated i18n key ("${headerText}") — ` +
    `TranslateModule may have failed to load in the crowdfunding module`,
  ).toBe(false);

  // All eight expected columns must be present
  for (const col of ['Ticker', 'Blocks', 'Days', 'Supply', 'Status', 'Raised', 'Goal', 'Actions']) {
    await expect(
      page.getByText(col, { exact: true }).first(),
      `Column header "${col}" not found in show-campaigns/all datatable`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }
});

test('show-campaigns: All tab shows created campaign by code', async ({ page }) => {
  await page.goto('#/wallet/crowdfunding/show-campaigns/all');

  const codeCell = page.locator('ngx-datatable .datatable-body-cell', { hasText: campaignCode }).first();
  await expect(
    codeCell,
    `Campaign code "${campaignCode}" not found in All tab datatable — ` +
    `getAllCampaigns may not be returning the new campaign, or response.currencies key renamed`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('show-campaigns: My tab shows MY CAMPAIGNS heading and created campaign', async ({ page }) => {
  await page.goto('#/wallet/crowdfunding/show-campaigns/my');

  // CampaignsComponent renders "MY Campaigns" when campaignType==='MY'
  await expect(
    page.locator('h3.card-title', { hasText: /MY/i }).first(),
    '"MY Campaigns" heading not visible on the My tab — campaignType route data may not be wired',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // TEST_ACCOUNT_1 issued this campaign so it must appear in the My tab
  const codeCell = page.locator('ngx-datatable .datatable-body-cell', { hasText: campaignCode }).first();
  await expect(
    codeCell,
    `Campaign "${campaignCode}" not found in My tab — ` +
    `getAllCampaigns accountId filter may not be passed, or accountId vs accountRs mismatch`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
