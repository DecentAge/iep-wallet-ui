import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';

/**
 * Smoke checks for routes BEHIND the AuthGuard.
 *
 * Each test logs in via the welcome form (slower, but doesn't depend on
 * reverse-engineering the wallet's sessionStorage shape), then navigates to
 * the route under test. Any console.error during navigation/render fails the
 * test (after filtering known dev-server noise).
 *
 * The route table is intentionally short to start — add to it as you upgrade.
 * The order picks high-value screens to catch broad regressions early.
 */

// Routes are namespaced under /wallet (IEP_WALLET_UI_PATH). The list covers
// every top-level lazy-loaded module declared in shared/routes/full-layout.routes.ts
// — the high-yield smoke target. Each row is one route; add more as you go.
const POST_AUTH_ROUTES: ReadonlyArray<{
  hash: string;
  expect: { selector: string };
}> = [
  // dashboard + account/* (the most-trafficked screens)
  { hash: '#/wallet/dashboard',            expect: { selector: 'app-sidebar, nav, header' } },
  { hash: '#/wallet/account/detail',       expect: { selector: 'body' } },
  { hash: '#/wallet/account/send',         expect: { selector: 'body' } },
  { hash: '#/wallet/account/receive-tab',  expect: { selector: 'body' } },
  { hash: '#/wallet/account/transactions', expect: { selector: 'body' } },
  { hash: '#/wallet/account/bookmark',     expect: { selector: 'body' } },
  { hash: '#/wallet/account/ledger-view',  expect: { selector: 'body' } },

  // account/* "Advanced" sub-menu (sidebar-gated by isExpertView, but the
  // routes themselves are reachable directly — toggle only hides the menu).
  // expert-toggle.spec.ts covers the gating mechanism; this list smokes the
  // route components.
  { hash: '#/wallet/account/control',          expect: { selector: 'body' } },
  { hash: '#/wallet/account/balance-lease',    expect: { selector: 'body' } },
  { hash: '#/wallet/account/search-account',   expect: { selector: 'body' } },
  { hash: '#/wallet/account/lessors',          expect: { selector: 'body' } },
  { hash: '#/wallet/account/properties',       expect: { selector: 'body' } },
  { hash: '#/wallet/account/block-generation', expect: { selector: 'body' } },
  { hash: '#/wallet/account/funding-monitor',  expect: { selector: 'body' } },

  // each remaining top-level module — entry route only; the goal here is to
  // confirm the lazy-loaded module compiles + renders, not to exercise its
  // sub-routes (those are best added once the migration shakes out).
  { hash: '#/wallet/messages',             expect: { selector: 'body' } },
  { hash: '#/wallet/voting/show-polls',    expect: { selector: 'body' } },
  { hash: '#/wallet/wallet-settings',      expect: { selector: 'body' } },
  { hash: '#/wallet/assets/show-assets/all', expect: { selector: 'body' } },
  { hash: '#/wallet/aliases/show-alias',   expect: { selector: 'body' } },
  { hash: '#/wallet/at',                   expect: { selector: 'body' } },
  { hash: '#/wallet/crowdfunding',         expect: { selector: 'body' } },
  { hash: '#/wallet/subscriptions',        expect: { selector: 'body' } },
  { hash: '#/wallet/escrow',               expect: { selector: 'body' } },
  { hash: '#/wallet/shuffling',            expect: { selector: 'body' } },
  { hash: '#/wallet/currencies',           expect: { selector: 'body' } },
  { hash: '#/wallet/tool/user-guide',      expect: { selector: 'body' } },
  { hash: '#/wallet/tools',                expect: { selector: 'body' } },
  { hash: '#/wallet/dao',                  expect: { selector: 'body' } },
];

test.beforeEach(async ({ page }) => {
  // Collect console.errors from this point on; assertions check them per-test.
  (page as any).__consoleErrors = [] as string[];
  page.on('console', msg => {
    if (msg.type() === 'error') (page as any).__consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => (page as any).__consoleErrors.push(`pageerror: ${err.message}`));

  // Log in once at the top of each test; faster than reverse-engineering
  // sessionStorage but still resilient to wallet refactors.
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();

  // Reset console-error buffer so per-test assertions only see noise from
  // the test's own navigation, not the login flow itself.
  (page as any).__consoleErrors = [];
});

for (const route of POST_AUTH_ROUTES) {
  test(`renders ${route.hash} without console errors`, async ({ page }) => {
    await page.goto(route.hash);
    await expect(page.locator(route.expect.selector).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    const errors: string[] = (page as any).__consoleErrors ?? [];
    // Filter dev-mode noise that's unrelated to the route under test:
    //   - ng-cli-ws / webpack-dev-server / [WDS] Disconnected: HMR socket
    //     hiccups (devnet-only; production nginx image is unaffected)
    //   - "Failed to load resource: ... 404": pre-existing missing static
    //     asset in the Angular 6 wallet (favicon/font/legacy-bower leftover)
    const realErrors = errors.filter(e =>
      !/ng-cli-ws|webpack-dev-server|\[WDS\]/i.test(e) &&
      !/Failed to load resource:.*404/i.test(e),
    );
    expect(realErrors, `console errors on ${route.hash}:\n${realErrors.join('\n')}`).toEqual([]);
  });
}
