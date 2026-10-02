import { test, expect } from '../../../fixtures/test';
import { Page, Locator } from '@playwright/test';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { NodeApi, collectErrors, expectNoErrors, login, randomToken } from '../../../helpers/asset-fixtures';

/**
 * The "Asset Tool" tiles on `assets/show-assets/my` and the views behind them:
 * expected-asset-transfer, expected-order-cancellation, expected-asset-deletes
 * and expected-order-details. (The fifth tile, order-trade-details, is covered
 * in asset-read-views.spec.ts.)
 *
 * These views list what the node *expects* to execute in the next block: the
 * unconfirmed transactions. On the devnet a block is forged every few seconds,
 * so a transaction is gone from the list before a browser has rendered it.
 * `beforeAll` therefore broadcasts a real transaction of each kind and reads
 * the node's answer back at once, while it is still unconfirmed. The tests
 * then serve exactly that answer to the page. The payloads are the node's own,
 * only their timing is pinned.
 */

/** decimals=2, so QNT and shares differ by a factor the pipes have to apply. */
const DECIMALS_A = 2;
/** decimals=0, to prove expected-order-details re-reads the decimals per asset. */
const DECIMALS_B = 0;
const CAPTURE_ATTEMPTS = 3;

let api: NodeApi;
let assetA: { id: string; name: string };
let assetB: { id: string; name: string };
const openOrders: Array<{ order: string; requestType: 'cancelAskOrder' | 'cancelBidOrder' }> = [];

let expectedTransfers: any;
let expectedDeletes: any;
let expectedCancellations: any;
let expectedAsksOfA: any;
let expectedBidsOfB: any;
let cancelledOrderId: string;

const rows = (page: Page, host: string): Locator => page.locator(`${host} datatable-body-row`);
const cells = (row: Locator): Locator => row.locator('datatable-body-cell');

/**
 * Broadcast a transaction and return the node's "expected" listing while the
 * transaction is still unconfirmed. Tries again with a fresh transaction when
 * a block got in between.
 */
async function captureExpected(
  what: string,
  send: () => Promise<string>,
  listParams: Record<string, string>,
  listKey: string,
  idKey: string,
  idOf: (txId: string) => string = (txId) => txId,
): Promise<{ body: any; txId: string }> {
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
    const txId = await send();
    for (let poll = 0; poll < 20; poll++) {
      const body = await api.get(listParams);
      const entry = (body[listKey] ?? []).find((e: any) => e[idKey] === idOf(txId));
      if (entry) {
        await api.awaitConfirmations([txId], what);
        return { body: { ...body, [listKey]: [entry] }, txId };
      }
    }
    await api.awaitConfirmations([txId], what);
  }
  throw new Error(`${what}: the node never listed the unconfirmed transaction in ${listParams.requestType}`);
}

async function issue(decimals: number): Promise<{ id: string; name: string }> {
  const name = `e2e${randomToken()}`;
  const id = await api.broadcast('issueAsset fixture', TEST_ACCOUNT_1_PASSPHRASE, {
    requestType: 'issueAsset',
    name,
    description: 'e2e expected-views fixture, devnet only',
    quantityQNT: '100000',
    decimals: String(decimals),
  });
  return { id, name };
}

