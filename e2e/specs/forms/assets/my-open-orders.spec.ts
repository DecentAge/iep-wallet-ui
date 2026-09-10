import { test, expect } from '../../../fixtures/test';
import { request as pwRequest, APIRequestContext, Page, Locator } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Asset order management (`#/wallet/assets/my-open-orders{,/buy,/sell}` and the
 * `open-orders/*` row actions).
 *
 * Risk: cancel-order is a signing mask whose whole payload — which order, bid or
 * ask — arrives through `DataStoreService`, and the two panels render priceTQT /
 * quantityQNT back through `priceTqt` / `quantityQnt` with the row's own
 * `decimals`. A lost hand-off cancels a *plausible* other order, and a decimals
 * slip misprices every row by 10^n. Both survive a route smoke test. So: orders
 * are seeded through the node API with exact QNT/TQT values, the cancel itself
 * goes through the UI, and every number is pinned against getBidOrder /
 * getAskOrder rather than against the form that produced it.
 *
 * Re-runnable on one chain: a fresh, randomly named decimals=2 asset per run,
 * and `afterAll` cancels whatever the run left open.
 */

const API_BASE = process.env.API_BASE ?? `${apiOriginFromBaseURL(process.env.BASE_URL)}/api`;

const TQT_PER_XIN = 100_000_000;
/** decimals=2 so every QNT/TQT conversion is a real multiplication, not the identity. */
const ORDER_DECIMALS = 2;
const ASSET_TOTAL_QNT = 100_000;

const BID_PRICE_XIN = 2;
const BID_SHARES = 3;
/** Above the bid so the two orders never cross and both stay open. */
const ASK_PRICE_XIN = 7;
const ASK_SHARES = 4;

/** `CancelOrderComponent.cancelOrder()` hard-codes fee = 1 XIN. */
const CANCEL_FEE_TQT = String(TQT_PER_XIN);

/** How many orders the datatable shows per page (`Page.size`). */
const PAGE_SIZE = 10;

const FIXTURE_CONFIRM_TIMEOUT_MS = 40_000;
const FIXTURE_POLL_INTERVAL_MS = 1_000;

/** QNT the chain must hold for a share count of a decimals=2 asset. */
const qnt = (shares: number) => String(shares * 10 ** ORDER_DECIMALS);
/** priceTQT the chain must hold for a per-share XIN price. */
const tqt = (priceXin: number) => String((priceXin * TQT_PER_XIN) / 10 ** ORDER_DECIMALS);
/** How `priceTqt` / `quantityQnt` / `supply` render a decimals=2 value. */
const shown = (value: number) => value.toFixed(ORDER_DECIMALS);

let apiCtx: APIRequestContext;
let assetId: string;
let assetName: string;
let bidOrderId: string;
let askOrderId: string;
/** Every order this run opened; `afterAll` cancels the ones still on chain. */
const openedOrders: Array<{ order: string; type: 'bid' | 'ask' }> = [];

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

function randomAssetName(): string {
  return `e2e${`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`.slice(-7)}`;
}

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

/** Seed an order outside the browser; the write under test is the cancel. */
async function seedOrder(type: 'bid' | 'ask', priceXin: number, shares: number): Promise<string> {
  const placed = await apiPost({
    requestType: type === 'bid' ? 'placeBidOrder' : 'placeAskOrder',
    asset: assetId,
    quantityQNT: qnt(shares),
    priceTQT: tqt(priceXin),
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: String(TQT_PER_XIN),
    deadline: '80',
    broadcast: 'true',
  });
  if (!placed.transaction || placed.broadcasted !== true) {
    throw new Error(`seeding a ${type} order failed: ${JSON.stringify(placed)}`);
  }
  openedOrders.push({ order: placed.transaction, type });
  return placed.transaction;
}

/** One of the two `<app-open-orders>` panels, identified by its translated title. */
function panel(page: Page, title: 'Buy Offers' | 'Sell Offers'): Locator {
  return page
    .locator('app-open-orders')
    .filter({ has: page.locator('h3.card-title', { hasText: new RegExp(`^\\s*${title}\\s*$`) }) });
}

