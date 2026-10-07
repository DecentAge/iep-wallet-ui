import { test, expect } from '../../../fixtures/test';
import { Page, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Dashboard (`#/wallet/dashboard`) — the landing page of every logged-in
 * session, so far only covered by "it mounts at all".
 *
 * What can silently break here:
 *   - the account figures arrive through `RootScope.onChange`, a hand-rolled
 *     rxjs Subject that the dashboard subscribes to *after* full-layout has
 *     already emitted, then re-triggers with `RootScope.set({})`. A missed
 *     emission leaves the placeholder "0.00" and the empty address on screen,
 *     which looks like an empty account rather than a broken binding.
 *   - `amountTqt` divides by TOKEN_QUANTS (1e8); a scaling regression there
 *     misprices the whole wallet while still rendering a plausible number.
 *   - the four tiles navigate through `navigateTo()`/Router, not routerLink —
 *     a click handler that stops working fails silently.
 *   - `redirectTo()` consumes a localStorage hand-off written by AuthGuard for
 *     the QR-payment deep links; if it stops clearing the key the wallet is
 *     stuck redirecting on every login.
 *   - the price chart is `*ngIf="showChart"`, flipped only by a non-empty
 *     history array from the market backend.
 */

const TOKEN_QUANTS = 100_000_000;

/** Same expression as `AmountTqtPipe.transform`, float math included. */
const formatXin = (tqt: string | number): string =>
  (Number(tqt) / TOKEN_QUANTS).toLocaleString('en-US', { minimumFractionDigits: 2 });

async function fetchAccount(request: APIRequestContext, apiOrigin: string): Promise<any> {
  const res = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAccount', account: TEST_ACCOUNT_1_RS },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(res.ok(), `getAccount for ${TEST_ACCOUNT_1_RS} answered HTTP ${res.status()}`).toBe(true);
  const body = await res.json();
  expect(
    body.balanceTQT,
    `getAccount returned no balanceTQT for ${TEST_ACCOUNT_1_RS}: ${JSON.stringify(body)}`,
  ).toBeDefined();
  return body;
}

/** XIN figure without its unit label. The address is awaited first: same
 *  RootScope payload, so it rules out the pre-emission "0.00" placeholder. */
async function readDashboardXin(page: Page): Promise<string> {
  await expect(
    page.locator('app-dashboard .account-address'),
    `the dashboard never rendered ${TEST_ACCOUNT_1_RS} — RootScope.onChange delivered no account payload`,
  ).toHaveText(TEST_ACCOUNT_1_RS, { timeout: DEFAULT_TIMEOUT_MS });

  const cell = page.locator('app-dashboard .valuation-xin');
  const unit = (await cell.locator('small').textContent()) ?? '';
  const full = (await cell.textContent()) ?? '';
  return full.replace(unit, '').replace(/\s+/g, '');
}

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    const welcome = new WelcomePage(page);
    await welcome.goto();
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await new DashboardPage(page).expectVisible();
  });

  test('dashboard: address and XIN/USD valuation match the account on chain', async ({ page, request, baseURL }) => {
    const apiOrigin = apiOriginFromBaseURL(baseURL);

    await expect(
      page.locator('app-dashboard .account-address'),
      `the dashboard shows a different address than the logged-in ${TEST_ACCOUNT_1_RS} — ` +
        'the accountRs binding is reading the wrong RootScope field',
    ).toHaveText(TEST_ACCOUNT_1_RS, { timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      page.locator('app-dashboard .valuation-xin small'),
      'the XIN unit label next to the balance is a bare i18n key — common.xin-unit-text is not translated',
    ).not.toContainText('xin-unit-text', { timeout: DEFAULT_TIMEOUT_MS });

    // The wallet reads getAccount once per page load — a tx confirming in
    // between leaves a stale figure, so reload and compare again.
    let shown = '';
    let expected = '';
    let tqt = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const account = await fetchAccount(request, apiOrigin);
      tqt = String(account.balanceTQT);
      expected = formatXin(tqt);
      shown = await readDashboardXin(page);
      if (shown === expected) break;
      if (attempt < 3) await page.reload();
    }

    expect(
      shown,
      `.valuation-xin shows "${shown}" while getAccount(${TEST_ACCOUNT_1_RS}).balanceTQT=${tqt} ` +
        `formats to "${expected}" via amountTqt — either the pipe stopped dividing by ` +
        `TOKEN_QUANTS=${TOKEN_QUANTS}, or the dashboard is bound to a different balance field`,
    ).toBe(expected);

    const priceRes = await request.get(`${apiOrigin}/mcap-backend/api/v1/get`, {
      params: { name: 'xin' },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const priceBody = priceRes.ok() ? await priceRes.json() : null;
    const priceDoc = Array.isArray(priceBody) ? priceBody[0] : priceBody;
    const priceUsd = priceDoc && priceDoc.price_usd != null ? Number(priceDoc.price_usd) : null;

    const fiat = page.locator('app-dashboard .valuation-usd app-fiat');
    await expect(
      fiat,
      'the dashboard did not render the <app-fiat> USD valuation next to the XIN balance',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    if (priceUsd === null) {
      await expect(
        fiat,
        'the market backend serves no XIN price, so app-fiat must fall back to "n/a" — ' +
          'anything else means priceUnavailable stopped guarding the multiplication',
        ).toHaveText(/n\/a/i, { timeout: DEFAULT_TIMEOUT_MS });
    } else {
      await expect(
        fiat,
        `app-fiat shows "n/a" although the market backend serves price_usd=${priceUsd} — ` +
          'the getXinPrice() subscription or the {USD} mapping is broken',
      ).not.toHaveText(/n\/a/i, { timeout: DEFAULT_TIMEOUT_MS });

      const usdText = ((await fiat.textContent()) ?? '').trim();
      const shownUsd = Number(usdText.replace(/,/g, ''));
      const expectedUsd = (Number(tqt) / TOKEN_QUANTS) * priceUsd;
      // 1 % absorbs a price tick between the wallet's fetch and ours; a wrong
      // scale is off by 1e8.
      expect(
        Number.isFinite(shownUsd) && Math.abs(shownUsd - expectedUsd) <= Math.abs(expectedUsd) * 0.01,
        `the USD valuation reads "${usdText}" but ${formatXin(tqt)} XIN at ${priceUsd} USD/XIN ` +
          `is ${expectedUsd} — app-fiat is feeding quantToAmount the wrong unit`,
      ).toBe(true);
    }
  });

  test('dashboard: the four action tiles navigate to their target views', async ({ page }) => {
    const tiles = [
      {
        name: 'Send',
        icon: 'i.icon-send',
        url: /#\/wallet\/account\/send\/simple\b/,
        target: 'app-send-simple input[name="recipientRS"]',
        targetName: 'the Send form recipient input',
      },
      {
        name: 'Receive',
        icon: 'i.icon-receive',
        url: /#\/wallet\/account\/receive-tab\/receive\b/,
        target: 'app-receive qrcode',
        targetName: 'the Receive view QR code',
      },
      {
        name: 'Account info',
        icon: 'i.icon-account_info',
        url: /#\/wallet\/account\/detail\b/,
        target: `app-details h4:has-text("${TEST_ACCOUNT_1_RS}")`,
        targetName: 'the account-detail address row',
      },
      {
        name: 'Transactions',
        icon: 'i.icon-transactions',
        url: /#\/wallet\/account\/transactions\/completed\b/,
        target: 'app-completed-transactions ngx-datatable',
        targetName: 'the completed-transactions datatable',
      },
    ];

    for (const tile of tiles) {
      await test.step(`tile "${tile.name}"`, async () => {
        await page.goto('#/wallet/dashboard');
        const card = page.locator(`app-dashboard .card-right .card:has(${tile.icon})`);
        await expect(
          card,
          `the "${tile.name}" tile (${tile.icon}) is missing from the dashboard`,
        ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

        await card.click();

        await expect(
          page,
          `clicking the "${tile.name}" tile did not route to ${tile.url} — ` +
            'the (click)="navigateTo(...)" handler no longer reaches the Router',
        ).toHaveURL(tile.url, { timeout: DEFAULT_TIMEOUT_MS });

        await expect(
          page.locator(tile.target),
          `the "${tile.name}" tile changed the URL but ${tile.targetName} never mounted`,
        ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
      });
    }
  });

  test('dashboard: the price chart mounts exactly when the market backend has history', async ({ page, request, baseURL }) => {
    const apiOrigin = apiOriginFromBaseURL(baseURL);

    const historyRes = await request.get(`${apiOrigin}/mcap-backend/api/v1/xin/history`, {
      params: { days: 365 },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const history = historyRes.ok() ? await historyRes.json() : null;
    const hasHistory = Array.isArray(history) && history.length > 0;

    // Re-mount the dashboard: without waiting for the wallet's own history
    // response, the "no chart" branch would pass before that fetch returned.
    await page.goto('#/wallet/account/detail');
    await expect(
      page.locator('app-details'),
      'could not leave the dashboard to force a re-mount',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    const walletHistory = page.waitForResponse(
      (r) => r.url().includes('/mcap-backend/api/v1/xin/history'),
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    await page.goto('#/wallet/dashboard');
    const walletHistoryRes = await walletHistory;

    const chart = page.locator('app-dashboard canvas[baseChart]');

    if (hasHistory) {
      expect(
        walletHistoryRes.status(),
        `our probe got ${(history as any[]).length} history points but the dashboard's own ` +
          `request answered HTTP ${walletHistoryRes.status()} — getXinHistory() is built from ` +
          'the wrong URL (AppConstants.macapViewerConfig)',
      ).toBe(historyRes.status());

      await expect(
        chart,
        `the market backend serves ${(history as any[]).length} history points but no ` +
          'canvas[baseChart] rendered — showChart stayed false, or ng2-charts no longer ' +
          'binds the baseChart directive',
      ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

      const box = await chart.boundingBox();
      expect(
        box !== null && box.width > 0 && box.height > 0,
        `the chart canvas has no drawable area (${JSON.stringify(box)}) — chart.js mounted ` +
          'into a collapsed container, so the price curve is invisible',
      ).toBe(true);

      await expect(
        page.locator('app-dashboard .card-header .card-title').first(),
        'the chart card heading is a bare i18n key — dashboard.market-txt is not translated',
      ).not.toContainText('dashboard.market-txt', { timeout: DEFAULT_TIMEOUT_MS });
    } else {
      await expect(
        chart,
        'the market backend returned an empty history, so *ngIf="showChart" must keep the ' +
          'chart out of the DOM — an empty chart frame means showChart is set unconditionally',
      ).toHaveCount(0);
    }
  });
});

test.describe('dashboard: redirectTo hand-off', () => {
  test('dashboard: consumes the localStorage redirectTo with its query params and clears it', async ({ page }) => {
    const welcome = new WelcomePage(page);
    await welcome.goto();

    // A QR-payment deep link, the shape AuthGuard stores. Per-run unique
    // amount so a stale prefill can't pass.
    const amount = String((parseInt(Date.now().toString(36).slice(-4), 36) % 900) + 100);
    const target = `/account/send/simple?recipientRS=${TEST_ACCOUNT_2_RS}&amount=${amount}`;
    await page.evaluate((value) => localStorage.setItem('redirectTo', value), target);

    // Not WelcomePage.login(): the dashboard hops on inside ngOnInit, so
    // waiting for the dashboard URL races that hop.
    await welcome.passphraseInput.fill(TEST_ACCOUNT_1_PASSPHRASE);
    await welcome.submitButton.click();

    await page.waitForURL(/#\/wallet\/account\/send\/simple\?/, { timeout: DEFAULT_TIMEOUT_MS });

    const url = page.url();
    expect(
      url,
      `the redirect dropped its query parameters (landed on ${url}) — getQueryParams()/` +
        'router.navigate({queryParams}) no longer forwards the QR-payment payload',
    ).toContain(`recipientRS=${TEST_ACCOUNT_2_RS}`);
    expect(url, `the redirect dropped the amount parameter (landed on ${url})`).toContain(
      `amount=${amount}`,
    );

    await expect(
      page.locator('app-send-simple input[name="recipientRS"]'),
      'the Send form did not prefill the recipient from the forwarded query params',
    ).toHaveValue(TEST_ACCOUNT_2_RS, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      page.locator('app-send-simple input[name="amount"]'),
      'the Send form did not prefill the amount from the forwarded query params',
    ).toHaveValue(amount, { timeout: DEFAULT_TIMEOUT_MS });

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('redirectTo')), {
        message:
          'the "redirectTo" key survived the redirect — every following login would be ' +
          'bounced to the same deep link instead of the dashboard',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toBeNull();

    await page.goto('#/wallet/dashboard');
    await expect(
      page.locator('app-dashboard .account-address'),
      'the dashboard did not come up after the consumed redirect',
    ).toHaveText(TEST_ACCOUNT_1_RS, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      page,
      'the dashboard redirected a second time — the hand-off is sticky',
    ).toHaveURL(/#\/wallet\/dashboard\b/, { timeout: DEFAULT_TIMEOUT_MS });
  });
});
