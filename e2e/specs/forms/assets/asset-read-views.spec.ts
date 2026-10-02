import { test, expect } from '../../../fixtures/test';
import { Page, Locator } from '@playwright/test';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { NodeApi, login, randomToken, rowTexts } from '../../../helpers/asset-fixtures';

/**
 * The read side of the asset module: the All Assets list with its sort
 * filters, pager and row actions, asset-details, dividend-history, my-trades,
 * last-trades and order-trade-details.
 *
 * One fixture asset carries a history built through the node API, so every
 * list has exactly one row whose numbers are known:
 *
 *   decimals=2, 100000 QNT issued by TEST_ACCOUNT_1
 *   1234 QNT transferred to TEST_ACCOUNT_2             -> 1 transfer, 2 holders
 *   ask 500 QNT by account 1, bid 300 QNT by account 2 -> 1 trade of 300 QNT
 *   dividend of 1000 TQT per QNT                       -> 1534 QNT held by others
 *
 * decimals=2 on purpose: at decimals=0 every scaling pipe is the identity and a
 * lost conversion would render the same digits.
 */

const DECIMALS = 2;
const ISSUED_QNT = 100_000;
const TRANSFER_QNT = 1_234;
const ASK_QNT = 500;
const BID_QNT = 300;
/** 2 XIN per share == 2_000_000 TQT per QNT at decimals=2. */
const PRICE_TQT_PER_QNT = 2_000_000;
const DIVIDEND_TQT_PER_QNT = 1_000;

const DESCRIPTION_ASCII_PART = 'e2e asset read-views fixture';

/** How the trade's price and quantity must read in every list. */
const SHOWN_PRICE = '2.00';
const SHOWN_TRADE_QUANTITY = '3.00';

let api: NodeApi;
let assetName: string;
let assetId: string;
let askOrderId: string;
let bidOrderId: string;
let dividendTxId: string;
let trade: any;

const table = (page: Page, host: string): Locator => page.locator(`${host} ngx-datatable`).first();
const assetRow = (page: Page, host: string): Locator =>
  table(page, host).locator('datatable-body-row').filter({ hasText: assetName });
const cells = (row: Locator): Locator => row.locator('datatable-body-cell');

