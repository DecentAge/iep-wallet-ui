import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';

/**
 * Sign-up wizard smoke checks (pre-auth).
 *
 * The wizard has three pages reachable via interactive flow only:
 *   /sign-up/step-1  — passphrase generated and shown
 *   /sign-up/step-2  — user confirms by re-typing
 *   /sign-up/step-3  — disclaimer + finish
 *
 * Direct hash navigation to step-2 / step-3 doesn't land on those pages —
 * the wizard rejects deep-linking and bounces back. Walking through it
 * interactively (clicking Next, retyping the generated passphrase, accepting
 * disclaimer) is brittle until we have stable POMs for each step. For now
 * we smoke just step-1, which is reachable via the welcome page's sign-up
 * link. Add full-wizard interaction tests once the migration shakes out.
 */

test.beforeEach(async ({ page }) => {
  (page as any).__consoleErrors = [] as string[];
  page.on('console', msg => {
    if (msg.type() === 'error') (page as any).__consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => (page as any).__consoleErrors.push(`pageerror: ${err.message}`));
});

test('sign-up: link from welcome → step-1 renders wizard chrome', async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.signUpLink.click();
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-1/, { timeout: DEFAULT_TIMEOUT_MS });

  // Wizard chrome: 3-dot pagination indicator + main card.
  await expect(page.locator('ul.pagination li').first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('.card')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const errors: string[] = (page as any).__consoleErrors ?? [];
  const realErrors = errors.filter(e =>
    !/ng-cli-ws|webpack-dev-server|\[WDS\]/i.test(e) &&
    !/Failed to load resource:.*404/i.test(e),
  );
  expect(realErrors, `console errors on sign-up step-1:\n${realErrors.join('\n')}`).toEqual([]);
});
