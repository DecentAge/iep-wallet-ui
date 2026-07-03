import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, CASH_ACCOUNT_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Bookmarks (`#/wallet/account/bookmark`) — exercises the **angular2-indexeddb**
 * dependency end-to-end. That lib is one of the deadest in the wallet's
 * package.json (last release 2018) and must be replaced during the migration.
 * Without a regression test, the replacement could silently break
 * persistence and only show as "my saved addresses are gone" for users.
 *
 * The test:
 *   1. Adds a bookmark with a unique tag (timestamp-suffixed so reruns
 *      don't collide).
 *   2. Confirms the new entry appears in the list (proves IndexedDB write
 *      + the bookmark-list component re-rendered from the change subject).
 *   3. Reloads the page and confirms the entry persists (proves IndexedDB
 *      read on bootstrap).
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('bookmarks: add a contact, list re-renders, entry persists across reload', async ({ page }) => {
  await page.goto('#/wallet/account/bookmark');

  // The form has two inputs (account + tag) and an Add button.
  const accountInput = page.locator('input[name="account"]');
  const tagInput     = page.locator('input[name="tag"]');
  const addButton    = page.locator('button.btn-gradient', { hasText: /add/i }).first();

  await expect(accountInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(tagInput).toBeVisible();
  await expect(addButton).toBeDisabled();   // both fields required

  // Use a unique tag per run so reruns don't collide on tag uniqueness.
  const uniqueTag = `e2e-${Date.now().toString(36)}`;

  await accountInput.fill(CASH_ACCOUNT_RS);
  await tagInput.fill(uniqueTag);
  await tagInput.blur();
  await expect(addButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await addButton.click();

  // The bookmark-list component renders entries somewhere on the page.
  // The unique tag is the most reliable thing to assert.
  await expect(
    page.getByText(uniqueTag, { exact: false }),
    `new bookmark with tag "${uniqueTag}" did not appear after Add — ` +
    `IndexedDB write or bookmark-list refresh likely broken`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Reload the page and confirm the entry survived the IndexedDB round trip.
  await page.reload();
  // The wallet's AuthGuard kicks unauthenticated reloads back to /welcome
  // (sessionStorage may be wiped by reload depending on browser policy).
  // If the reload landed on welcome, log back in and re-navigate.
  if (/welcome/.test(page.url())) {
    const welcome = new WelcomePage(page);
    const dashboard = new DashboardPage(page);
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await dashboard.expectVisible();
    await page.goto('#/wallet/account/bookmark');
  }

  await expect(
    page.getByText(uniqueTag, { exact: false }),
    `bookmark "${uniqueTag}" did not survive reload — IndexedDB read on ` +
    `bootstrap likely broken (or write was never committed)`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