/** The trade desk's two order books; the halves are crossed (see asset-trading.spec.ts). */
function deskBook(page: Page, title: 'Buy Orders' | 'Sell Orders'): Locator {
  return page
    .locator('div.col-md-6')
    .filter({ has: page.locator('h3.card-title', { hasText: new RegExp(`^\\s*${title}\\s*$`) }) })
    .locator('ngx-datatable');
}

/** `<div class="ucsb">Label</div><h4>value</h4>` on the cancel confirmation. */
function confirmField(page: Page, label: string): Locator {
  return page
    .locator('app-cancel-order .card-block .col-md-6')
    .filter({ has: page.locator('.ucsb', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) })
    .locator('h4')
    .first();
}

/** Navigate to my-open-orders and return the panel's own order response. */
async function openPanelPage(page: Page, type: 'bid' | 'ask', path: string): Promise<any[]> {
  const requestType = type === 'bid' ? 'getAccountCurrentBidOrders' : 'getAccountCurrentAskOrders';
  const captured = page.waitForResponse((r) => r.url().includes(`requestType=${requestType}`), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await page.goto(path);
  const body = await captured.then((r) => r.json()).catch(() => {
    throw new Error(
      `${path} never called ${requestType} — the ${type === 'bid' ? 'Buy' : 'Sell'} panel did not mount ` +
      'or OpenOrdersComponent.setPage() no longer fires on init',
    );
  });
  return (type === 'bid' ? body.bidOrders : body.askOrders) ?? [];
}

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();
  assetName = randomAssetName();

  const issued = await apiPost({
    requestType: 'issueAsset',
    name: assetName,
    description: 'e2e my-open-orders fixture asset — devnet only',
    quantityQNT: String(ASSET_TOTAL_QNT),
    decimals: String(ORDER_DECIMALS),
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: String(TQT_PER_XIN),
    deadline: '80',
    broadcast: 'true',
  });
  if (!issued.transaction || issued.broadcasted !== true) {
    throw new Error(`issueAsset fixture "${assetName}" failed in beforeAll: ${JSON.stringify(issued)}`);
  }
  assetId = issued.transaction;
  await awaitConfirmations([assetId], 'issueAsset fixture');

  bidOrderId = await seedOrder('bid', BID_PRICE_XIN, BID_SHARES);
  askOrderId = await seedOrder('ask', ASK_PRICE_XIN, ASK_SHARES);
  await awaitConfirmations([bidOrderId, askOrderId], 'order seeding');
});

