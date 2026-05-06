import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../fixtures/test-accounts';
import { prepareForVisualSnapshot, maskDynamicRegions, SNAPSHOT_OPTIONS } from '../../fixtures/visual';

/**
 * Visual + structural snapshots of the authenticated screens.
 *
 * Each test logs in via the welcome form (cost: ~2s extra per test), then
 * navigates to the route, prepares for a stable snapshot, and asserts both
 * a fullPage screenshot and an aria snapshot of the main content region.
 */

const POST_AUTH_VISUAL_ROUTES: ReadonlyArray<{
  hash: string;
  name: string;
  /** CSS selector for the "main content" region used by the aria snapshot. */
  contentSelector?: string;
}> = [
  // dashboard + account/* (the most-trafficked screens)
  { hash: '#/wallet/dashboard',              name: 'dashboard',            contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/account/detail',         name: 'account-detail',       contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/account/send',           name: 'account-send',         contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/account/receive-tab',    name: 'account-receive',      contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/account/transactions',   name: 'account-transactions', contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/account/bookmark',       name: 'account-bookmark',     contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/account/ledger-view',    name: 'account-ledger-view',  contentSelector: 'main, .content, .container-fluid' },

  // remaining top-level lazy-loaded modules — entry route only.
  // The goal is to lock in current Angular 6 rendering so any cosmetic /
  // semantic drift after the Angular 20 migration is surfaced as a diff.
  { hash: '#/wallet/messages',               name: 'messages',             contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/voting/show-polls',      name: 'voting',               contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/wallet-settings',        name: 'wallet-settings',      contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/assets/show-assets/all', name: 'assets',               contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/aliases/show-alias',     name: 'aliases',              contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/at',                     name: 'at',                   contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/crowdfunding',           name: 'crowdfunding',         contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/subscriptions',          name: 'subscriptions',        contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/escrow',                 name: 'escrow',               contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/shuffling',              name: 'shuffling',            contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/currencies',             name: 'currencies',           contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/tool/user-guide',        name: 'tool-user-guide',      contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/tools',                  name: 'tools',                contentSelector: 'main, .content, .container-fluid' },
  { hash: '#/wallet/dao',                    name: 'dao',                  contentSelector: 'main, .content, .container-fluid' },
];

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

for (const route of POST_AUTH_VISUAL_ROUTES) {
  test(`${route.name}: visual snapshot`, async ({ page }) => {
    await page.goto(route.hash);
    await prepareForVisualSnapshot(page);

    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      ...SNAPSHOT_OPTIONS,
      fullPage: true,
      mask: maskDynamicRegions(page),
    });
  });

  if (route.contentSelector) {
    test(`${route.name}: aria/structure snapshot`, async ({ page }) => {
      await page.goto(route.hash);
      await prepareForVisualSnapshot(page);
      await expect(page.locator(route.contentSelector!).first()).toMatchAriaSnapshot();
    });
  }
}
