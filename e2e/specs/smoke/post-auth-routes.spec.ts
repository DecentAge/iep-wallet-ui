import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
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
 * The route table is derived from the `*-routing.module.ts` files under
 * `src/app/module/`. Three families are out of scope here: routes needing a
 * path parameter (`trade/:id`, `delete-currency/:id`, `show-daos/:mode/:daoName`,
 * …), the row-context detail views (transaction-details, account-details,
 * asset-details, …) which read a selection out of service state rather than
 * out of the URL, and the mutation masks that `_location.back()` on a missing
 * queryParam (transfer-asset, dividend-payment, delete-shares, delete-asset,
 * delete-property, start-/stop-shuffling, transfer-/edit-/delete-alias) or take
 * their subject from `DataStoreService` (cancel-order, reserve-units) — those
 * are driven through their own click paths in `specs/forms/**`.
 * `my-open-offers/cancel-offer` mounts without a param but signs a cancellation
 * on init, so it stays out of a smoke table too.
 */

// Same sidebar toggle expert-toggle.spec.ts drives; one click flips basic → expert.
const SIDEBAR_EXPERT_TOGGLE = '.sidebar-content li.wallet-switch a:has(i.icon-wallet)';
const EXPERT_TOGGLE_SETTLE_MS = 150;

// Routes are namespaced under /wallet (IEP_WALLET_UI_PATH), because
// HashLocationStrategy prefixes the app's `<base href="/wallet/">`.
const POST_AUTH_ROUTES: ReadonlyArray<{
  hash: string;
  expect: { selector: string };
  // Settled URL — only on parents that redirect to a default child tab.
  url?: RegExp;
  // Flip into expert mode first: the Send / Receive tab strips and the
  // <router-outlet> their children need live inside `*isExpertView="true"`.
  expert?: boolean;
  // Reason the route is broken — the row stays, the test is declared fixme.
  fixme?: string;
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

  // remaining top-level modules — entry route only; sub-routes follow below.
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

  // ─── sub-routes: asserted on the routed component's own element (parent >
  // child for tabbed screens), so a fallback to the dashboard fails. ───

  // account/* child tabs
  { hash: '#/wallet/account/send/simple',                    expect: { selector: 'app-send app-send-simple' },       expert: true },
  { hash: '#/wallet/account/send/deferred',                  expect: { selector: 'app-send app-send-deferred' },     expert: true },
  { hash: '#/wallet/account/send/reference',                 expect: { selector: 'app-send app-send-reference' },    expert: true },
  { hash: '#/wallet/account/send/secret',                    expect: { selector: 'app-send app-send-secret' },       expert: true },
  { hash: '#/wallet/account/receive-tab/receive',            expect: { selector: 'app-receive-tab app-receive' },    expert: true },
  { hash: '#/wallet/account/receive-tab/claim',              expect: { selector: 'app-receive-tab app-claim' },      expert: true },
  { hash: '#/wallet/account/transactions/completed',         expect: { selector: 'app-history app-completed-transactions' } },
  { hash: '#/wallet/account/transactions/pending',           expect: { selector: 'app-history app-pending-transactions' } },
  { hash: '#/wallet/account/properties/set-property',        expect: { selector: 'app-properties app-set-property' } },
  { hash: '#/wallet/account/properties/my-properties',       expect: { selector: 'app-properties app-set-property' } },
  { hash: '#/wallet/account/properties/external-properties', expect: { selector: 'app-properties app-set-property' } },
  { hash: '#/wallet/account/funding-monitor/control-funding', expect: { selector: 'app-funding-monitor app-control-funding-monitor' } },
  { hash: '#/wallet/account/funding-monitor/active-monitors', expect: { selector: 'app-funding-monitor app-active-funding-monitor' } },

  // assets/*
  { hash: '#/wallet/assets/show-assets/my',    expect: { selector: 'app-all-assets app-assets' } },
  { hash: '#/wallet/assets/my-open-orders',    expect: { selector: 'app-my-open-orders' } },
  { hash: '#/wallet/assets/my-open-orders/buy',  expect: { selector: 'app-my-open-orders app-open-orders' } },
  { hash: '#/wallet/assets/my-open-orders/sell', expect: { selector: 'app-my-open-orders app-open-orders' } },
  { hash: '#/wallet/assets/my-trades',         expect: { selector: 'app-my-trades' } },
  { hash: '#/wallet/assets/my-transfers',      expect: { selector: 'app-my-transfers' } },
  { hash: '#/wallet/assets/last-trades',       expect: { selector: 'app-last-trade' } },
  { hash: '#/wallet/assets/search-assets',     expect: { selector: 'app-search-assets' } },
  { hash: '#/wallet/assets/issue-asset',       expect: { selector: 'app-issue-asset' } },
  { hash: '#/wallet/assets/send-assets',       expect: { selector: 'app-send-assets' } },

  // aliases/*
  { hash: '#/wallet/aliases/create-alias',     expect: { selector: 'app-create-alias' } },
  { hash: '#/wallet/aliases/my-sell-offers',    expect: { selector: 'app-my-sell-offers' } },
  { hash: '#/wallet/aliases/buy-offers',        expect: { selector: 'app-buy-offers app-offers' }, url: /#\/wallet\/aliases\/buy-offers\/private$/ },
  { hash: '#/wallet/aliases/buy-offers/public', expect: { selector: 'app-buy-offers app-offers' } },
  // queryParams-driven, no DataStore; sell-alias is absent — it bounces on !params.alias.
  { hash: '#/wallet/aliases/my-sell-offers/cancel-alias-sell', expect: { selector: 'app-cancel-alias-sell' } },
  { hash: '#/wallet/aliases/buy-offers/buy-alias',             expect: { selector: 'app-buy-alias' } },

  // currencies/*
  { hash: '#/wallet/currencies/issue-currency',      expect: { selector: 'app-issue-currency' } },
  { hash: '#/wallet/currencies/show-currencies',     expect: { selector: 'app-show-currencies app-currencies' }, url: /#\/wallet\/currencies\/show-currencies\/all$/ },
  { hash: '#/wallet/currencies/show-currencies/my',  expect: { selector: 'app-show-currencies app-currencies' } },
  // no bounce on a missing `id`: the mask mounts and only its currency fields stay empty.
  { hash: '#/wallet/currencies/show-currencies/transfer-currency', expect: { selector: 'app-transfer-currency' } },
  { hash: '#/wallet/currencies/search-currencies',   expect: { selector: 'app-search-currencies' } },
  { hash: '#/wallet/currencies/my-exchanges',        expect: { selector: 'app-my-exchanges' } },
  { hash: '#/wallet/currencies/last-exchanges',      expect: { selector: 'app-last-exchanges' } },
  { hash: '#/wallet/currencies/my-transfers',        expect: { selector: 'app-my-transfers' } },
  { hash: '#/wallet/currencies/my-open-offers',      expect: { selector: 'app-my-open-offers app-open-offers' }, url: /#\/wallet\/currencies\/my-open-offers\/buy$/ },
  { hash: '#/wallet/currencies/my-open-offers/sell', expect: { selector: 'app-my-open-offers app-open-offers' } },
  { hash: '#/wallet/currencies/send-currencies',     expect: { selector: 'app-send-currencies' } },

  // shuffling/*
  { hash: '#/wallet/shuffling/create-shuffling',   expect: { selector: 'app-create-shuffling' } },
  { hash: '#/wallet/shuffling/show-shufflings',    expect: { selector: 'app-show-shufflings app-shufflings' }, url: /#\/wallet\/shuffling\/show-shufflings\/all$/ },
  { hash: '#/wallet/shuffling/show-shufflings/my', expect: { selector: 'app-show-shufflings app-shufflings' } },

  // at/*
  { hash: '#/wallet/at/create-at',          expect: { selector: 'app-create-at' } },
  { hash: '#/wallet/at/show-ats',           expect: { selector: 'app-show-ats app-at' }, url: /#\/wallet\/at\/show-ats\/all$/ },
  { hash: '#/wallet/at/show-ats/my',        expect: { selector: 'app-show-ats app-at' } },
  { hash: '#/wallet/at/workbench',          expect: { selector: 'app-workbench app-dashboard' }, url: /#\/wallet\/at\/workbench\/dashboard$/ },
  { hash: '#/wallet/at/workbench/compiler', expect: { selector: 'app-workbench app-compiler' } },

  // dao/*
  { hash: '#/wallet/dao/create-dao',        expect: { selector: 'app-dao' } },
  { hash: '#/wallet/dao/show-daos',         expect: { selector: 'app-show-daos app-daos' }, url: /#\/wallet\/dao\/show-daos\/all$/ },
  { hash: '#/wallet/dao/show-daos/my',      expect: { selector: 'app-show-daos app-daos' } },
  { hash: '#/wallet/dao/create-teams',      expect: { selector: 'app-create-teams' } },
  { hash: '#/wallet/dao/add-team-members',  expect: { selector: 'app-team-members' } },
  { hash: '#/wallet/dao/approval-accounts', expect: { selector: 'app-approval-accounts' } },
  { hash: '#/wallet/dao/add-team-poll',     expect: { selector: 'app-add-team-poll' } },

  // tool/* — the standalone tool pages (ToolsPagesModule)
  { hash: '#/wallet/tool/calculate-hash',        expect: { selector: 'app-calculate-hash' } },
  { hash: '#/wallet/tool/validate-signature',    expect: { selector: 'app-validate-signature' } },
  { hash: '#/wallet/tool/generate-signature',    expect: { selector: 'app-generate-signature' } },
  { hash: '#/wallet/tool/broadcast-transaction', expect: { selector: 'app-broadcast-transaction' } },
  { hash: '#/wallet/tool/parse-transaction',     expect: { selector: 'app-parse-transaction' } },
  { hash: '#/wallet/tool/transaction-types',     expect: { selector: 'app-transaction-types' } },
  { hash: '#/wallet/tool/service-fees',          expect: { selector: 'app-service-fees' } },
  { hash: '#/wallet/tool/chain-statistics',      expect: { selector: 'app-chain-statistics' } },

  // tools/* — the extensions module (overview tabs + chain viewer). `tools/macap`
  // is deliberately absent: its route is commented out in extensions-routing.module.ts.
  { hash: '#/wallet/tools/all',         expect: { selector: 'app-overview app-all' } },
  { hash: '#/wallet/tools/online',      expect: { selector: 'app-overview app-online' } },
  { hash: '#/wallet/tools/development', expect: { selector: 'app-overview app-development' } },
  { hash: '#/wallet/tools/concept',     expect: { selector: 'app-overview app-concept' } },
  { hash: '#/wallet/tools/poc',         expect: { selector: 'app-overview app-poc' } },
  { hash: '#/wallet/tools/chain-viewer',              expect: { selector: 'app-chain-viewer app-blocks' }, url: /#\/wallet\/tools\/chain-viewer\/blocks$/ },
  { hash: '#/wallet/tools/chain-viewer/transactions', expect: { selector: 'app-chain-viewer app-transactions' } },
  { hash: '#/wallet/tools/chain-viewer/unconfirmed',  expect: { selector: 'app-chain-viewer app-unconfirmed' } },
  {
    hash: '#/wallet/tools/chain-viewer/peers',
    expect: { selector: 'app-chain-viewer app-peers' },
    fixme:
      'wallet bug: ExtensionsService.getPeers() sends {page, results, filter, order} — the ' +
      'peerexplorer backend API — to peerService.getPeerEndPoints()[0], which resolves to ' +
      'AppConstants.DEFAULT_OPTIONS.NODE_API_URL, i.e. the node itself (apiServerURL is absent from ' +
      'every shipped env.config.js, so it falls back to window.location.origin). The request hits the ' +
      'node root instead of an API that understands those parameters and the wallet raises an error ' +
      'dialog. Needs a decision on which backend this view should query.',
  },
  { hash: '#/wallet/tools/newsviewer',                expect: { selector: 'app-news-center' } },
  { hash: '#/wallet/tools/service-monitor', expect: { selector: 'app-service-monitor' } },

  // wallet-settings/* (SwappsModule)
  { hash: '#/wallet/wallet-settings/swapps', expect: { selector: 'app-wallet-settings' } },
  { hash: '#/wallet/wallet-settings/options', expect: { selector: 'app-options' } },

  // subscriptions/*
  { hash: '#/wallet/subscriptions/create-subscription', expect: { selector: 'app-create-subscription' } },
  { hash: '#/wallet/subscriptions/my-subscriptions',    expect: { selector: 'app-my-subscriptions' } },

  // voting/* — show-polls/{result,voters,details,vote} _location.back() without ?id=; poll-results.spec.ts covers them.
  { hash: '#/wallet/voting/create-poll',    expect: { selector: 'app-create-poll' } },
  { hash: '#/wallet/voting/show-polls/all', expect: { selector: 'app-show-polls app-polls' } },
  { hash: '#/wallet/voting/show-polls/my',  expect: { selector: 'app-show-polls app-polls' } },

  // escrow/*
  { hash: '#/wallet/escrow/create-escrow', expect: { selector: 'app-create-escrow' } },
  { hash: '#/wallet/escrow/my-escrow',     expect: { selector: 'app-my-escrow' } },

  // messages/*
  { hash: '#/wallet/messages/show-messages', expect: { selector: 'app-messages' } },
  { hash: '#/wallet/messages/send-message',  expect: { selector: 'app-send-message' } },

  // crowdfunding/*
  { hash: '#/wallet/crowdfunding/create-campaign',    expect: { selector: 'app-create-campaign' } },
  { hash: '#/wallet/crowdfunding/show-campaigns',     expect: { selector: 'app-show-campaigns app-campaigns' }, url: /#\/wallet\/crowdfunding\/show-campaigns\/all$/ },
  { hash: '#/wallet/crowdfunding/show-campaigns/my',  expect: { selector: 'app-show-campaigns app-campaigns' } },
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
  const title = `renders ${route.hash} without console errors`;

  const body = async ({ page }: { page: Page }) => {
    if (route.expert) {
      await page.locator(SIDEBAR_EXPERT_TOGGLE).first().click();
      await page.waitForTimeout(EXPERT_TOGGLE_SETTLE_MS);
    }

    await page.goto(route.hash);

    if (route.url) {
      await expect(
        page,
        `${route.hash} did not settle on its default child route — check the redirect in the module's *-routing.module.ts`,
      ).toHaveURL(route.url, { timeout: DEFAULT_TIMEOUT_MS });
    }

    await expect(
      page.locator(route.expect.selector).first(),
      `"${route.expect.selector}" never rendered for ${route.hash} — the route either failed to match (router falls back to the dashboard) or its component threw during init`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

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
  };

  if (route.fixme) {
    test.fixme(`${title} — ${route.fixme}`, body);
  } else {
    test(title, body);
  }
}
