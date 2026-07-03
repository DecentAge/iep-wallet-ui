import { Page, Locator, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object for the post-login dashboard at #/dashboard.
 *
 * We assert on a stable structural element (the header / nav) rather than
 * specific account metrics, which depend on devnet state.
 */
export class DashboardPage {
  readonly page: Page;
  readonly nav: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nav = page.locator('app-sidebar, nav, header').first();
  }

  async expectVisible(): Promise<void> {
    await expect(this.page).toHaveURL(/#\/(wallet\/)?dashboard\b/);
    await expect(this.nav).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }
}