/** Answer the view's request with a payload captured from the node. */
async function serve(page: Page, requestType: string, bodyFor: (url: URL) => any): Promise<void> {
  await page.route(new RegExp(`requestType=${requestType}(&|$)`), (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(bodyFor(new URL(route.request().url()))),
    }),
  );
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  api = await NodeApi.create();

  assetA = await issue(DECIMALS_A);
  assetB = await issue(DECIMALS_B);
  await api.awaitConfirmations([assetA.id, assetB.id], 'issueAsset fixtures');

  // An order has to be on chain before its cancellation can be expected.
  cancelledOrderId = await api.broadcast('placeAskOrder fixture', TEST_ACCOUNT_1_PASSPHRASE, {
    requestType: 'placeAskOrder',
    asset: assetA.id,
    quantityQNT: '100',
    priceTQT: '5000000',
  });
  await api.awaitConfirmations([cancelledOrderId], 'ask order to cancel');

  expectedTransfers = (
    await captureExpected(
      'transferAsset',
      () =>
        api.broadcast('transferAsset', TEST_ACCOUNT_1_PASSPHRASE, {
          requestType: 'transferAsset',
          asset: assetA.id,
          quantityQNT: '150',
          recipient: TEST_ACCOUNT_2_RS,
        }),
      { requestType: 'getExpectedAssetTransfers', includeAssetInfo: 'true' },
      'transfers',
      'assetTransfer',
    )
  ).body;

  expectedDeletes = (
    await captureExpected(
      'deleteAssetShares',
      () =>
        api.broadcast('deleteAssetShares', TEST_ACCOUNT_1_PASSPHRASE, {
          requestType: 'deleteAssetShares',
          asset: assetA.id,
          quantityQNT: '250',
        }),
      { requestType: 'getExpectedAssetDeletes', includeAssetInfo: 'true' },
      'deletes',
      'assetDelete',
    )
  ).body;

  // A cancellation is listed under the order it cancels, not under its own id.
  // A retry would cancel an order that is already gone, so this one gets one shot
  // per order: place a fresh order if the first capture missed.
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS && !expectedCancellations; attempt++) {
    const cancelTx = await api.broadcast('cancelAskOrder', TEST_ACCOUNT_1_PASSPHRASE, {
      requestType: 'cancelAskOrder',
      order: cancelledOrderId,
    });
    for (let poll = 0; poll < 20 && !expectedCancellations; poll++) {
      const body = await api.get({ requestType: 'getExpectedOrderCancellations' });
      const entry = (body.orderCancellations ?? []).find((e: any) => e.order === cancelledOrderId);
      if (entry) expectedCancellations = { ...body, orderCancellations: [entry] };
    }
    await api.awaitConfirmations([cancelTx], 'cancelAskOrder');
    if (!expectedCancellations) {
      cancelledOrderId = await api.broadcast('placeAskOrder fixture', TEST_ACCOUNT_1_PASSPHRASE, {
        requestType: 'placeAskOrder',
        asset: assetA.id,
        quantityQNT: '100',
        priceTQT: '5000000',
      });
      await api.awaitConfirmations([cancelledOrderId], 'ask order to cancel');
    }
  }
  if (!expectedCancellations) {
    throw new Error('the node never listed the unconfirmed cancellation in getExpectedOrderCancellations');
  }

  // 200 QNT (2.00 shares) at 2 XIN per share.
  const ask = await captureExpected(
    'placeAskOrder',
    async () => {
      const order = await api.broadcast('placeAskOrder', TEST_ACCOUNT_1_PASSPHRASE, {
        requestType: 'placeAskOrder',
        asset: assetA.id,
        quantityQNT: '200',
        priceTQT: '2000000',
      });
      openOrders.push({ order, requestType: 'cancelAskOrder' });
      return order;
    },
    { requestType: 'getExpectedAskOrders', asset: assetA.id, sortByPrice: 'true' },
    'askOrders',
    'order',
  );
  expectedAsksOfA = ask.body;

  // 7 QNT (7 shares at decimals=0) at 3 XIN per share.
  const bid = await captureExpected(
    'placeBidOrder',
    async () => {
      const order = await api.broadcast('placeBidOrder', TEST_ACCOUNT_1_PASSPHRASE, {
        requestType: 'placeBidOrder',
        asset: assetB.id,
        quantityQNT: '7',
        priceTQT: '300000000',
      });
      openOrders.push({ order, requestType: 'cancelBidOrder' });
      return order;
    },
    { requestType: 'getExpectedBidOrders', asset: assetB.id, sortByPrice: 'true' },
    'bidOrders',
    'order',
  );
  expectedBidsOfB = bid.body;
});

test.afterAll(async () => {
  // Orders left open lock balance and shares and crowd my-open-orders of later runs.
  const cancelTxIds: string[] = [];
  for (const { order, requestType } of openOrders) {
    try {
      cancelTxIds.push(await api.broadcast(`${requestType} cleanup`, TEST_ACCOUNT_1_PASSPHRASE, { requestType, order }));
    } catch (err) {
      console.warn(`[asset-expected-views cleanup] ${err}`);
    }
  }
  if (cancelTxIds.length) {
    await api.awaitConfirmations(cancelTxIds, 'cleanup cancellation').catch((err) => {
      console.warn(`[asset-expected-views cleanup] ${err}`);
    });
  }
  await api?.dispose();
});

test.beforeEach(async ({ page }) => {
  await login(page, TEST_ACCOUNT_1_PASSPHRASE);
});

