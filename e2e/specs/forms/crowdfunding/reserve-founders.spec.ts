import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { createTestCampaign } from '../../../helpers/create-campaign';

/**
 * Reserve Founders page (`#/wallet/crowdfunding/show-campaigns/reserve-founders`).
 *
 * The ?id query param carries the internal currency ID (the issueCurrency tx ID
 * — same value that the campaigns datatable stores in `row.currency` and passes
 * to `openFoundersCampaign()`). Not the human-readable ticker code.
 *
 * beforeAll creates a campaign via the wizard UI so the page can be reached
 * with a valid ?id. For a freshly-created campaign with no reservations the
 * datatable is empty, but the page title and columns must still render.
 *
 * What this catches:
 *   - Title "Founders List" renders (h2.main-title)
 *   - ngx-datatable mounts with translated column headers (Details, Account,
 *     Amount per Unit) — a TranslateModule regression shows raw i18n keys
 *   - ?id query param wired: `params.id` → `this.code` → getCampaignFounders()
 *   - Missing ?id calls _location.back() — Angular router leaves the page
 *
 * Migration risks:
 *   - ReserveFoundersComponent reads `params.id` via queryParams subscription —
 *     a missed unsubscribe or `takeUntil` regression re-triggers with stale data
 *   - getCampaignFounders passes `currency` param (the internal ID) to the API;
 *     passing the code instead silently returns empty or an error response
 *   - response.founders key — if the API renames this the table stays empty
 */

let currencyId: string; // internal chain ID = issueCurrency tx ID

test.beforeAll(async ({ browser, baseURL }) => {
  const info = await createTestCampaign(browser, baseURL);
  // In IEP the currency ID equals the transaction ID of the issuance tx.
  // The campaigns datatable stores this in `row.currency` and passes it as ?id.
  currencyId = info.txId;
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

test('reserve-founders: title and column headers render with valid ?id', async ({ page }) => {
  await page.goto(`#/wallet/crowdfunding/show-campaigns/reserve-founders?id=${currencyId}`);

  await expect(
    page.locator('h2.main-title'),
    'Founders List page title did not render — route may not have resolved',
  ).toContainText('Founders List', { timeout: DEFAULT_TIMEOUT_MS });

  const datatable = page.locator('ngx-datatable').first();
  await expect(
    datatable,
    'ngx-datatable did not mount on reserve-founders — component may have navigated back without finding the id param',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Column headers must be translated strings, not raw i18n keys
  const firstHeader = page.locator('ngx-datatable .datatable-header-cell-label').first();
  await expect(firstHeader).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const headerText = ((await firstHeader.textContent()) ?? '').trim();
  expect(
    /^table-header\./.test(headerText),
    `First column header looks like an untranslated i18n key ("${headerText}") — TranslateModule not loaded`,
  ).toBe(false);

  // Three expected columns from the template (exact translated strings from en.json)
  for (const col of ['Details', 'Account', 'Amount per Unit']) {
    await expect(
      page.getByText(col, { exact: true }).first(),
      `Column header "${col}" not found in reserve-founders datatable`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }
});

test('reserve-founders: missing ?id navigates away from the founders page', async ({ page }) => {
  // Establish history by visiting show-campaigns/all before navigating to the
  // founders page — this gives _location.back() somewhere to go.
  await page.goto('#/wallet/crowdfunding/show-campaigns/all');
  await expect(page.locator('h2.main-title')).toContainText('Show Campaigns', { timeout: DEFAULT_TIMEOUT_MS });

  // Navigate to reserve-founders without the required ?id param.
  // The component's ngOnInit checks `!params.id` and calls _location.back().
  await page.goto('#/wallet/crowdfunding/show-campaigns/reserve-founders');

  // Wait for the router to navigate away (back to the previous page).
  // The hash URL must no longer contain "reserve-founders" once _location.back() fires.
  await page.waitForURL(
    url => !url.toString().includes('reserve-founders'),
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  // As a belt-and-suspenders check: the Founders List title must not be visible.
  await expect(
    page.locator('h2.main-title', { hasText: 'Founders List' }),
    'Founders List title is still visible after missing-id redirect — _location.back() was not called',
  ).not.toBeVisible();
});
