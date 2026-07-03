import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';

/**
 * Logout flow.
 *
 * The wallet's logout button is in the navbar. Clicking it opens a
 * sweetalert2 confirm modal — the user must click the confirm button before
 * the logout actually happens. After confirmation the wallet:
 *   1. clears sessionStorage (account details + private key)
 *   2. navigates back to /welcome
 *
 * Logout starts authenticated and ends unauthenticated, so it lives under
 * specs/auth/ and runs in the `unauthenticated` Playwright project — the
 * test handles its own login.
 */

test('logout: confirm dialog → returns to /welcome with form empty', async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);

  // 1. Log in.
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();

  // 2. Click the logout button in the navbar (icon-logout marks the trigger).
  const logoutButton = page.locator('a:has(i.icon-logout)').first();
  await expect(logoutButton).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await logoutButton.click();

  // 3. Confirm the sweetalert2 modal.
  const confirmButton = page.locator('.swal2-confirm').first();
  await expect(confirmButton).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await confirmButton.click();

  // 4. Expect navigation back to the welcome screen.
  await page.waitForURL(/#\/(wallet\/)?welcome/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(welcome.passphraseInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(welcome.passphraseInput).toHaveValue('');

  // 5. Session is gone — visiting a protected route bounces us back.
  await page.goto('#/wallet/dashboard');
  await page.waitForURL(/#\/(wallet\/)?welcome/, { timeout: DEFAULT_TIMEOUT_MS });
});

test('logout: cancel keeps the user on the dashboard', async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);

  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();

  await page.locator('a:has(i.icon-logout)').first().click();
  // Sweetalert2's cancel button (renders only if a cancel was configured).
  const cancelButton = page.locator('.swal2-cancel').first();
  await expect(cancelButton).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await cancelButton.click();

  // Modal closed; still on dashboard.
  await expect(page.locator('.swal2-container')).toBeHidden({ timeout: DEFAULT_TIMEOUT_MS });
  await dashboard.expectVisible();
});