test('show-assets/my: each Asset Tool tile opens its view, which queries the node and leads back', async ({ page }) => {
  const errors = collectErrors(page);
  const tiles: Array<{ label: RegExp; route: string; title: string; requestType?: string }> = [
    {
      label: /Expected Asset\s*Transfers/,
      route: 'expected-asset-transfer',
      title: 'Expected Asset Transfers',
      requestType: 'getExpectedAssetTransfers',
    },
    {
      label: /Expected Order\s*Cancellation/,
      route: 'expected-order-cancellation',
      title: 'Expected Order Cancellation',
      requestType: 'getExpectedOrderCancellations',
    },
    {
      label: /Expected Asset\s*Deletes/,
      route: 'expected-asset-deletes',
      title: 'Expected Asset Deletes',
      requestType: 'getExpectedAssetDeletes',
    },
    // These two only query once an id is entered.
    { label: /Expected Bid\/Ask\s*Orders/, route: 'expected-order-details', title: 'Expected Order Details' },
    { label: /Get Order\s*Trades/, route: 'order-trade-details', title: 'Order Trade Details' },
  ];

  for (const tile of tiles) {
    await page.goto('#/wallet/assets/show-assets/my');
    const button = page.locator('app-assets button.media-box', { hasText: tile.label });
    await expect(button, `the tile for ${tile.route} did not render`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    const queried = tile.requestType
      ? page.waitForRequest((r) => r.url().includes(`requestType=${tile.requestType}`), {
          timeout: DEFAULT_TIMEOUT_MS,
        })
      : null;
    await button.click();
    await page.waitForURL(new RegExp(`#/wallet/assets/show-assets/${tile.route}$`), {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await expect(page.locator('h2.main-title').first(), `${tile.route} shows the wrong or an untranslated title`).toHaveText(
      tile.title,
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    if (queried) await queried;

    await page.locator('.back-button').click();
    await page.waitForURL(/#\/wallet\/assets\/show-assets\/my$/, { timeout: DEFAULT_TIMEOUT_MS });
  }

  expectNoErrors(errors, 'the Asset Tool views');
});

test('expected-asset-transfer: lists asset, sender, recipient and the quantity in shares', async ({ page }) => {
  await serve(page, 'getExpectedAssetTransfers', () => expectedTransfers);
  await page.goto('#/wallet/assets/show-assets/expected-asset-transfer');

  const row = rows(page, 'app-expected-asset-transfer');
  await expect(row, 'the expected transfer the node reports was not rendered').toHaveCount(1, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  // asset | sender | recipient | quantity
  await expect(cells(row).nth(0)).toHaveText(assetA.name);
  await expect(cells(row).nth(1)).toHaveText(TEST_ACCOUNT_1_RS);
  await expect(cells(row).nth(2)).toHaveText(TEST_ACCOUNT_2_RS);
  await expect(cells(row).nth(3), `150 QNT at decimals=${DECIMALS_A} are 1.50 shares`).toHaveText('1.50');

  await cells(row).nth(0).locator('a.hyperlink').click();
  await page.waitForURL(
    new RegExp(`#/wallet/assets/show-assets/expected-asset-transfer/asset-details\\?id=${assetA.id}$`),
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  await expect(page.locator('app-asset-details h4').first()).toHaveText(assetA.name, {
    timeout: DEFAULT_TIMEOUT_MS,
  });

  await page.goto('#/wallet/assets/show-assets/expected-asset-transfer');
  await cells(rows(page, 'app-expected-asset-transfer')).nth(2).locator('a.hyperlink').click();
  await page.waitForURL(/#\/wallet\/assets\/show-assets\/expected-asset-transfer\/account-details\?id=XIN-/, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await expect(page.locator('app-account-detail h4').first()).toContainText(TEST_ACCOUNT_2_RS, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
});

test('expected-asset-deletes: lists asset, account, transaction and the quantity in shares', async ({ page }) => {
  await serve(page, 'getExpectedAssetDeletes', () => expectedDeletes);
  await page.goto('#/wallet/assets/show-assets/expected-asset-deletes');

  const row = rows(page, 'app-expected-asset-deletes');
  await expect(row, 'the expected delete the node reports was not rendered').toHaveCount(1, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const entry = expectedDeletes.deletes[0];
  // asset | account | transaction | quantity
  await expect(cells(row).nth(0)).toHaveText(assetA.name);
  await expect(cells(row).nth(1)).toHaveText(TEST_ACCOUNT_1_RS);
  await expect(cells(row).nth(2)).toHaveText(entry.assetDelete);
  await expect(
    cells(row).nth(2).locator('a'),
    'the transaction id linked to account-details, which then looked up an account with a transaction id',
  ).toHaveCount(0);
  await expect(cells(row).nth(3), `250 QNT at decimals=${DECIMALS_A} are 2.50 shares`).toHaveText('2.50');

  await cells(row).nth(1).locator('a.hyperlink').click();
  await page.waitForURL(/#\/wallet\/assets\/show-assets\/expected-asset-deletes\/account-details\?id=XIN-/, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
});

test('expected-order-cancellation: lists the account and the order being cancelled', async ({ page }) => {
  await serve(page, 'getExpectedOrderCancellations', () => expectedCancellations);
  await page.goto('#/wallet/assets/show-assets/expected-order-cancellation');

  const row = rows(page, 'app-expected-order-cancellation');
  await expect(row, 'the expected cancellation the node reports was not rendered').toHaveCount(1, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  // account | order
  await expect(cells(row).nth(0)).toHaveText(TEST_ACCOUNT_1_RS);
  await expect(cells(row).nth(1)).toHaveText(cancelledOrderId);
  await expect(
    cells(row).nth(1).locator('a'),
    'the order id linked to account-details, which then looked up an account with an order id',
  ).toHaveCount(0);

  await cells(row).nth(0).locator('a.hyperlink').click();
  await page.waitForURL(/#\/wallet\/assets\/show-assets\/expected-order-cancellation\/account-details\?id=XIN-/, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
});

test('expected-order-details: shows the expected orders of the entered asset, scaled by that asset\'s decimals', async ({ page }) => {
  const errors = collectErrors(page);
  const none = { askOrders: [], bidOrders: [] };
  const requested: string[] = [];
  await serve(page, 'getExpectedAskOrders', (url) => {
    requested.push(`ask:${url.searchParams.get('asset')}`);
    return url.searchParams.get('asset') === assetA.id ? expectedAsksOfA : none;
  });
  await serve(page, 'getExpectedBidOrders', (url) => {
    requested.push(`bid:${url.searchParams.get('asset')}`);
    return url.searchParams.get('asset') === assetB.id ? expectedBidsOfB : none;
  });

  await page.goto('#/wallet/assets/show-assets/expected-order-details');
  const assetInput = page.locator('app-expected-order-details input.form-control');
  await expect(assetInput, 'expected-order-details did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const orderRows = page.locator('app-expected-order-details datatable-body-row');

  // Asset A, Ask Orders tab (the default): 200 QNT at 2_000_000 TQT per QNT.
  await assetInput.fill(assetA.id);
  await expect(
    orderRows,
    'the Ask Orders tab stayed empty — the view read the asset response where the order list belongs',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
  // price per share | quantity | sum
  await expect(cells(orderRows).nth(0), '2_000_000 TQT per QNT at decimals=2 are 2.00 XIN per share').toHaveText('2.00');
  await expect(cells(orderRows).nth(1), '200 QNT at decimals=2 are 2.00 shares').toHaveText('2.00');
  await expect(cells(orderRows).nth(2), '2.00 shares at 2.00 XIN are 4.00 XIN').toHaveText('4.00');
  expect(requested, 'the view must ask for both order books of the entered asset').toEqual(
    expect.arrayContaining([`ask:${assetA.id}`, `bid:${assetA.id}`]),
  );

  // Asset B on the Bid Orders tab: 7 QNT at 300_000_000 TQT per QNT, decimals=0.
  await assetInput.fill(assetB.id);
  await page.locator('app-expected-order-details button', { hasText: /^\s*Bid Orders\s*$/ }).click();
  await expect(orderRows, 'the Bid Orders tab did not list the expected bid of the second asset').toHaveCount(1, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await expect(
    cells(orderRows).nth(0),
    'the price of a decimals=0 asset was scaled with the decimals of the asset entered before it',
  ).toHaveText('3');
  await expect(
    cells(orderRows).nth(1),
    'the quantity of a decimals=0 asset was scaled with the decimals of the asset entered before it',
  ).toHaveText('7.00');
  await expect(cells(orderRows).nth(2), '7 shares at 3 XIN are 21.00 XIN').toHaveText('21.00');

  // And back on the Ask tab the first asset's order is gone.
  await page.locator('app-expected-order-details button', { hasText: /^\s*Ask Orders\s*$/ }).click();
  await expect(orderRows, 'the ask of the first asset stayed listed under the second asset').toHaveCount(0, {
    timeout: DEFAULT_TIMEOUT_MS,
  });

  expectNoErrors(errors, 'expected-order-details');
});
