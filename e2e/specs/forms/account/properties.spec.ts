import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  CASH_ACCOUNT_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Account Properties (`#/wallet/account/properties/...`).
 *
 * The wallet's `properties` module reuses one component (`SetPropertyComponent`)
 * across three routes via route data.propertyType (SET / MY / ALL). Each
 * route renders a different shape:
 *   - SET  → wizard form to set a property on a recipient account
 *   - MY   → ngx-datatable of properties this account has set on others
 *   - ALL  → ngx-datatable of properties others have set on this account
 *
 * Migration risks this catches:
 *   - the `data: { propertyType: ... }` route-data lookup pattern (different
 *     from the more common queryParams approach used elsewhere)
 *   - 2-step archwizard with template-driven validators
 *   - the SET_ACCOUNT_PROPERTY subtype attachment encoding
 *   - ngx-datatable on a different schema than transactions/messages/assets
 *
 * The "set" test stops short of broadcast (avoids polluting devnet account
 * state with junk key/value pairs). The "list" tests just verify the
 * datatable mounts.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('properties: set-property wizard → confirm step renders entered key/value (no broadcast)', async ({ page }) => {
  await page.goto('#/wallet/account/properties/set-property');

  const recipientInput = page.locator('input[name="recipientRS"]');
  const keyInput       = page.locator('input[name="key"]');
  const valueInput     = page.locator('input[name="value"]');
  const nextButton     = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(recipientInput, 'set-property form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton, 'Next must be disabled while form is empty').toBeDisabled();

  // Unique key per run so reruns don't collide if anyone broadcasts manually.
  const uniqueKey   = `e2e-${Date.now().toString(36)}`;
  const uniqueValue = `e2e-value-${Math.random().toString(36).slice(2, 8)}`;

  await recipientInput.fill(CASH_ACCOUNT_RS);
  await keyInput.fill(uniqueKey);
  await valueInput.fill(uniqueValue);
  await valueInput.blur();
  await expect(nextButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await nextButton.click();   // advances wizard + signs SET_ACCOUNT_PROPERTY

  // Step 2 confirm view — assert the entered values render in <h4>s.
  await expect(
    page.locator('h4', { hasText: CASH_ACCOUNT_RS }).first(),
    'confirm step did not render the entered recipient — archwizard navigation broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h4', { hasText: uniqueKey }).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h4', { hasText: uniqueValue }).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Stop here — broadcast skipped (would pollute Cash Account's properties
  // store on devnet with junk e2e key/value pairs).
});

test('properties: my-properties list mounts an ngx-datatable', async ({ page }) => {
  await page.goto('#/wallet/account/properties/my-properties');

  // The same component renders the datatable when route data.propertyType=MY.
  const datatable = page.locator('ngx-datatable').first();
  await expect(
    datatable,
    'ngx-datatable did not mount on /properties/my-properties — route-data lookup ' +
    'or component-reuse pattern likely broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Headers come from i18n (`table-header.key`, `table-header.value`, etc.).
  // Sanity-check the first header isn't a bare key.
  const firstHeader = page.locator('ngx-datatable .datatable-header-cell').first();
  await expect(firstHeader).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const headerText = ((await firstHeader.textContent()) ?? '').trim();
  expect(
    /^table-header\./.test(headerText),
    `datatable header looks like an untranslated i18n key ("${headerText}")`,
  ).toBe(false);
});

test('properties: external-properties (ALL view) mounts an ngx-datatable', async ({ page }) => {
  await page.goto('#/wallet/account/properties/external-properties');

  const datatable = page.locator('ngx-datatable').first();
  await expect(
    datatable,
    'ngx-datatable did not mount on /properties/external-properties — same component ' +
    'failed to switch its propertyType from MY to ALL via route data',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
