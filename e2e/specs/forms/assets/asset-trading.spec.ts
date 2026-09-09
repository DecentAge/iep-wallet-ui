import { test, expect, request as pwRequest, APIRequestContext, Page, Locator } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Asset trading desk (`#/wallet/assets/trade/:id{,/buy,/sell}`),
 * my-open-orders and my-transfers.
 *
 * Three things about this module are not obvious from the routes:
 *   - the buy/sell confirm pages are not archwizard steps but standalone
 *     routes fed by the static `DataStoreService` (`'buy-asset'` /
 *     `'sell-asset'`); they redirect back to the trade desk when that entry
 *     is missing, so `placeOrderClick()` is the only way in.
 *   - price and quantity pass through `amountToQuant` / 10^decimals and
 *     `shareToQuantity` before reaching the chain. The trading fixture is
 *     issued with decimals=2 so both conversions are real multiplications —
 *     at decimals=0 they collapse to the identity and any drift in the
 *     decimals handling would be invisible.
 *   - `my-open-orders` renders two `<app-open-orders>` panels side by side;
 *     its `buy`/`sell` child routes render the same page (no router-outlet).
 *
 * Re-runnable on one chain: each run issues its own randomly named assets and
 * cancels the orders it opened in `afterAll`.
 */

const API_BASE = process.env.API_BASE ?? `${apiOriginFromBaseURL(process.env.BASE_URL)}/api`;

/** Trading fixture: decimals=2, so 1000 QNT == 10.00 shares. */
const TRADE_DECIMALS = 2;
const TRADE_TOTAL_QNT = 1000;
/** Transfer fixture: decimals=0, see the send-assets test for why. */
const TRANSFER_DECIMALS = 0;
const TRANSFER_TOTAL_QNT = 1000;

const BUY_PRICE_XIN = 1;
const BUY_SHARES = 5;
/** Above BUY_PRICE_XIN so our own ask never crosses our own bid. */
const SELL_PRICE_XIN = 3;
const SELL_SHARES = 4;
const TRANSFER_SHARES = 10;

const TQT_PER_XIN = 100_000_000;

/** QNT the chain must record for a share count entered on the trade desk. */
const qnt = (shares: number) => String(shares * 10 ** TRADE_DECIMALS);
/** priceTQT the chain must record for a per-share XIN price. */
const tqt = (priceXin: number) => String((priceXin * TQT_PER_XIN) / 10 ** TRADE_DECIMALS);
/** How priceTqt/quantityQnt render a decimals=2 value in the datatables. */
const shown = (value: number) => value.toFixed(TRADE_DECIMALS);

/** Fixture txs are broadcast outside the browser, so they can't reuse
 *  broadcast-confirm's polling. Kept well under the 60s hook budget so a
 *  stalled devnet surfaces as the explicit error below, not as a hook timeout. */
const FIXTURE_CONFIRM_TIMEOUT_MS = 30_000;
const FIXTURE_POLL_INTERVAL_MS = 1_000;

let apiCtx: APIRequestContext;
let tradeAssetId: string;
let tradeAssetName: string;
let transferAssetId: string;
let transferAssetName: string;
let bidOrderId: string;
let askOrderId: string;

async function apiGet(params: Record<string, string>): Promise<any> {
  const resp = await apiCtx.get(API_BASE, { params, timeout: DEFAULT_TIMEOUT_MS });
  return resp.json();
}

async function apiPost(params: Record<string, string>): Promise<any> {
  const resp = await apiCtx.post(API_BASE, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams(params).toString(),
    timeout: DEFAULT_TIMEOUT_MS,
  });
  return resp.json();
}

/** Asset names are not chain-unique, but a fresh one gives a fresh, empty
 *  order book and an unambiguous marker in the datatables. */
function randomAssetName(): string {
  return `e2e${`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`.slice(-7)}`;
}