/** Navigate and return the response of the request the view fires on init. */
async function openAndCapture(page: Page, hash: string, requestType: string): Promise<any> {
  const captured = page.waitForResponse((r) => r.url().includes(`requestType=${requestType}`), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await page.goto(hash);
  return (await captured).json();
}

/** Run a UI action and return the query parameters of the getAllAssets call it triggers. */
async function allAssetsRequestAfter(page: Page, action: () => Promise<void>): Promise<URLSearchParams> {
  const sent = page.waitForRequest((r) => r.url().includes('requestType=getAllAssets'), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await action();
  return new URL((await sent).url()).searchParams;
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  api = await NodeApi.create();
  assetName = `e2e${randomToken()}`;

  assetId = await api.broadcast('issueAsset fixture', TEST_ACCOUNT_1_PASSPHRASE, {
    requestType: 'issueAsset',
    name: assetName,
    description: `${DESCRIPTION_ASCII_PART} — devnet only`,
    quantityQNT: String(ISSUED_QNT),
    decimals: String(DECIMALS),
  });
  await api.awaitConfirmations([assetId], 'issueAsset fixture');

  const transferTx = await api.broadcast('transferAsset fixture', TEST_ACCOUNT_1_PASSPHRASE, {
    requestType: 'transferAsset',
    asset: assetId,
    quantityQNT: String(TRANSFER_QNT),
    recipient: TEST_ACCOUNT_2_RS,
  });
  askOrderId = await api.broadcast('placeAskOrder fixture', TEST_ACCOUNT_1_PASSPHRASE, {
    requestType: 'placeAskOrder',
    asset: assetId,
    quantityQNT: String(ASK_QNT),
    priceTQT: String(PRICE_TQT_PER_QNT),
  });
  await api.awaitConfirmations([transferTx, askOrderId], 'transfer + ask fixture');

  // The bid lands in a later block than the ask, so the trade is a "buy".
  bidOrderId = await api.broadcast('placeBidOrder fixture', TEST_ACCOUNT_2_PASSPHRASE, {
    requestType: 'placeBidOrder',
    asset: assetId,
    quantityQNT: String(BID_QNT),
    priceTQT: String(PRICE_TQT_PER_QNT),
  });
  await api.awaitConfirmations([bidOrderId], 'bid fixture');
  trade = await api.until('the ask/bid fixture orders matching', async () => {
    const found = await api.get({ requestType: 'getTrades', asset: assetId, includeAssetInfo: 'true' });
    return found.trades?.[0];
  });

  const status = await api.get({ requestType: 'getBlockchainStatus' });
  dividendTxId = await api.broadcast('dividendPayment fixture', TEST_ACCOUNT_1_PASSPHRASE, {
    requestType: 'dividendPayment',
    asset: assetId,
    height: String(status.numberOfBlocks - 1),
    amountTQTPerQNT: String(DIVIDEND_TQT_PER_QNT),
  });
  await api.awaitConfirmations([dividendTxId], 'dividend fixture');
});

test.afterAll(async () => {
  // The unfilled rest of the ask would stay in my-open-orders of every later run.
  try {
    const still = await api.get({ requestType: 'getAskOrder', order: askOrderId });
    if (!still.errorCode) {
      const cancelTx = await api.broadcast('cancelAskOrder cleanup', TEST_ACCOUNT_1_PASSPHRASE, {
        requestType: 'cancelAskOrder',
        order: askOrderId,
      });
      await api.awaitConfirmations([cancelTx], 'ask cancellation');
    }
  } catch (err) {
    console.warn(`[asset-read-views cleanup] ${err}`);
  }
  await api?.dispose();
});

test.beforeEach(async ({ page }) => {
  await login(page, TEST_ACCOUNT_1_PASSPHRASE);
});

test.describe('show-assets/all', () => {
  test('the row of an asset shows supply, holders, trades and transfers as the node reports them', async ({ page }) => {
    const asset = await api.get({ requestType: 'getAsset', asset: assetId, includeCounts: 'true' });
    expect(
      [asset.numberOfAccounts, asset.numberOfTrades, asset.numberOfTransfers],
      `the fixture history did not build as planned: ${JSON.stringify(asset)}`,
    ).toEqual([2, 1, 1]);

    await openAndCapture(page, '#/wallet/assets/show-assets/all', 'getAllAssets');
    const row = assetRow(page, 'app-assets');
    await expect(row, `the newest asset "${assetName}" is not on the first page of All Assets`).toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    // name | issuer | current supply | shareholders | trades | transfers | actions
    await expect(cells(row).nth(1), 'the Issuer column does not name the issuing account').toHaveText(
      TEST_ACCOUNT_1_RS,
    );
    await expect(
      cells(row).nth(2),
      `${ISSUED_QNT} QNT at decimals=${DECIMALS} are 1,000.00 shares — the supply pipe lost the decimals`,
    ).toHaveText('1,000.00');
    await expect(cells(row).nth(3), 'Shareholders does not match numberOfAccounts').toHaveText('2');
    await expect(cells(row).nth(4), 'Trades does not match numberOfTrades').toHaveText('1');
    await expect(cells(row).nth(5), 'Transfers does not match numberOfTransfers').toHaveText('1');
  });

  test('each sort filter sends its own order and orderColumn, and the list follows the node', async ({ page }) => {
    await openAndCapture(page, '#/wallet/assets/show-assets/all', 'getAllAssets');
    const filters = page.locator('app-assets a.filter');
    await expect(filters, 'the five sort filters did not render').toHaveCount(5, { timeout: DEFAULT_TIMEOUT_MS });

    // Toggle A-Z | Sort Name | Sort Supply | Sort Height | Sort Decimals
    const expected: Array<[number, string, string]> = [
      [1, 'desc', 'name'],
      [2, 'desc', 'quantity'],
      [4, 'desc', 'decimals'],
      [3, 'desc', 'height'],
      [0, 'asc', 'height'],
      [1, 'asc', 'name'],
    ];
    for (const [index, order, orderColumn] of expected) {
      const params = await allAssetsRequestAfter(page, () => filters.nth(index).click());
      expect(
        [params.get('order'), params.get('orderColumn')],
        `filter #${index} did not ask the node for ${orderColumn} ${order}`,
      ).toEqual([order, orderColumn]);
      await expect(filters.nth(index), 'the clicked filter is not marked active').toHaveClass(/active/);
    }

    // The list on screen is the node's answer to the last request: name ascending.
    const sorted = await api.get({
      requestType: 'getAllAssets',
      firstIndex: '0',
      lastIndex: '9',
      order: 'asc',
      orderColumn: 'name',
    });
    const names = sorted.assets.map((a: any) => a.name);
    await expect
      .poll(async () => (await rowTexts(table(page, 'app-assets'))).map((r) => r.split(' | ')[0]), {
        message: 'the rows are not the first ten assets by name ascending',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toEqual(names);

    // "Remove filter" has to restore the default sort, not only the button state.
    const reset = await allAssetsRequestAfter(page, () => page.locator('app-assets a:has(i.fa-history)').click());
    expect(
      [reset.get('order'), reset.get('orderColumn')],
      'Remove Filter cleared the active marker but kept sorting by the removed filter',
    ).toEqual(['desc', 'height']);
    await expect(page.locator('app-assets a.filter.active')).toHaveCount(0);
  });

  test('the pager requests the next ten assets', async ({ page }) => {
    await openAndCapture(page, '#/wallet/assets/show-assets/all', 'getAllAssets');
    await expect(table(page, 'app-assets').locator('datatable-body-row')).toHaveCount(10, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    const params = await allAssetsRequestAfter(page, () =>
      page.locator('app-assets datatable-pager li.pages[aria-label="page 2"] a').click(),
    );
    expect([params.get('firstIndex'), params.get('lastIndex')], 'page 2 did not ask for assets 10..19').toEqual([
      '10',
      '19',
    ]);

    const second = await api.get({
      requestType: 'getAllAssets',
      firstIndex: '10',
      lastIndex: '19',
      order: 'desc',
      orderColumn: 'height',
    });
    await expect
      .poll(async () => (await rowTexts(table(page, 'app-assets'))).map((r) => r.split(' | ')[0]), {
        message: 'page 2 does not show the assets the node returns for 10..19',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toEqual(second.assets.map((a: any) => a.name));
  });

  test('the name link opens asset-details with every field the node reports', async ({ page }) => {
    await openAndCapture(page, '#/wallet/assets/show-assets/all', 'getAllAssets');
    await assetRow(page, 'app-assets').locator('a.hyperlink', { hasText: assetName }).click();
    await page.waitForURL(/#\/wallet\/assets\/show-assets\/asset-details\?id=\d+$/, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    expect(page.url(), 'asset-details was opened for a different asset than the row').toContain(`id=${assetId}`);

    const asset = await api.get({ requestType: 'getAsset', asset: assetId, includeCounts: 'true' });
    // name | description | issuer | asset id | initial supply | current supply |
    // decimals | shareholders | trades | transfers
    const fields = page.locator('app-asset-details h4');
    await expect(fields.nth(0)).toHaveText(asset.name, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(fields.nth(1)).toContainText(DESCRIPTION_ASCII_PART);
    await expect(fields.nth(2)).toHaveText(TEST_ACCOUNT_1_RS);
    await expect(fields.nth(3)).toHaveText(assetId);
    await expect(fields.nth(4), 'initial supply is not scaled by the asset decimals').toHaveText('1,000.00');
    await expect(fields.nth(5), 'current supply is not scaled by the asset decimals').toHaveText('1,000.00');
    await expect(fields.nth(6)).toHaveText(String(DECIMALS));
    await expect(fields.nth(7), 'shareholders does not match numberOfAccounts').toHaveText('2');
    await expect(fields.nth(8), 'trades does not match numberOfTrades').toHaveText('1');
    await expect(fields.nth(9), 'transfers does not match numberOfTransfers').toHaveText('1');

    // Back returns to the list the user came from.
    await page.locator('app-asset-details .back-button').click();
    await page.waitForURL(/#\/wallet\/assets\/show-assets\/all$/, { timeout: DEFAULT_TIMEOUT_MS });
  });

  test.fixme(
    'asset-details shows a description with non-ASCII characters as it was entered',
    async ({ page }) => {
      // Wallet-wide, not an asset defect: ResponseInterceptor runs every string of
      // every node response through DomSanitizer.sanitize(SecurityContext.HTML, ...)
      // (common.service.ts sanitizeJson), which entity-encodes everything outside
      // printable ASCII. Interpolation then shows the entity as text: an em dash
      // reads "&#8212;", "ü" reads "&#252;". Needs a decision on where the wallet
      // sanitizes before it can be fixed, [innerHTML] bindings rely on it.
      const asset = await api.get({ requestType: 'getAsset', asset: assetId });
      await page.goto(`#/wallet/assets/show-assets/asset-details?id=${assetId}`);
      await expect(page.locator('app-asset-details h4').nth(1)).toHaveText(asset.description, {
        timeout: DEFAULT_TIMEOUT_MS,
      });
    },
  );

  test('the issuer link and the three row actions open their target for the row\'s asset', async ({ page }) => {
    const open = async () => {
      await openAndCapture(page, '#/wallet/assets/show-assets/all', 'getAllAssets');
      await expect(assetRow(page, 'app-assets')).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
      return assetRow(page, 'app-assets');
    };

    await (await open()).locator('a.hyperlink', { hasText: TEST_ACCOUNT_1_RS }).click();
    await page.waitForURL(/#\/wallet\/assets\/show-assets\/account-details\?id=XIN-/, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await expect(page.locator('app-account-detail h4').first()).toContainText(TEST_ACCOUNT_1_RS, {
      timeout: DEFAULT_TIMEOUT_MS,
    });

    await (await open()).locator('a:has(i.fa-list-ul)').click();
    await page.waitForURL(/#\/wallet\/assets\/show-assets\/transaction-details$/, { timeout: DEFAULT_TIMEOUT_MS });
    const txFields = page.locator('app-transaction-detail h4');
    await expect(
      txFields.nth(0),
      'transaction-details does not show the issuance transaction of the row — an asset id is its issuance tx id',
    ).toHaveText(assetId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(txFields.nth(5)).toHaveText('Asset Issuance');

    await (await open()).locator('a:has(i.fa-bar-chart)').click();
    await page.waitForURL(new RegExp(`#/wallet/assets/trade/${assetId}$`), { timeout: DEFAULT_TIMEOUT_MS });

    await (await open()).locator('a:has(i.fa-usd)').click();
    await page.waitForURL(/#\/wallet\/assets\/show-assets\/dividend-history\?id=\d+$/, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    expect(page.url(), 'dividend-history was opened for a different asset than the row').toContain(`id=${assetId}`);
  });
});

test.describe('dividend-history', () => {
  test('lists the dividend with height, holders and the total actually paid', async ({ page }) => {
    const body = await openAndCapture(
      page,
      `#/wallet/assets/show-assets/dividend-history?id=${assetId}`,
      'getAssetDividends',
    );
    expect(body.dividends, `the node lists no dividend for ${assetId}`).toHaveLength(1);
    const dividend = body.dividends[0];

    // Account 2 holds the transferred and the bought shares; the issuer is not paid.
    const paidQnt = TRANSFER_QNT + BID_QNT;
    expect(Number(dividend.totalDividend), 'the fixture dividend did not pay what was planned').toBe(
      paidQnt * DIVIDEND_TQT_PER_QNT,
    );

    const row = table(page, 'app-divident-history').locator('datatable-body-row');
    await expect(row, 'dividend-history did not render the one dividend of the asset').toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    // height | date | accounts | amount | actions
    await expect(cells(row).nth(0)).toHaveText(String(dividend.dividendHeight));
    await expect(cells(row).nth(2), 'the number of paid accounts is wrong').toHaveText('1');
    await expect(
      cells(row).nth(3),
      `${paidQnt} QNT x ${DIVIDEND_TQT_PER_QNT} TQT are 0.01534 XIN`,
    ).toHaveText('0.01534');

    await row.locator('a:has(i.fa-list-ul)').click();
    await page.waitForURL(/#\/wallet\/assets\/show-assets\/dividend-history\/transaction-details$/, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await expect(
      page.locator('app-transaction-detail h4').first(),
      'the details action did not open the dividend payment transaction',
    ).toHaveText(dividendTxId, { timeout: DEFAULT_TIMEOUT_MS });
  });
});

for (const view of [
  { route: 'my-trades', host: 'app-my-trades', requestType: 'getTrades' },
  { route: 'last-trades', host: 'app-last-trade', requestType: 'getAllTrades' },
] as const) {
  test.describe(view.route, () => {
    test('shows the trade with both parties, price and quantity scaled by the decimals', async ({ page }) => {
      await openAndCapture(page, `#/wallet/assets/${view.route}`, view.requestType);
      const row = assetRow(page, view.host);
      await expect(row, `${view.route} has no row for the trade in "${assetName}"`).toHaveCount(1, {
        timeout: DEFAULT_TIMEOUT_MS,
      });

      // name | date | type | buyer | seller | price | quantity | actions
      await expect(
        cells(row).nth(2),
        `the node reports the trade as "${trade.tradeType}"`,
      ).toHaveText(trade.tradeType === 'buy' ? 'B' : 'S');
      await expect(cells(row).nth(3), 'the buyer is the account that placed the bid').toHaveText(TEST_ACCOUNT_2_RS);
      await expect(cells(row).nth(4), 'the seller is the account that placed the ask').toHaveText(TEST_ACCOUNT_1_RS);
      await expect(
        cells(row).nth(5),
        `${PRICE_TQT_PER_QNT} TQT per QNT at decimals=${DECIMALS} are 2.00 XIN per share`,
      ).toHaveText(SHOWN_PRICE);
      await expect(cells(row).nth(6), `${BID_QNT} QNT at decimals=${DECIMALS} are 3.00 shares`).toHaveText(
        SHOWN_TRADE_QUANTITY,
      );
    });

    test('name, buyer and the two actions open their target for the row\'s trade', async ({ page }) => {
      const open = async () => {
        await openAndCapture(page, `#/wallet/assets/${view.route}`, view.requestType);
        await expect(assetRow(page, view.host)).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
        return assetRow(page, view.host);
      };

      await (await open()).locator('a.hyperlink', { hasText: assetName }).click();
      await page.waitForURL(new RegExp(`#/wallet/assets/${view.route}/asset-details\\?id=${assetId}$`), {
        timeout: DEFAULT_TIMEOUT_MS,
      });
      await expect(page.locator('app-asset-details h4').first()).toHaveText(assetName, {
        timeout: DEFAULT_TIMEOUT_MS,
      });

      await (await open()).locator('a.hyperlink', { hasText: TEST_ACCOUNT_2_RS }).click();
      await page.waitForURL(new RegExp(`#/wallet/assets/${view.route}/account-details\\?id=XIN-`), {
        timeout: DEFAULT_TIMEOUT_MS,
      });
      await expect(page.locator('app-account-detail h4').first()).toContainText(TEST_ACCOUNT_2_RS, {
        timeout: DEFAULT_TIMEOUT_MS,
      });

      // The details action follows the order that completed the trade.
      const closingOrder = trade.tradeType === 'buy' ? bidOrderId : askOrderId;
      await (await open()).locator('a:has(i.fa-list-ul)').click();
      await page.waitForURL(new RegExp(`#/wallet/assets/${view.route}/transaction-details$`), {
        timeout: DEFAULT_TIMEOUT_MS,
      });
      await expect(
        page.locator('app-transaction-detail h4').first(),
        `the details action must open the ${trade.tradeType === 'buy' ? 'bid' : 'ask'} order of the trade`,
      ).toHaveText(closingOrder, { timeout: DEFAULT_TIMEOUT_MS });

      await (await open()).locator('a:has(i.fa-bar-chart)').click();
      await page.waitForURL(new RegExp(`#/wallet/assets/trade/${assetId}$`), { timeout: DEFAULT_TIMEOUT_MS });
    });
  });
}

test.describe('order-trade-details', () => {
  const orderInput = (page: Page): Locator => page.locator('app-order-trade-details input.form-control');
  const tradeRows = (page: Page): Locator =>
    table(page, 'app-order-trade-details').locator('datatable-body-row');

  test.beforeEach(async ({ page }) => {
    await page.goto('#/wallet/assets/show-assets/order-trade-details');
    await expect(orderInput(page), 'order-trade-details did not mount').toBeVisible({
      timeout: DEFAULT_TIMEOUT_MS,
    });
  });

  test('a bid order id lists the trades of that bid', async ({ page }) => {
    const bidQuery = page.waitForRequest(
      (r) => r.url().includes('requestType=getOrderTrades') && r.url().includes(`bidOrder=${bidOrderId}`),
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    await orderInput(page).fill(bidOrderId);
    await bidQuery.catch(() => {
      throw new Error(
        'the mask never asked the node for the trades of a bid order — both of its two queries went out as ' +
        'askOrder=<id>, so an id of a bid order could not find anything',
      );
    });

    await expect(tradeRows(page), `no trade listed for bid order ${bidOrderId}`).toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    // date | quantity | price | type | action
    await expect(cells(tradeRows(page)).nth(1)).toHaveText(SHOWN_TRADE_QUANTITY);
    await expect(cells(tradeRows(page)).nth(2)).toHaveText(SHOWN_PRICE);
  });

  test('an ask order id lists the trades of that ask, an unknown id clears the list', async ({ page }) => {
    await orderInput(page).fill(askOrderId);
    await expect(tradeRows(page), `no trade listed for ask order ${askOrderId}`).toHaveCount(1, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await expect(cells(tradeRows(page)).nth(1)).toHaveText(SHOWN_TRADE_QUANTITY);
    await expect(cells(tradeRows(page)).nth(2)).toHaveText(SHOWN_PRICE);

    await orderInput(page).fill('1');
    await expect(
      tradeRows(page),
      'the trades of the previous order stayed on screen for an id that has none',
    ).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS });
  });

  test('the details action opens the order that completed the trade', async ({ page }) => {
    await orderInput(page).fill(askOrderId);
    await expect(tradeRows(page)).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    await tradeRows(page).locator('a:has(i.fa-list-ul)').click();
    await page.waitForURL(/#\/wallet\/assets\/show-assets\/order-trade-details\/transaction-details$/, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await expect(page.locator('app-transaction-detail h4').first()).toHaveText(
      trade.tradeType === 'buy' ? bidOrderId : askOrderId,
      { timeout: DEFAULT_TIMEOUT_MS },
    );
  });
});
