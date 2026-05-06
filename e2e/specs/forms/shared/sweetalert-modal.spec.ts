import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Sweetalert2 modal contract — pins the wallet's specific use of the library
 * so the planned **sweetalert2 v7 → v11** upgrade can't silently break it.
 *
 * v7 → v11 is a near-total API rewrite:
 *   - default export `swal()` → named export `Swal.fire()`
 *   - `type: 'warning'` → `icon: 'warning'`
 *   - `confirmButtonClass: '...'` (top-level) → `customClass: { confirmButton: '...' }`
 *   - `input: 'checkbox'` callback signature changed (returns isConfirmed/value/...)
 *   - `swal.noop` removed
 *
 * The wallet wraps swal calls in `shared/data/sweet-alerts.ts`. The richest
 * call is `confirmLogoutButton()` (used by the navbar), which exercises:
 *   - title + text (translated, must not render the bare i18n key)
 *   - `type: 'warning'`
 *   - `input: 'checkbox'`
 *   - `confirmButtonClass: 'btn btn-success btn-raised mr-5'` + `buttonsStyling: false`
 *   - `cancelButtonClass: 'btn btn-danger btn-raised'`
 *
 * Opening the modal and asserting these pieces is enough to catch a v7→v11
 * upgrade where the helper wasn't migrated to the new option shape.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('sweetalert2 modal: logout dialog renders with the expected shape', async ({ page }) => {
  // Click the navbar logout icon to pop the confirmLogoutButton modal.
  // Stop short of confirming so we can inspect the modal in detail.
  await page.locator('a:has(i.icon-logout)').first().click();

  const container = page.locator('.swal2-container');
  await expect(
    container,
    'sweetalert2 container did not mount — Swal.fire() may have been imported ' +
    'incorrectly after a v7→v11 migration',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Title — must not be a bare i18n key (sanity-check the translate pipe ran).
  const title = container.locator('.swal2-title').first();
  await expect(title).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const titleText = ((await title.textContent()) ?? '').trim();
  expect(
    titleText.length,
    'logout modal title is empty — sweetalert mount or translation failed',
  ).toBeGreaterThan(0);
  expect(
    /^tool-pages\./.test(titleText),
    `logout modal title looks like an untranslated i18n key ("${titleText}")`,
  ).toBe(false);

  // Warning styling — v7 sets `swal2-icon swal2-warning`; v11 uses
  // `swal2-icon swal2-warning` as well, but the icon container name has shifted.
  // Either form should produce *some* element with both classes. If neither
  // exists, `type` was not recognised.
  await expect(
    container.locator('.swal2-icon.swal2-warning, .swal2-warning'),
    'warning icon not rendered — `type: warning` likely not recognised under ' +
    'the new API (v11 renamed it to `icon`)',
  ).toHaveCount(1);

  // Checkbox input — `input: 'checkbox'`. The element selector that works
  // across v7 and v11 is plain `input[type="checkbox"]` inside the modal.
  await expect(
    container.locator('input[type="checkbox"]'),
    'checkbox input not rendered — `input: "checkbox"` was not honoured ' +
    'by sweetalert2',
  ).toHaveCount(1);

  // Custom button classes — the wallet passes `confirmButtonClass` and
  // `cancelButtonClass` (v7 syntax) along with `buttonsStyling: false`. After
  // a v11 upgrade these need to move under `customClass:` — this assertion
  // catches that regression.
  const confirm = container.locator('.swal2-confirm').first();
  await expect(confirm).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    confirm,
    'confirm button is missing the wallet-supplied "btn-success" class — ' +
    '`confirmButtonClass` was not migrated to v11\'s `customClass.confirmButton`',
  ).toHaveClass(/btn-success/);

  const cancel = container.locator('.swal2-cancel').first();
  await expect(cancel).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    cancel,
    'cancel button is missing the wallet-supplied "btn-danger" class — ' +
    '`cancelButtonClass` was not migrated to v11\'s `customClass.cancelButton`',
  ).toHaveClass(/btn-danger/);

  // Dismiss the modal so the test ends in a clean state — and verify dismissal works.
  await cancel.click();
  await expect(container, 'cancel did not dismiss the modal').toBeHidden({ timeout: DEFAULT_TIMEOUT_MS });
});