async function issueFixtureAsset(name: string, decimals: number, quantityQNT: number): Promise<string> {
  const created = await apiPost({
    requestType: 'issueAsset',
    name,
    description: 'e2e trading-desk fixture asset — devnet only',
    quantityQNT: String(quantityQNT),
    decimals: String(decimals),
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: String(TQT_PER_XIN),
    deadline: '80',
    broadcast: 'true',
  });
  if (!created.transaction || created.broadcasted !== true) {
    throw new Error(`issueAsset fixture "${name}" failed in beforeAll: ${JSON.stringify(created)}`);
  }
  return created.transaction;
}

/** Poll every listed tx to inclusion in a block, all under one deadline. */
async function awaitConfirmations(txIds: string[], what: string): Promise<void> {
  const deadline = Date.now() + FIXTURE_CONFIRM_TIMEOUT_MS;
  const pending = new Set(txIds);
  while (Date.now() < deadline) {
    for (const txId of [...pending]) {
      const tx = await apiGet({ requestType: 'getTransaction', transaction: txId });
      if (tx.block && typeof tx.confirmations === 'number') pending.delete(txId);
    }
    if (pending.size === 0) return;
    await new Promise((r) => setTimeout(r, FIXTURE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `${what} tx(s) ${[...pending].join(', ')} did not confirm within ${FIXTURE_CONFIRM_TIMEOUT_MS}ms ` +
    '— devnet forging stalled?',
  );
}

/** The confirm pages render every value as `<div class="ucsb">Label</div><h4>value</h4>`.
 *  Matching the label exactly also pins that the i18n key actually resolved. */
function confirmValue(page: Page, label: string): Locator {
  return page
    .locator('.card-block .col-md-6')
    .filter({ has: page.locator('.ucsb', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) })
    .locator('h4');
}

/** The desk's two order books. Each sits in the `col-md-6` half headed by its
 *  own title — note the halves are crossed: the "Buy" side (buy form, green)
 *  lists the *Sell Orders* you could buy from, and vice versa. */
function deskOrderBook(page: Page, title: 'Buy Orders' | 'Sell Orders'): Locator {
  return page
    .locator('div.col-md-6')
    .filter({ has: page.locator('h3.card-title', { hasText: new RegExp(`^\\s*${title}\\s*$`) }) })
    .locator('ngx-datatable');
}

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  tradeAssetName = randomAssetName();
  transferAssetName = randomAssetName();

  tradeAssetId = await issueFixtureAsset(tradeAssetName, TRADE_DECIMALS, TRADE_TOTAL_QNT);
  transferAssetId = await issueFixtureAsset(transferAssetName, TRANSFER_DECIMALS, TRANSFER_TOTAL_QNT);

  await awaitConfirmations([tradeAssetId, transferAssetId], 'issueAsset fixture');
});

