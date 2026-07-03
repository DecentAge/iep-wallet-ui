import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';

/**
 * Full sign-up wizard happy path.
 *
 * Wizard steps (router-driven, not angular-archwizard for this flow):
 *   step-1: disclaimer
 *   step-2: generated passphrase shown in <h4 class="phrase">
 *   step-3: re-type the passphrase + "Confirm and login"
 *
 * The migration risks this catches:
 *   - sign-up wizard navigation (router-based, AuthGuard interplay)
 *   - the passphrase generation pipeline (cryptoService entropy + word-list lookup)
 *   - the keypair derivation that feeds Confirm
 *   - the post-signup auto-login that lands on /dashboard
 *
 * Side effect: completes a real signup against devnet, leaving an unfunded
 * account in sessionStorage. We clear sessionStorage in afterEach so other
 * tests in the unauthenticated project don't see a stale auth.
 */

test.afterEach(async ({ page }) => {
  // Clear the wallet's session so the next test starts from a clean welcome page.
  await page.evaluate(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* about:blank */ }
  });
});

test('sign-up: full wizard from welcome → dashboard with a new account', async ({ page }) => {
  // Allow more time — three navigations + signing on a slow first run.
  test.setTimeout(2 * 60 * 1000);

  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);

  // 1. Welcome → Sign Up link → step-1 (disclaimer).
  await welcome.goto();
  await welcome.signUpLink.click();
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-1/, { timeout: DEFAULT_TIMEOUT_MS });

  // 2. Step-1 disclaimer → click "Next" → step-2 (passphrase).
  const nextButton = page.locator('button.btn-gradient', { hasText: /next|continue/i }).first();
  await expect(nextButton).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await nextButton.click();
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-2/, { timeout: DEFAULT_TIMEOUT_MS });

  // 3. Capture the generated passphrase from <h4 class="phrase">.
  const phraseElement = page.locator('h4.phrase');
  await expect(phraseElement).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const phraseText = (await phraseElement.textContent())?.trim() ?? '';
  // The h4 content is `{{secret}} <i class="fa fa-clone">` — the icon's text is empty,
  // but textContent may include surrounding whitespace; trim it.
  const passphrase = phraseText.replace(/\s+/g, ' ').trim();
  expect(passphrase.length, 'no passphrase rendered on step-2').toBeGreaterThan(20);
  expect(passphrase.split(/\s+/).length, 'passphrase has fewer than 12 words').toBeGreaterThanOrEqual(12);

  // 4. Step-2 → click "Next" → step-3 (confirm).
  await page.locator('button.btn-gradient', { hasText: /next|continue/i }).first().click();
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-3/, { timeout: DEFAULT_TIMEOUT_MS });

  // 5. Re-type the captured passphrase.
  const confirmInput = page.locator('input[name="passPhrase"]');
  await expect(confirmInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await confirmInput.fill(passphrase);

  // 6. Confirm and login.
  const confirmButton = page.locator('button.btn-primary, button.btn-gradient').filter({
    hasText: /confirm|login|finish/i,
  }).first();
  await expect(confirmButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await confirmButton.click();

  // 7. Should land on /dashboard.
  await dashboard.expectVisible();
});
