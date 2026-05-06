import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, SHORT_PASSPHRASE } from '../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';

/**
 * Login flow specs. Run unauthenticated.
 *
 *   1. Happy path:    valid 15-word passphrase → lands on /dashboard
 *   2. Insecure path: <15-word passphrase still logs in but shows warning
 *   3. Empty path:    empty passphrase keeps the submit button disabled
 */

test('login: 15-word passphrase navigates to dashboard', async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);

  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('login: warning shown for insecure (<15 words) passphrase before submit', async ({ page }) => {
  const welcome = new WelcomePage(page);

  await welcome.goto();
  await welcome.passphraseInput.fill(SHORT_PASSPHRASE);
  // The warning component is bound to hasInsecurePassphrase() and renders
  // immediately on input. Click away so the validator runs.
  await welcome.passphraseInput.blur();
  await expect(welcome.insecurePassphraseWarning).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('login: empty passphrase keeps submit disabled', async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await expect(welcome.submitButton).toBeDisabled();
});