test.afterAll(async () => {
  // Leaving orders open would lock balance/shares and push the next run's
  // orders off page 1 of my-open-orders. Never fail the run on cleanup —
  // but say so loudly, because a silent miss poisons the following run.
  const cancelTxIds: string[] = [];
  for (const [order, requestType] of [
    [bidOrderId, 'cancelBidOrder'],
    [askOrderId, 'cancelAskOrder'],
  ] as const) {
    if (!order) continue;
    try {
      const cancelled = await apiPost({
        requestType,
        order,
        secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
        feeTQT: String(TQT_PER_XIN),
        deadline: '80',
        broadcast: 'true',
      });
      if (cancelled.errorCode || !cancelled.transaction) {
        console.warn(`[asset-trading cleanup] ${requestType}(${order}) failed: ${JSON.stringify(cancelled)}`);
      } else {
        cancelTxIds.push(cancelled.transaction);
      }
    } catch (err) {
      console.warn(`[asset-trading cleanup] ${requestType}(${order}) threw: ${err}`);
    }
  }
  if (cancelTxIds.length) {
    try {
      await awaitConfirmations(cancelTxIds, 'order cancellation');
    } catch (err) {
      console.warn(`[asset-trading cleanup] ${err}`);
    }
  }
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test.describe.serial('asset trading desk', () => {
  test('trade-desk: buy form places a bid order and getBidOrder returns it', async ({ page, request, baseURL }) => {
    await page.goto(`#/wallet/assets/trade/${tradeAssetId}`);

    await expect(
      page.locator('h4', { hasText: tradeAssetName }).first(),
      `trade desk did not render asset "${tradeAssetName}" — getAsset(${tradeAssetId}) binding or the ` +
      `trade/:id route may be broken`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    // Buy and sell forms carry identical input names (price / quantity /
    // totalPrice); scope by the coloured place-order button each contains.
    const buyForm = page.locator('form').filter({ has: page.locator('button.btn-green.btn-create') });
    const buyButton = buyForm.locator('button.btn-green.btn-create');

    await expect(buyForm, 'buy-side order form did not mount on the trade desk').toHaveCount(1);

    await buyForm.locator('input[name="price"]').fill(String(BUY_PRICE_XIN));
    await buyForm.locator('input[name="quantity"]').fill(String(BUY_SHARES));
    await buyForm.locator('input[name="quantity"]').blur();

    // totalPrice is derived in buyFormOnChange() via numericalString (2 decimals)
    // and is in XIN — it must NOT be scaled by the asset's decimals.
    await expect(
      buyForm.locator('input[name="totalPrice"]'),
      'buy total did not recompute from price x quantity — buyFormOnChange() binding regressed',
    ).toHaveValue((BUY_PRICE_XIN * BUY_SHARES).toFixed(2), { timeout: DEFAULT_TIMEOUT_MS });

    await buyButton.click();

    // placeOrderClick('bid') stores the form in DataStoreService and routes to ./buy.
    await page.waitForURL(new RegExp(`#/wallet/assets/trade/${tradeAssetId}/buy$`), { timeout: DEFAULT_TIMEOUT_MS });

    // The confirm page redirects back to the desk when DataStoreService has no
    // 'buy-asset' entry, so every value below proves a piece of the hand-off.
    await expect(
      confirmValue(page, 'Asset Id'),
      'buy confirmation page did not render the asset id — the placeOrderClick DataStoreService ' +
      'hand-off is broken (a missing entry bounces back to the trade desk)',
    ).toHaveText(tradeAssetId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      confirmValue(page, 'Asset'),
      'buy confirmation page did not carry the asset name over from the trade desk',
    ).toHaveText(tradeAssetName);
    await expect(
      confirmValue(page, 'Price'),
      'buy confirmation page shows a different price than the one entered on the desk',
    ).toHaveText(`${BUY_PRICE_XIN.toFixed(2)} XIN`);
    await expect(
      confirmValue(page, 'Quantity'),
      'buy confirmation page shows a different quantity than the one entered on the desk',
    ).toHaveText(BUY_SHARES.toFixed(2));

    const finishButton = page.locator('button.btn-primary:has(i.fa-check)').first();
    await expect(
      finishButton,
      'Finish did not enable on the buy confirmation — placeBidOrder returned an error or ' +
      'client-side signing failed (validBytes never became true)',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);
    bidOrderId = txId;

    expect(tx.type, 'confirmed tx wrong type — expected Asset Exchange (2)').toBe(2);
    expect(tx.subtype, 'confirmed tx wrong subtype — expected BID_ORDER_PLACEMENT (3)').toBe(3);

    // Success alert carries the broadcast tx id — proves the wallet reported
    // the same transaction the chain accepted.
    await expect(
      page.locator('.swal2-container'),
      'no success alert after broadcasting the bid order',
    ).toContainText(txId, { timeout: DEFAULT_TIMEOUT_MS });

    const order = await apiGet({ requestType: 'getBidOrder', order: txId });
    expect(
      order.errorCode,
      `getBidOrder(${txId}) failed after broadcast — the bid was not registered as an open order: ` +
      JSON.stringify(order),
    ).toBeUndefined();
    expect(order.asset, 'bid order is on the wrong asset').toBe(tradeAssetId);
    expect(order.accountRS, 'bid order was not placed by TEST_ACCOUNT_1').toBe(TEST_ACCOUNT_1_RS);
    expect(
      order.quantityQNT,
      `bid quantityQNT wrong — entered ${BUY_SHARES} shares of a decimals=${TRADE_DECIMALS} asset, ` +
      'so shareToQuantity must scale it by 10^decimals',
    ).toBe(qnt(BUY_SHARES));
    expect(
      order.priceTQT,
      `bid priceTQT wrong — entered ${BUY_PRICE_XIN} XIN per share on a decimals=${TRADE_DECIMALS} ` +
      'asset; TradeDeskBuyAssetComponent must send amountToQuant(price) / 10^decimals per QNT',
    ).toBe(tqt(BUY_PRICE_XIN));

    // Dismissing the alert routes back to trade/:id — a sibling route, so the
    // desk re-inits and re-reads its books. The bid must now be in one.
    await page.locator('.swal2-container .swal2-confirm').click();
    await page.waitForURL(new RegExp(`#/wallet/assets/trade/${tradeAssetId}$`), { timeout: DEFAULT_TIMEOUT_MS });

    const bidBookRow = deskOrderBook(page, 'Buy Orders').locator('datatable-body-row');
    await expect(
      bidBookRow,
      'the trade desk\'s "Buy Orders" book does not show exactly the one bid open on this freshly ' +
      'issued asset — getAssetOrders(BID_ORDER) wiring in getBuyOrders() regressed',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    // Columns: price per share | quantity | sum | actions. The price cell is
    // the raw pipe output (no numericalString), the other two are formatted.
    await expect(
      bidBookRow.locator('datatable-body-cell').nth(0),
      'desk bid book shows the wrong price per share — pricePerShareBuyOrder must undo ' +
      'priceTQT-per-QNT with the desk\'s decimals',
    ).toHaveText(String(BUY_PRICE_XIN));
    await expect(
      bidBookRow.locator('datatable-body-cell').nth(1),
      'desk bid book shows the wrong quantity — quantityToShare must undo the 10^decimals scaling',
    ).toHaveText(shown(BUY_SHARES));
    await expect(
      bidBookRow.locator('datatable-body-cell').nth(2),
      'desk bid book shows the wrong sum — it must equal price x quantity in XIN',
    ).toHaveText(shown(BUY_PRICE_XIN * BUY_SHARES));
  });

  test('trade-desk: sell form places an ask order and getAskOrder returns it', async ({ page, request, baseURL }) => {
    await page.goto(`#/wallet/assets/trade/${tradeAssetId}`);

    const sellForm = page.locator('form').filter({ has: page.locator('button.btn-red.btn-create') });
    const sellButton = sellForm.locator('button.btn-red.btn-create');

    await expect(sellForm, 'sell-side order form did not mount on the trade desk').toHaveCount(1);

    await sellForm.locator('input[name="price"]').fill(String(SELL_PRICE_XIN));
    await sellForm.locator('input[name="quantity"]').fill(String(SELL_SHARES));
    await sellForm.locator('input[name="quantity"]').blur();

    await expect(
      sellForm.locator('input[name="totalPrice"]'),
      'sell total did not recompute from price x quantity — sellFormOnChange() binding regressed',
    ).toHaveValue((SELL_PRICE_XIN * SELL_SHARES).toFixed(2), { timeout: DEFAULT_TIMEOUT_MS });

    await sellButton.click();

    await page.waitForURL(new RegExp(`#/wallet/assets/trade/${tradeAssetId}/sell$`), { timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      confirmValue(page, 'Asset Id'),
      'sell confirmation page did not render the asset id — the DataStoreService "sell-asset" ' +
      'hand-off from placeOrderClick is broken',
    ).toHaveText(tradeAssetId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      confirmValue(page, 'Asset'),
      'sell confirmation page did not carry the asset name over from the trade desk',
    ).toHaveText(tradeAssetName);
    await expect(
      confirmValue(page, 'Price'),
      'sell confirmation page shows a different price than the one entered on the desk',
    ).toHaveText(`${SELL_PRICE_XIN.toFixed(2)} XIN`);
    // Unlike the buy page this one prints the raw quantity (no numberString pipe).
    await expect(
      confirmValue(page, 'Quantity'),
      'sell confirmation page shows a different quantity than the one entered on the desk',
    ).toHaveText(String(SELL_SHARES));

    const finishButton = page.locator('button.btn-primary:has(i.fa-check)').first();
    await expect(
      finishButton,
      'Finish did not enable on the sell confirmation — placeAskOrder returned an error or ' +
      'client-side signing failed (validBytes never became true)',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);
    askOrderId = txId;

    expect(tx.type, 'confirmed tx wrong type — expected Asset Exchange (2)').toBe(2);
    expect(tx.subtype, 'confirmed tx wrong subtype — expected ASK_ORDER_PLACEMENT (2)').toBe(2);

    await expect(
      page.locator('.swal2-container'),
      'no success alert after broadcasting the ask order',
    ).toContainText(txId, { timeout: DEFAULT_TIMEOUT_MS });

    const order = await apiGet({ requestType: 'getAskOrder', order: txId });
    expect(
      order.errorCode,
      `getAskOrder(${txId}) failed after broadcast — the ask was not registered as an open order: ` +
      JSON.stringify(order),
    ).toBeUndefined();
    expect(order.asset, 'ask order is on the wrong asset').toBe(tradeAssetId);
    expect(order.accountRS, 'ask order was not placed by TEST_ACCOUNT_1').toBe(TEST_ACCOUNT_1_RS);
    expect(
      order.quantityQNT,
      `ask quantityQNT wrong — ${SELL_SHARES} shares of a decimals=${TRADE_DECIMALS} asset must be ` +
      'scaled by 10^decimals (shareToQuantity)',
    ).toBe(qnt(SELL_SHARES));
    expect(
      order.priceTQT,
      'ask priceTQT wrong — check amountToQuant(price) / 10^decimals in TradeDeskSellAssetComponent',
    ).toBe(tqt(SELL_PRICE_XIN));

    // Neither order should have executed: ask (3 XIN) sits above bid (1 XIN).
    const trades = await apiGet({ requestType: 'getTrades', asset: tradeAssetId });
    expect(
      Array.isArray(trades.trades),
      `getTrades(asset=${tradeAssetId}) did not answer with a trades array: ${JSON.stringify(trades)}`,
    ).toBe(true);
    expect(
      (trades.trades ?? []).length,
      'the ask crossed the bid and traded — the spec\'s non-crossing price assumption no longer holds, ' +
      'so the my-open-orders assertions below would be testing nothing',
    ).toBe(0);

    await page.locator('.swal2-container .swal2-confirm').click();
    await page.waitForURL(new RegExp(`#/wallet/assets/trade/${tradeAssetId}$`), { timeout: DEFAULT_TIMEOUT_MS });

    const askBookRow = deskOrderBook(page, 'Sell Orders').locator('datatable-body-row');
    await expect(
      askBookRow,
      'the trade desk\'s "Sell Orders" book does not show exactly the one ask open on this freshly ' +
      'issued asset — getAssetOrders(ASK_ORDER) wiring in getSellOrders() regressed',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      askBookRow.locator('datatable-body-cell').nth(0),
      'desk ask book shows the wrong price per share',
    ).toHaveText(shown(SELL_PRICE_XIN));
    await expect(
      askBookRow.locator('datatable-body-cell').nth(1),
      'desk ask book shows the wrong quantity — quantityToShare must undo the 10^decimals scaling',
    ).toHaveText(shown(SELL_SHARES));
    await expect(
      askBookRow.locator('datatable-body-cell').nth(2),
      'desk ask book shows the wrong sum — it must equal price x quantity in XIN',
    ).toHaveText(shown(SELL_PRICE_XIN * SELL_SHARES));
  });

  test('my-open-orders: both panels render exactly what getAccountCurrent{Bid,Ask}Orders returned', async ({ page }) => {
    expect(bidOrderId, 'bid order was never placed — the buy test must run first').toBeTruthy();
    expect(askOrderId, 'ask order was never placed — the sell test must run first').toBeTruthy();

    // Capture the responses the two panels themselves receive, so the DOM is
    // compared against the exact payload the component got — not against a
    // separate API call that could have been answered at a different height.
    const bidsResponse = page.waitForResponse(
      (r) => r.url().includes('requestType=getAccountCurrentBidOrders'),
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    const asksResponse = page.waitForResponse(
      (r) => r.url().includes('requestType=getAccountCurrentAskOrders'),
      { timeout: DEFAULT_TIMEOUT_MS },
    );

    await page.goto('#/wallet/assets/my-open-orders');

    const bids = await bidsResponse.then((r) => r.json()).catch(() => {
      throw new Error('my-open-orders never called getAccountCurrentBidOrders — the Buy panel did not ' +
        'mount or OpenOrdersComponent.setPage() no longer fires on init');
    });
    const asks = await asksResponse.then((r) => r.json()).catch(() => {
      throw new Error('my-open-orders never called getAccountCurrentAskOrders — the Sell panel did not ' +
        'mount or OpenOrdersComponent.setPage() no longer fires on init');
    });

    const bidOrders: any[] = bids.bidOrders ?? [];
    const askOrders: any[] = asks.askOrders ?? [];
    expect(
      bidOrders.map((o: any) => o.order),
      `getAccountCurrentBidOrders page 1 does not list bid ${bidOrderId} — either it was matched/cancelled, ` +
      'or stale open orders from earlier runs pushed it off page 1 (cancel them and re-run)',
    ).toContain(bidOrderId);
    expect(
      askOrders.map((o: any) => o.order),
      `getAccountCurrentAskOrders page 1 does not list ask ${askOrderId} — either it was matched/cancelled, ` +
      'or stale open orders from earlier runs pushed it off page 1 (cancel them and re-run)',
    ).toContain(askOrderId);

    // Panel titles come from separate i18n keys; assert the translated text,
    // since the raw keys ("…my-open-orders.buy-title") would still match /buy/i.
    const buyPanel = page.locator('app-open-orders')
      .filter({ has: page.locator('h3.card-title', { hasText: /^\s*Buy Offers\s*$/ }) });
    const sellPanel = page.locator('app-open-orders')
      .filter({ has: page.locator('h3.card-title', { hasText: /^\s*Sell Offers\s*$/ }) });

    await expect(
      buyPanel,
      'my-open-orders did not render a panel titled "Buy Offers" — expected two <app-open-orders> ' +
      'side by side, each titled from its own translated i18n key',
    ).toHaveCount(1);
    await expect(
      sellPanel,
      'my-open-orders did not render a panel titled "Sell Offers" — expected two <app-open-orders> ' +
      'side by side, each titled from its own translated i18n key',
    ).toHaveCount(1);

    const buyRow = buyPanel.locator('datatable-body-row', { hasText: tradeAssetName });
    await expect(
      buyRow,
      `the bid order on "${tradeAssetName}" is missing from the Buy panel although ` +
      `getAccountCurrentBidOrders returned it — check the rows binding in OpenOrdersComponent.setPage()`,
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    // Columns: asset name | price (priceTqt pipe) | quantity (quantityQnt pipe) | actions.
    await expect(
      buyRow.locator('datatable-body-cell').nth(0),
      'Buy panel names the wrong asset',
    ).toHaveText(tradeAssetName);
    await expect(
      buyRow.locator('datatable-body-cell').nth(1),
      `Buy panel shows the wrong price — priceTqt must turn ${tqt(BUY_PRICE_XIN)} TQT/QNT back into ` +
      `${BUY_PRICE_XIN} XIN/share using the row's decimals`,
    ).toHaveText(shown(BUY_PRICE_XIN));
    await expect(
      buyRow.locator('datatable-body-cell').nth(2),
      `Buy panel shows the wrong quantity — quantityQnt must turn ${qnt(BUY_SHARES)} QNT back into ` +
      `${BUY_SHARES} shares using the row's decimals`,
    ).toHaveText(shown(BUY_SHARES));

    const sellRow = sellPanel.locator('datatable-body-row', { hasText: tradeAssetName });
    await expect(
      sellRow,
      `the ask order on "${tradeAssetName}" is missing from the Sell panel although ` +
      'getAccountCurrentAskOrders returned it — check the rows binding in OpenOrdersComponent.setPage()',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      sellRow.locator('datatable-body-cell').nth(0),
      'Sell panel names the wrong asset',
    ).toHaveText(tradeAssetName);
    await expect(
      sellRow.locator('datatable-body-cell').nth(1),
      'Sell panel shows the wrong price',
    ).toHaveText(shown(SELL_PRICE_XIN));
    await expect(
      sellRow.locator('datatable-body-cell').nth(2),
      'Sell panel shows the wrong quantity',
    ).toHaveText(shown(SELL_SHARES));

    // Each panel must render every order it was handed and no extras — a
    // stale, truncated or double-rendered datatable diverges here.
    await expect(
      buyPanel.locator('datatable-body-row'),
      `Buy panel rendered a different number of rows than the ${bidOrders.length} bid order(s) its own ` +
      'getAccountCurrentBidOrders response contained',
    ).toHaveCount(bidOrders.length);
    await expect(
      sellPanel.locator('datatable-body-row'),
      `Sell panel rendered a different number of rows than the ${askOrders.length} ask order(s) its own ` +
      'getAccountCurrentAskOrders response contained',
    ).toHaveCount(askOrders.length);
  });

  test('send-assets: transfer to TEST_ACCOUNT_2 lands in getAssetTransfers and my-transfers', async ({ page, request, baseURL }) => {
    // Uses the decimals=0 fixture on purpose: send-assets passes the "Shares"
    // input straight through as quantityQNT (see the skipped test below), so
    // only at decimals=0 do "shares entered" and "QNT on chain" agree.
    await page.goto('#/wallet/assets/send-assets');

    const assetIdInput = page.locator('input[name="assetId"]');
    const nextButton = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

    await expect(assetIdInput, 'send-assets form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    await assetIdInput.fill(transferAssetId);
    await page.locator('input[name="shares"]').fill(String(TRANSFER_SHARES));
    await page.locator('input[name="recipientRS"]').fill(TEST_ACCOUNT_2_RS);
    await page.locator('input[name="recipientRS"]').blur();

    await expect(nextButton, 'Next did not enable after assetId + shares + recipientRS').toBeEnabled({
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await nextButton.click();

    // Confirm step echoes what step 1 collected.
    await expect(
      page.locator('aw-wizard-step h4').first(),
      'confirm step does not show the asset id entered in step 1',
    ).toHaveText(transferAssetId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      page.locator('aw-wizard-step h4').nth(1),
      'confirm step does not show the share count entered in step 1',
    ).toHaveText(String(TRANSFER_SHARES));

    const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
    await expect(
      finishButton,
      'Finish did not enable — ASSET_TRANSFER signing failed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

    expect(tx.type, 'confirmed tx wrong type — expected Asset Exchange (2)').toBe(2);
    expect(tx.subtype, 'confirmed tx wrong subtype — expected ASSET_TRANSFER (1)').toBe(1);
    expect(tx.recipientRS, 'transfer recipient on chain is not TEST_ACCOUNT_2').toBe(TEST_ACCOUNT_2_RS);

    const held = await apiGet({
      requestType: 'getAccountAssets', account: TEST_ACCOUNT_2_RS, asset: transferAssetId,
    });
    expect(
      held.errorCode,
      `getAccountAssets failed for TEST_ACCOUNT_2 after transfer ${txId}: ${JSON.stringify(held)}`,
    ).toBeUndefined();
    expect(
      held.quantityQNT,
      `TEST_ACCOUNT_2 does not hold the ${TRANSFER_SHARES} transferred shares of ${transferAssetId}`,
    ).toBe(String(TRANSFER_SHARES));

    const transfers = await apiGet({
      requestType: 'getAssetTransfers', asset: transferAssetId, includeAssetInfo: 'true',
    });
    const mine = (transfers.transfers ?? []).find((t: any) => t.assetTransfer === txId);
    expect(
      mine,
      `getAssetTransfers(asset=${transferAssetId}) has no entry for transfer ${txId} — ` +
      `it returned ${JSON.stringify(transfers.transfers ?? [])}`,
    ).toBeTruthy();
    expect(mine.senderRS, 'transfer sender on chain is not TEST_ACCOUNT_1').toBe(TEST_ACCOUNT_1_RS);
    expect(mine.recipientRS, 'transfer recipient on chain is not TEST_ACCOUNT_2').toBe(TEST_ACCOUNT_2_RS);
    expect(mine.quantityQNT, 'transferred quantityQNT does not match the entered share count')
      .toBe(String(TRANSFER_SHARES));

    // Dismiss the success alert; its OK handler routes to show-assets.
    const swal = page.locator('.swal2-container');
    await expect(swal, 'no success alert after broadcasting the asset transfer').toContainText(txId, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await swal.locator('.swal2-confirm').click();
    await expect(swal).toBeHidden({ timeout: DEFAULT_TIMEOUT_MS });

    await page.goto('#/wallet/assets/my-transfers');
    const transferRow = page.locator('datatable-body-row', { hasText: transferAssetName });
    await expect(
      transferRow,
      `my-transfers does not list the transfer of "${transferAssetName}" although getAssetTransfers ` +
      'reports it — check MyTransfersComponent.setPage() / getAllLastTransfers',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    // Columns: date | name | quantity (supply pipe) | recipient | actions.
    await expect(
      transferRow.locator('datatable-body-cell').nth(1),
      'my-transfers row names the wrong asset',
    ).toHaveText(transferAssetName);
    await expect(
      transferRow.locator('datatable-body-cell').nth(2),
      'my-transfers quantity cell does not show the transferred share count',
    ).toHaveText(String(TRANSFER_SHARES));
    await expect(
      transferRow.locator('datatable-body-cell').nth(3),
      'my-transfers row does not name TEST_ACCOUNT_2 as the recipient',
    ).toHaveText(TEST_ACCOUNT_2_RS);
  });

  // The trade desk scales share input by the asset's decimals
  // (shareToQuantityPipe), and so does show-assets' transfer-asset component
  // (transfer-asset.component.ts:99). send-assets does not: it hands
  // `sendAssetForm.shares` to assetsService.transferAsset() unchanged, which
  // sends it as `quantityQNT` — so on a decimals=2 asset "10 Shares" moves
  // 0.10 shares. The label ("Shares") and popover ("The number of shares to
  // send.") say otherwise. Un-skip once send-assets applies the pipe.
  test.skip('send-assets: the Shares input is scaled by the asset decimals', async ({ page, request, baseURL }) => {
    await page.goto('#/wallet/assets/send-assets');

    await page.locator('input[name="assetId"]').fill(tradeAssetId);
    await page.locator('input[name="shares"]').fill('1');
    await page.locator('input[name="recipientRS"]').fill(TEST_ACCOUNT_2_RS);
    await page.locator('input[name="recipientRS"]').blur();
    await page.locator('button.btn-gradient:has(i.fa-chevron-right)').first().click();

    const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
    await expect(finishButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const { txId } = await broadcastAndAwaitConfirmation(
      page, request, apiOriginFromBaseURL(baseURL), finishButton,
    );

    const held = await apiGet({
      requestType: 'getAccountAssets', account: TEST_ACCOUNT_2_RS, asset: tradeAssetId,
    });
    expect(
      held.quantityQNT,
      `transfer ${txId} moved the "Shares" value as raw QNT — 1 share of a decimals=${TRADE_DECIMALS} ` +
      `asset must be ${qnt(1)} QNT`,
    ).toBe(qnt(1));
  });
});
