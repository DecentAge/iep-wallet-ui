import { Page, Locator, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object for the welcome / login screen at #/welcome.
 *
 * The welcome page contains:
 *  - language picker
 *  - passphrase password input (`input[name="passPhrase"]`)
 *  - "MY ACCOUNT" submit button (calls `loginToAccount()`, navigates to /dashboard)
 *  - sign-up link (calls `signUp()`, navigates to /sign-up/step-1)
 */
export class WelcomePage {
  readonly page: Page;
  readonly passphraseInput: Locator;
  readonly submitButton: Locator;
  readonly signUpLink: Locator;
  readonly insecurePassphraseWarning: Locator;

  constructor(page: Page) {
    this.page = page;
    this.passphraseInput = page.locator('input[name="passPhrase"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.signUpLink = page.getByText(/Sign Up/i);
    this.insecurePassphraseWarning = page.locator('.alert-warning', {
      hasText: /at least 15 words/i,
    });
  }

  async goto(): Promise<void> {
    await this.page.goto('#/welcome');
    await expect(this.passphraseInput).toBeVisible();
  }

  async login(passphrase: string): Promise<void> {
    await this.passphraseInput.fill(passphrase);
    await this.submitButton.click();
    // Successful login navigates to /dashboard. The wallet hash-routes are
    // namespaced under /wallet (per IEP_WALLET_UI_PATH), so the actual URL
    // ends up as #/wallet/dashboard. Match either form.
    await this.page.waitForURL(/#\/(wallet\/)?dashboard\b/, { timeout: DEFAULT_TIMEOUT_MS });
  }
}
