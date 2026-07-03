import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { createTestEscrow } from '../../../helpers/create-escrow';

/**
 * Escrow Status page (`#/wallet/escrow/my-escrow/escrow-status`).
 *
 * beforeAll creates a dedicated escrow that is never signed, so the signer's
 * decision remains "undecided" regardless of the order this file runs relative
 * to sign-escrow.spec.ts (which uses its own separate escrow).
 *
 * The test navigates to the status page via the ?id query param and asserts
 * the signers datatable shows TEST_ACCOUNT_2 with decision "UNDECIDED".
 *
 * Migration risks:
 *   - EscrowStatusComponent.setPage() maps getEscrowTransaction `signers`
 *     array into `rows`; if the API field is renamed the table is empty
 *   - The decision cell renders via `{{value.toString().toUpperCase()}}` —
 *     a template regression (e.g. missing pipe call) would show lowercase
 *   - Both column name keys ('table-header.signer', 'table-header.decision')
 *     and their i18n translations must survive the Angular upgrade
 */

let escrowId: string;

test.beforeAll(async ({ browser, baseURL }) => {
  escrowId = await createTestEscrow(browser, baseURL);
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

test('escrow-status: signers table shows TEST_ACCOUNT_2 as UNDECIDED', async ({ page }) => {
  await page.goto(`#/wallet/escrow/my-escrow/escrow-status?id=${escrowId}`);

  await expect(
    page.locator('h2.main-title'),
    'Escrow Status page title did not render',
  ).toContainText('Escrow Status', { timeout: DEFAULT_TIMEOUT_MS });

  // Both datatable column headers must be present
  await expect(
    page.getByText('Signer', { exact: true }).first(),
    '"Signer" column header not found — table-header.signer i18n key missing or datatable not rendered',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.getByText('Decision', { exact: true }).first(),
    '"Decision" column header not found — table-header.decision i18n key missing',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // TEST_ACCOUNT_2 must be listed as a signer
  await expect(
    page.getByText(TEST_ACCOUNT_2_RS).first(),
    `Signer ${TEST_ACCOUNT_2_RS} not found in escrow-status table — ` +
    `getEscrowTransaction signers array not mapped to datatable rows (escrow ${escrowId})`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Decision must be rendered uppercase ("undecided" → "UNDECIDED")
  await expect(
    page.getByText('UNDECIDED').first(),
    '"UNDECIDED" decision not found — decision cell template or toUpperCase() call broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('escrow-status: navigating without id redirects back', async ({ page }) => {
  // EscrowStatusComponent.ngOnInit() calls _location.back() when ?id is absent.
  // This drives the route guard that prevents orphaned status views.
  // Navigate to the status URL without a query param and verify we don't stay there.
  await page.goto('#/wallet/escrow/my-escrow');
  await page.waitForURL(/#\/wallet\/escrow\/my-escrow$/, { timeout: DEFAULT_TIMEOUT_MS });

  await page.goto('#/wallet/escrow/my-escrow/escrow-status');

  // The component redirects back immediately; the URL must not remain on escrow-status
  await expect(async () => {
    const url = page.url();
    expect(url).not.toMatch(/escrow-status/);
  }).toPass({ timeout: DEFAULT_TIMEOUT_MS });
});
