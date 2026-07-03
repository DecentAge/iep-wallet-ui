import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';

/**
 * Sidebar navigation smoke — complementary to post-auth-routes.spec.ts.
 *
 * post-auth-routes uses `page.goto(hash)` to reach each route directly. That
 * tests the route + its component's render path, but NOT the sidebar's
 * `routerLink` plumbing or the AuthGuard's per-click behaviour. This spec
 * fills that gap by clicking sidebar links and asserting the URL changes.
 *
 * Migration risks this catches:
 *   - sidebar renders at all (chrome regression — would break the whole UI)
 *   - top-level menu items load from `sidebar-routes.config.ts`
 *   - clicking the Dashboard link routes via routerLinkActive correctly
 *   - the Expert/Basic wallet toggle is wired up (button click, not navigation)
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('sidebar: chrome renders with navigation list + at least one top-level menu item', async ({ page }) => {
  // The sidebar wraps its menu in <ul class="navigation"> — same selector
  // used by every page in the post-auth shell.
  const sidebar = page.locator('.sidebar-content ul.navigation');
  await expect(sidebar).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // First entry is always the Dashboard <li class="wallet-switch">.
  const dashboardLink = sidebar.locator('a[routerlink="/dashboard"], a:has(i.icon-Dashboard)').first();
  await expect(dashboardLink).toBeVisible();

  // The dynamic top-level menu items are rendered with id="first_0" / "first_1" / ...
  // by the *ngFor. At least one should exist (Account is always first per
  // sidebar-routes.config.ts).
  const topLevelItems = page.locator('.sidebar-content [id^="first_"]');
  const topLevelCount = await topLevelItems.count();
  expect(topLevelCount, 'sidebar has no dynamic top-level menu items').toBeGreaterThanOrEqual(1);
});

test('sidebar: clicking the Dashboard link from another route returns to /dashboard', async ({ page }) => {
  // Navigate away first so the click has somewhere to come from.
  await page.goto('#/wallet/account/transactions');
  await page.waitForURL(/account\/transactions/, { timeout: DEFAULT_TIMEOUT_MS });

  // Click Dashboard via the sidebar (not via goto) — exercises the routerLink.
  const dashboardLink = page.locator('.sidebar-content a:has(i.icon-Dashboard)').first();
  await expect(dashboardLink).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await dashboardLink.click();

  // Should land back on /dashboard. The Dashboard component sets the URL
  // to #/wallet/dashboard.
  await expect(page).toHaveURL(/#\/(wallet\/)?dashboard/, { timeout: DEFAULT_TIMEOUT_MS });
});

test('sidebar: Expert/Basic wallet toggle is present and clickable', async ({ page }) => {
  // The toggle is the second <li class="wallet-switch"> with onclick=triggerClick().
  // It cycles through expert / basic modes — clicking should not error.
  const toggle = page.locator('.sidebar-content li.wallet-switch a:has(i.icon-wallet)').first();
  await expect(toggle).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Capture the menu-title text before, click, expect text to change.
  const beforeText = (await toggle.locator('.menu-title').first().textContent())?.trim();
  await toggle.click();
  // Allow the (click) handler + ngIf re-render to settle.
  await page.waitForTimeout(200);
  const afterText = (await toggle.locator('.menu-title').first().textContent())?.trim();

  expect(
    beforeText !== afterText,
    `clicking Expert/Basic toggle did not change the label (was "${beforeText}", still "${afterText}")`,
  ).toBe(true);
});

test('sidebar: top-level menu item with submenu expands on click', async ({ page }) => {
  // Account is the first dynamic menu item (id="first_0") and has class="has-sub".
  // Clicking its <a> toggles the .open class on the parent <li>.
  const account = page.locator('.sidebar-content [id="first_0"]');
  await expect(account).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Initially closed.
  await expect(account).not.toHaveClass(/open/);

  await account.locator('a').first().click();
  await expect(account).toHaveClass(/open/, { timeout: DEFAULT_TIMEOUT_MS });
});