test.afterAll(async () => {
  // Orders left open lock balance/shares and push the next run's rows off page 1.
  // Never fail the run on cleanup — but say so loudly, a silent miss poisons the next run.
  const cancelTxIds: string[] = [];
  const seen = new Set<string>();
  for (const { order, type } of openedOrders) {
    if (seen.has(order)) continue;
    seen.add(order);
    try {
      const still = await apiGet({
        requestType: type === 'bid' ? 'getBidOrder' : 'getAskOrder',
        order,
      });
      if (still.errorCode) continue; // already cancelled through the UI
      const cancelled = await apiPost({
        requestType: type === 'bid' ? 'cancelBidOrder' : 'cancelAskOrder',
        order,
        secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
        feeTQT: String(TQT_PER_XIN),
        deadline: '80',
        broadcast: 'true',
      });
      if (cancelled.errorCode || !cancelled.transaction) {
        console.warn(`[my-open-orders cleanup] cancel ${type} ${order} failed: ${JSON.stringify(cancelled)}`);
      } else {
        cancelTxIds.push(cancelled.transaction);
      }
    } catch (err) {
      console.warn(`[my-open-orders cleanup] cancel ${type} ${order} threw: ${err}`);
    }
  }
  if (cancelTxIds.length) {
    try {
      await awaitConfirmations(cancelTxIds, 'cleanup cancellation');
    } catch (err) {
      console.warn(`[my-open-orders cleanup] ${err}`);
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

test.describe.serial('asset order management', () => {
  test('my-open-orders/buy: the Buy panel shows the open bid with the values getBidOrder reports', async ({ page }) => {
    const order = await apiGet({ requestType: 'getBidOrder', order: bidOrderId });
    expect(
      order.errorCode,
      `getBidOrder(${bidOrderId}) failed although the order was seeded and confirmed: ${JSON.stringify(order)}`,
    ).toBeUndefined();
    expect(order.asset, 'the seeded bid sits on a different asset than the fixture').toBe(assetId);
    expect(order.accountRS, 'the seeded bid was not placed by TEST_ACCOUNT_1').toBe(TEST_ACCOUNT_1_RS);
    expect(order.quantityQNT, 'the chain holds a different quantityQNT than the one seeded').toBe(qnt(BID_SHARES));
    expect(order.priceTQT, 'the chain holds a different priceTQT than the one seeded').toBe(tqt(BID_PRICE_XIN));
    expect(
      order.decimals,
      'the fixture asset lost its decimals — without them the pipe assertions below test nothing',
    ).toBe(ORDER_DECIMALS);

    const bidOrders = await openPanelPage(page, 'bid', '#/wallet/assets/my-open-orders/buy');

    await expect(
      page,
      'the legacy deep link assets/my-open-orders/buy did not resolve to the combined two-panel page — ' +
      'a dead route here drops the user on the dashboard instead',
    ).toHaveURL(/#\/wallet\/assets\/my-open-orders$/, { timeout: DEFAULT_TIMEOUT_MS });

    expect(
      bidOrders.map((o: any) => o.order),
      `getAccountCurrentBidOrders page 1 does not list bid ${bidOrderId} — it was matched or cancelled, or ` +
      'stale orders from an earlier run pushed it off page 1 (cancel them and re-run)',
    ).toContain(bidOrderId);

    const buyPanel = panel(page, 'Buy Offers');
    await expect(
      buyPanel,
      'my-open-orders rendered no panel titled "Buy Offers" — the offerTypeInput binding or the i18n key regressed',
    ).toHaveCount(1);

    const buyRow = buyPanel.locator('datatable-body-row', { hasText: assetName });
    await expect(
      buyRow,
      `the bid on "${assetName}" is missing from the Buy panel although getAccountCurrentBidOrders returned ` +
      'it — check the rows binding in OpenOrdersComponent.setPage()',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    // Columns: asset | price (priceTqt) | quantity (quantityQnt) | actions.
    await expect(buyRow.locator('datatable-body-cell').nth(0), 'the Buy row names the wrong asset').toHaveText(
      assetName,
    );
    await expect(
      buyRow.locator('datatable-body-cell').nth(1),
      `the Buy row shows the wrong price — priceTqt must turn ${tqt(BID_PRICE_XIN)} TQT/QNT back into ` +
      `${BID_PRICE_XIN} XIN per share using the row's decimals=${ORDER_DECIMALS}`,
    ).toHaveText(shown(BID_PRICE_XIN));
    await expect(
      buyRow.locator('datatable-body-cell').nth(2),
      `the Buy row shows the wrong quantity — quantityQnt must turn ${qnt(BID_SHARES)} QNT back into ` +
      `${BID_SHARES} shares using the row's decimals=${ORDER_DECIMALS}`,
    ).toHaveText(shown(BID_SHARES));

    // The ask on the same asset differs in price and quantity, so the cell
    // assertions above already fail if the two panels' bindings are swapped.
    await expect(
      buyPanel.locator('datatable-body-row'),
      `the Buy panel rendered a different number of rows than the ${bidOrders.length} bid order(s) its own ` +
      'getAccountCurrentBidOrders response contained',
    ).toHaveCount(bidOrders.length);
  });

  test('my-open-orders/sell: the Sell panel shows the open ask with the values getAskOrder reports', async ({ page }) => {
    const order = await apiGet({ requestType: 'getAskOrder', order: askOrderId });
    expect(
      order.errorCode,
      `getAskOrder(${askOrderId}) failed although the order was seeded and confirmed: ${JSON.stringify(order)}`,
    ).toBeUndefined();
    expect(order.asset, 'the seeded ask sits on a different asset than the fixture').toBe(assetId);
    expect(order.accountRS, 'the seeded ask was not placed by TEST_ACCOUNT_1').toBe(TEST_ACCOUNT_1_RS);
    expect(order.quantityQNT, 'the chain holds a different quantityQNT than the one seeded').toBe(qnt(ASK_SHARES));
    expect(order.priceTQT, 'the chain holds a different priceTQT than the one seeded').toBe(tqt(ASK_PRICE_XIN));

    const askOrders = await openPanelPage(page, 'ask', '#/wallet/assets/my-open-orders/sell');

    await expect(
      page,
      'the legacy deep link assets/my-open-orders/sell did not resolve to the combined two-panel page',
    ).toHaveURL(/#\/wallet\/assets\/my-open-orders$/, { timeout: DEFAULT_TIMEOUT_MS });

    expect(
      askOrders.map((o: any) => o.order),
      `getAccountCurrentAskOrders page 1 does not list ask ${askOrderId} — it was matched or cancelled, or ` +
      'stale orders from an earlier run pushed it off page 1',
    ).toContain(askOrderId);

    const sellPanel = panel(page, 'Sell Offers');
    await expect(
      sellPanel,
      'my-open-orders rendered no panel titled "Sell Offers" — the offerTypeInput binding or the i18n key regressed',
    ).toHaveCount(1);

    const sellRow = sellPanel.locator('datatable-body-row', { hasText: assetName });
    await expect(
      sellRow,
      `the ask on "${assetName}" is missing from the Sell panel although getAccountCurrentAskOrders returned it`,
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    await expect(sellRow.locator('datatable-body-cell').nth(0), 'the Sell row names the wrong asset').toHaveText(
      assetName,
    );
    await expect(
      sellRow.locator('datatable-body-cell').nth(1),
      `the Sell row shows the wrong price — priceTqt must turn ${tqt(ASK_PRICE_XIN)} TQT/QNT back into ` +
      `${ASK_PRICE_XIN} XIN per share`,
    ).toHaveText(shown(ASK_PRICE_XIN));
    await expect(
      sellRow.locator('datatable-body-cell').nth(2),
      `the Sell row shows the wrong quantity — quantityQnt must turn ${qnt(ASK_SHARES)} QNT back into ` +
      `${ASK_SHARES} shares`,
    ).toHaveText(shown(ASK_SHARES));

    await expect(
      sellPanel.locator('datatable-body-row'),
      `the Sell panel rendered a different number of rows than the ${askOrders.length} ask order(s) its own ` +
      'getAccountCurrentAskOrders response contained',
    ).toHaveCount(askOrders.length);
  });

  test('open-orders/asset-details: the asset link opens the asset the order is on', async ({ page }) => {
    await openPanelPage(page, 'bid', '#/wallet/assets/my-open-orders');

    const buyRow = panel(page, 'Buy Offers').locator('datatable-body-row', { hasText: assetName });
    await expect(buyRow, `the Buy panel has no row for "${assetName}"`).toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    await buyRow.locator('a.hyperlink').first().click();
    await page.waitForURL(/#\/wallet\/assets\/open-orders\/asset-details\?id=\d+$/, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    expect(
      page.url(),
      `asset-details was opened for a different asset than the row's ${assetId} — goToAssetDetails() is ` +
      'handed the wrong column (the row action takes its id from row.asset, not from the order id)',
    ).toContain(`id=${assetId}`);

    const asset = await apiGet({ requestType: 'getAsset', asset: assetId });
    expect(asset.errorCode, `the node does not know asset ${assetId}: ${JSON.stringify(asset)}`).toBeUndefined();

    // Fields: name | description | issuer | asset id | initial supply | current
    // supply | decimals | shareholders | trades | transfers.
    const fields = page.locator('app-asset-details h4');
    await expect(
      fields.nth(0),
      `asset-details did not render the name the node reports for ${assetId} (${asset.name}) — the ` +
      'queryParams id never reached getAsset',
    ).toHaveText(asset.name, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      fields.nth(2),
      `asset-details names an issuer the node does not report for ${assetId} (${asset.accountRS})`,
    ).toHaveText(asset.accountRS);
    await expect(fields.nth(3), 'asset-details renders an asset id other than the one in the URL').toHaveText(
      assetId,
    );
    await expect(
      fields.nth(6),
      `asset-details shows the wrong decimals for ${assetId} (node says ${asset.decimals}) — every price and ` +
      'quantity in this module is scaled by that number',
    ).toHaveText(String(asset.decimals));
  });

  test('open-orders/transaction-details: the details action opens the order placement transaction', async ({ page }) => {
    await openPanelPage(page, 'bid', '#/wallet/assets/my-open-orders');

    const buyRow = panel(page, 'Buy Offers').locator('datatable-body-row', { hasText: assetName });
    await expect(buyRow, `the Buy panel has no row for "${assetName}"`).toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    await buyRow.locator('a:has(i.fa-list-ul)').click();
    await page.waitForURL(/#\/wallet\/assets\/open-orders\/transaction-details$/, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    const tx = await apiGet({ requestType: 'getTransaction', transaction: bidOrderId });
    expect(tx.errorCode, `the node does not know the bid placement tx ${bidOrderId}`).toBeUndefined();

    // Fields: id | block | time | height | confirmations | type | amount | fee |
    // message | sender | recipient | phased.
    const fields = page.locator('app-transaction-detail h4');
    await expect(
      fields.nth(0),
      `transaction-details shows a transaction other than the bid order ${bidOrderId} — the route names no ` +
      'subject, so a lost DataStoreService entry renders a plausible page about the wrong transaction',
    ).toHaveText(bidOrderId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      fields.nth(1),
      `transaction-details shows the wrong block for ${bidOrderId} (node says ${tx.block})`,
    ).toHaveText(tx.block);
    await expect(
      fields.nth(5),
      'transaction-details does not label the bid placement as "Bid Order Placement" — the ' +
      'transactionTextSubType mapping for type 2 / subtype 3 regressed',
    ).toHaveText('Bid Order Placement');
    await expect(
      fields.nth(9),
      `transaction-details names a sender the node does not report for ${bidOrderId} (${tx.senderRS})`,
    ).toHaveText(TEST_ACCOUNT_1_RS);
  });

  test('open-orders/trade-desk: the trade-desk action opens the desk for the asset the order is on', async ({ page }) => {
    await openPanelPage(page, 'bid', '#/wallet/assets/my-open-orders');

    const buyRow = panel(page, 'Buy Offers').locator('datatable-body-row', { hasText: assetName });
    await expect(buyRow, `the Buy panel has no row for "${assetName}"`).toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    await buyRow.locator('a:has(i.fa-bar-chart)').click();
    await expect(
      page,
      `the trade-desk action opened a desk other than assets/trade/${assetId} — goToTradeDesk() is handed the ` +
      'wrong column (row.order instead of row.asset), and a wrong id still lands on the live route, showing a ' +
      'plausible desk for the wrong asset',
    ).toHaveURL(new RegExp(`#/wallet/assets/trade/${assetId}$`), { timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      page.locator('h4', { hasText: assetName }).first(),
      `the desk reached from the row does not name "${assetName}" — the id in the URL never reached getAsset`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  });

  test('open-orders/cancel-order: cancelling the bid clears it from chain, list and order book', async ({
    page,
    request,
    baseURL,
    infoAlerts,
  }) => {
    await openPanelPage(page, 'bid', '#/wallet/assets/my-open-orders');

    const buyRow = panel(page, 'Buy Offers').locator('datatable-body-row', { hasText: assetName });
    await expect(buyRow, `the Buy panel has no row for "${assetName}"`).toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    await buyRow.locator('a:has(i.fa-times)').click();
    await page.waitForURL(/#\/wallet\/assets\/open-orders\/cancel-order$/, { timeout: DEFAULT_TIMEOUT_MS });

    // Everything the page is about to sign came over in DataStoreService('offer-details').
    await expect(
      confirmField(page, 'Bid Order Id'),
      'the cancel confirmation does not show the bid order id — the offer-details hand-off from ' +
      'goToCancelOrder() is broken, and a missing entry silently sends the user back',
    ).toHaveText(bidOrderId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      confirmField(page, 'Asset'),
      'the cancel confirmation names an asset other than the one in the clicked row',
    ).toHaveText(assetName);
    await expect(
      confirmField(page, 'Price'),
      `the cancel confirmation misprices the order — ${tqt(BID_PRICE_XIN)} TQT/QNT on a ` +
      `decimals=${ORDER_DECIMALS} asset is ${BID_PRICE_XIN} XIN per share`,
    ).toHaveText(new RegExp(`^\\s*${shown(BID_PRICE_XIN)}\\s+XIN\\s*$`));
    await expect(
      confirmField(page, 'Quantity'),
      `the cancel confirmation shows the wrong quantity — ${qnt(BID_SHARES)} QNT is ${BID_SHARES} shares`,
    ).toHaveText(shown(BID_SHARES));

    const finishButton = page.locator('button.btn-primary:has(i.fa-check)').first();
    await expect(
      finishButton,
      'Finish never enabled on the cancel confirmation — cancelBidOrder returned an error or client-side ' +
      'signing failed (validBytes never became true)',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const { txId, tx } = await broadcastAndAwaitConfirmation(
      page,
      request,
      apiOriginFromBaseURL(baseURL),
      finishButton,
    );

    expect(tx.type, 'the cancellation has the wrong type — expected Asset Exchange (2)').toBe(2);
    expect(
      tx.subtype,
      'the cancellation has the wrong subtype — expected BID_ORDER_CANCELLATION (5); subtype 4 would mean the ' +
      'component asked for cancelAskOrder on a bid',
    ).toBe(5);
    expect(
      tx.attachment?.order,
      `the cancellation attachment names order ${tx.attachment?.order} instead of the bid ${bidOrderId} that ` +
      'was clicked',
    ).toBe(bidOrderId);
    expect(
      tx.feeTQT,
      'the cancellation was signed with a fee other than the 1 XIN CancelOrderComponent hard-codes',
    ).toBe(CANCEL_FEE_TQT);

    await expect
      .poll(() => infoAlerts.last()?.kind, {
        message: 'the wallet raised no success dialog after broadcasting the cancellation',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toBe('success');

    // The dialog's OK handler routes back to the list.
    await expect(
      page,
      'dismissing the success dialog did not return to my-open-orders',
    ).toHaveURL(/#\/wallet\/assets\/my-open-orders$/, { timeout: DEFAULT_TIMEOUT_MS });

    const cancelled = await apiGet({ requestType: 'getBidOrder', order: bidOrderId });
    expect(
      cancelled.errorCode,
      `getBidOrder(${bidOrderId}) still resolves after cancellation ${txId} confirmed in block ${tx.block} — ` +
      `the order is still open: ${JSON.stringify(cancelled)}`,
    ).toBe(5);

    const stillListed = await apiGet({
      requestType: 'getAccountCurrentBidOrders',
      account: TEST_ACCOUNT_1_RS,
      firstIndex: '0',
      lastIndex: String(PAGE_SIZE - 1),
    });
    expect(
      (stillListed.bidOrders ?? []).map((o: any) => o.order),
      `getAccountCurrentBidOrders still reports ${bidOrderId} as an open order of TEST_ACCOUNT_1`,
    ).not.toContain(bidOrderId);

    // The trade desk reads its own books; capture the response so an empty table
    // cannot pass just because nothing had loaded yet.
    const bookResponse = page.waitForResponse((r) => r.url().includes('requestType=getBidOrders'), {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await page.goto(`#/wallet/assets/trade/${assetId}`);
    const book = await bookResponse.then((r) => r.json()).catch(() => {
      throw new Error('the trade desk never called getBidOrders — getBuyOrders() no longer runs on init');
    });
    const bookOrders: any[] = book.bidOrders ?? [];
    expect(
      bookOrders.map((o: any) => o.order),
      `the trade desk's bid book still carries the cancelled order ${bidOrderId}`,
    ).not.toContain(bidOrderId);
    await expect(
      deskBook(page, 'Buy Orders').locator('datatable-body-row'),
      `the desk's "Buy Orders" book rendered a different number of rows than the ${bookOrders.length} bid ` +
      'order(s) its own getBidOrders response contained',
    ).toHaveCount(bookOrders.length, { timeout: DEFAULT_TIMEOUT_MS });

    // Route away and back: a goto to the identical hash would not re-init the panel.
    const bidOrders = await openPanelPage(page, 'bid', '#/wallet/assets/my-open-orders');
    expect(
      bidOrders.map((o: any) => o.order),
      `the reloaded Buy panel was handed the cancelled order ${bidOrderId} again`,
    ).not.toContain(bidOrderId);
    await expect(
      panel(page, 'Buy Offers').locator('datatable-body-row', { hasText: assetName }),
      `the Buy panel still shows a row for "${assetName}" although the bid was cancelled`,
    ).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      panel(page, 'Sell Offers').locator('datatable-body-row', { hasText: assetName }),
      'cancelling the bid also removed the untouched ask from the Sell panel — the cancellation hit the ' +
      'wrong order',
    ).toHaveCount(1);
  });

  test('open-orders/cancel-order: cancelling the ask clears it from chain, list and order book', async ({
    page,
    request,
    baseURL,
    infoAlerts,
  }) => {
    await openPanelPage(page, 'ask', '#/wallet/assets/my-open-orders');

    const sellRow = panel(page, 'Sell Offers').locator('datatable-body-row', { hasText: assetName });
    await expect(sellRow, `the Sell panel has no row for "${assetName}"`).toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    await sellRow.locator('a:has(i.fa-times)').click();
    await page.waitForURL(/#\/wallet\/assets\/open-orders\/cancel-order$/, { timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      confirmField(page, 'Ask Order Id'),
      'the cancel confirmation does not show the ask order id under the "Ask Order Id" label — the ' +
      'type-driven *ngIf or the offer-details hand-off is broken',
    ).toHaveText(askOrderId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      confirmField(page, 'Price'),
      `the cancel confirmation misprices the ask — ${tqt(ASK_PRICE_XIN)} TQT/QNT is ${ASK_PRICE_XIN} XIN per share`,
    ).toHaveText(new RegExp(`^\\s*${shown(ASK_PRICE_XIN)}\\s+XIN\\s*$`));
    await expect(
      confirmField(page, 'Quantity'),
      `the cancel confirmation shows the wrong quantity — ${qnt(ASK_SHARES)} QNT is ${ASK_SHARES} shares`,
    ).toHaveText(shown(ASK_SHARES));

    const finishButton = page.locator('button.btn-primary:has(i.fa-check)').first();
    await expect(
      finishButton,
      'Finish never enabled on the cancel confirmation — cancelAskOrder returned an error or signing failed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const { txId, tx } = await broadcastAndAwaitConfirmation(
      page,
      request,
      apiOriginFromBaseURL(baseURL),
      finishButton,
    );

    expect(tx.type, 'the cancellation has the wrong type — expected Asset Exchange (2)').toBe(2);
    expect(
      tx.subtype,
      'the cancellation has the wrong subtype — expected ASK_ORDER_CANCELLATION (4); subtype 5 would mean the ' +
      'component asked for cancelBidOrder on an ask',
    ).toBe(4);
    expect(
      tx.attachment?.order,
      `the cancellation attachment names order ${tx.attachment?.order} instead of the ask ${askOrderId}`,
    ).toBe(askOrderId);
    expect(
      tx.feeTQT,
      'the cancellation was signed with a fee other than the 1 XIN CancelOrderComponent hard-codes',
    ).toBe(CANCEL_FEE_TQT);

    await expect
      .poll(() => infoAlerts.last()?.kind, {
        message: 'the wallet raised no success dialog after broadcasting the cancellation',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toBe('success');

    const cancelled = await apiGet({ requestType: 'getAskOrder', order: askOrderId });
    expect(
      cancelled.errorCode,
      `getAskOrder(${askOrderId}) still resolves after cancellation ${txId} confirmed in block ${tx.block}: ` +
      JSON.stringify(cancelled),
    ).toBe(5);

    const stillListed = await apiGet({
      requestType: 'getAccountCurrentAskOrders',
      account: TEST_ACCOUNT_1_RS,
      firstIndex: '0',
      lastIndex: String(PAGE_SIZE - 1),
    });
    expect(
      (stillListed.askOrders ?? []).map((o: any) => o.order),
      `getAccountCurrentAskOrders still reports ${askOrderId} as an open order of TEST_ACCOUNT_1`,
    ).not.toContain(askOrderId);

    const bookResponse = page.waitForResponse((r) => r.url().includes('requestType=getAskOrders'), {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await page.goto(`#/wallet/assets/trade/${assetId}`);
    const book = await bookResponse.then((r) => r.json()).catch(() => {
      throw new Error('the trade desk never called getAskOrders — getSellOrders() no longer runs on init');
    });
    const bookOrders: any[] = book.askOrders ?? [];
    expect(
      bookOrders.map((o: any) => o.order),
      `the trade desk's ask book still carries the cancelled order ${askOrderId}`,
    ).not.toContain(askOrderId);
    await expect(
      deskBook(page, 'Sell Orders').locator('datatable-body-row'),
      `the desk's "Sell Orders" book rendered a different number of rows than the ${bookOrders.length} ask ` +
      'order(s) its own getAskOrders response contained',
    ).toHaveCount(bookOrders.length, { timeout: DEFAULT_TIMEOUT_MS });

    const askOrders = await openPanelPage(page, 'ask', '#/wallet/assets/my-open-orders');
    expect(
      askOrders.map((o: any) => o.order),
      `the reloaded Sell panel was handed the cancelled order ${askOrderId} again`,
    ).not.toContain(askOrderId);
    await expect(
      panel(page, 'Sell Offers').locator('datatable-body-row', { hasText: assetName }),
      `the Sell panel still shows a row for "${assetName}" although the ask was cancelled`,
    ).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS });
  });

  test(
    'my-open-orders: the pager reports the orders the account actually has',
    async ({ page }) => {
      // Distinct quantities: identical bytes in the same second sign to one tx
      // id. The price stays below the seeded ask so none of them can trade.
      const seeded: string[] = [];
      for (let i = 1; i <= PAGE_SIZE; i += 1) seeded.push(await seedOrder('bid', 1, i));
      await awaitConfirmations(seeded, 'pager fixture orders');
      expect(new Set(seeded).size, 'the pager probe seeded duplicate transactions').toBe(PAGE_SIZE);

      const bidOrders = await openPanelPage(page, 'bid', '#/wallet/assets/my-open-orders');
      expect(
        bidOrders.length,
        'the pager probe needs a full first page of exactly 10 bid orders — the chain carries a different ' +
        'number, so the assertions below would not exercise the branch',
      ).toBe(PAGE_SIZE);

      const buyPanel = panel(page, 'Buy Offers');
      await expect(
        buyPanel.locator('datatable-pager li.pages'),
        `${PAGE_SIZE} orders at ${PAGE_SIZE} rows per page are one page; more page buttons mean the pager ` +
        'offers pages that render nothing',
      ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
      await expect(
        buyPanel.locator('datatable-footer .page-count'),
        `the Buy panel's footer must report the ${PAGE_SIZE} orders the account holds, not the Page class ` +
        'default',
      ).toHaveText(new RegExp(`^\\s*${PAGE_SIZE}\\s+total\\s*$`), { timeout: DEFAULT_TIMEOUT_MS });
    },
  );
});
