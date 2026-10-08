import { test, expect } from '../../../fixtures/test';
import { Page, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_ID } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Shared detail views (transaction-detail / account-detail / block-transaction-details).
 *
 * The risk: transaction-detail reads its subject from `DataStoreService`, a
 * static in-memory map written by the list the user clicked; account-detail and
 * block-transaction-details read theirs from `queryParams`. Either way the route
 * path names no subject, so a broken click handler, a wrong `prop` on a datatable
 * column or a lost DataStore entry renders a *plausible looking* page about the
 * wrong subject (or an empty one) and no route smoke test notices. Every test
 * here therefore goes through a real click path and then pins the rendered
 * values against what the node API answers for the same identifier.
 *
 * Read-only by design: nothing is broadcast, so the spec is repeatable against
 * the same chain.
 */

const TOKEN_QUANTS = 100_000_000;

/** Field order of `transaction-detail.component.html`, transactionDetail view. */
const TX_ID = 0;
const TX_BLOCK = 1;
const TX_HEIGHT = 3;
const TX_AMOUNT = 6;
const TX_FEE = 7;
const TX_SENDER = 9;
const TX_RECIPIENT = 10;

/** Field order of `account-detail.component.html`. */
const ACC_RS = 0;
const ACC_BALANCE = 1;

/** Column order of the block table in `block-transaction-details.component.html`. */
const BLK_HEIGHT = 0;
const BLK_ID = 1;
const BLK_TX_COUNT = 2;
const BLK_GENERATOR = 5;

/** `amountTqt` renders TQT as en-US with >= 2 and <= 3 decimals — compare numbers, not strings. */
function shownAmount(text: string): number {
  const digits = text.replace(/,/g, '').match(/\d+(\.\d+)?/);
  return digits ? Number(digits[0]) : NaN;
}

function expectedAmount(tqt: string | number): number {
  return Number((Number(tqt) / TOKEN_QUANTS).toFixed(3));
}

async function api(request: APIRequestContext, apiOrigin: string, params: Record<string, string>) {
  const response = await request.get(`${apiOrigin}/api`, { params, timeout: DEFAULT_TIMEOUT_MS });
  expect(
    response.ok(),
    `the node answered HTTP ${response.status()} for ${JSON.stringify(params)} — the chain the ` +
      'wallet talks to is not answering, so nothing below can be verified',
  ).toBe(true);
  return response.json();
}

/** The completed-transactions table of the logged-in account, first row. */
async function firstCompletedRow(page: Page) {
  await page.goto('#/wallet/account/transactions');
  const row = page.locator('app-completed-transactions datatable-body-row').first();
  await expect(
    row,
    'the completed-transactions table of Test Account 1 rendered no row — the click paths into the ' +
      'detail views start there, so the account must carry at least one confirmed transaction',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  return row;
}

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('detail-views: transaction-details shows the clicked transaction as the node reports it', async ({
  page,
  request,
  baseURL,
}) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const row = await firstCompletedRow(page);
  const links = row.locator('a.hyperlink');
  const clickedSender = ((await links.nth(0).textContent()) ?? '').trim();
  const clickedRecipient = ((await links.nth(1).textContent()) ?? '').trim();
  expect(
    clickedSender,
    'the transaction row shows no sender address — the senderRS column stopped binding',
  ).toMatch(/^XIN-/);

  await row.locator('a:has(i.fa-list-ul)').click();
  await page.waitForURL(/transactions\/transaction-details/, { timeout: DEFAULT_TIMEOUT_MS });

  const fields = page.locator('app-transaction-detail h4');
  // `transaction` is initialised to {} (truthy), so the card renders with blank
  // fields before searchTransactionById answers — poll instead of reading once.
  await expect(
    fields.nth(TX_ID),
    'transaction-details never filled in a transaction id — DataStoreService carried no id from the ' +
      'clicked row, or SearchService.searchTransactionById returned an error object',
  ).toHaveText(/^\s*\d+\s*$/, { timeout: DEFAULT_TIMEOUT_MS });

  const txId = ((await fields.nth(TX_ID).textContent()) ?? '').trim();
  const tx = await api(request, apiOrigin, { requestType: 'getTransaction', transaction: txId });
  expect(
    tx.errorCode,
    `the id shown by transaction-details (${txId}) is unknown to the node: ${tx.errorDescription} — ` +
      'the view rendered an identifier that does not exist on chain',
  ).toBeUndefined();

  // The view must be about the row that was clicked, not just about *some* tx.
  await expect(
    fields.nth(TX_SENDER),
    `transaction-details shows sender ${await fields.nth(TX_SENDER).textContent()} but the clicked row ` +
      `was sent by ${clickedSender} — the click path handed over the wrong transaction`,
  ).toHaveText(clickedSender);
  await expect(
    fields.nth(TX_RECIPIENT),
    `transaction-details shows a different recipient than the clicked row (${clickedRecipient})`,
  ).toHaveText(clickedRecipient);

  // ... and it must be the account's own transaction, not an unrelated one.
  const list = await api(request, apiOrigin, {
    requestType: 'getBlockchainTransactions',
    account: TEST_ACCOUNT_1_ID,
    firstIndex: '0',
    lastIndex: '24',
  });
  const listedIds: string[] = (list.transactions ?? []).map((t: any) => t.transaction);
  expect(
    listedIds,
    `the opened transaction ${txId} is not among the 25 newest transactions of the account whose ` +
      'list was clicked — the row index and the DataStore entry are out of sync',
  ).toContain(txId);

  // Chain truth for every scalar the view renders.
  await expect(
    fields.nth(TX_BLOCK),
    `transaction-details shows the wrong block id for ${txId} (node says ${tx.block})`,
  ).toHaveText(tx.block);
  await expect(
    fields.nth(TX_HEIGHT),
    `transaction-details shows the wrong block height for ${txId} (node says ${tx.height})`,
  ).toHaveText(String(tx.height));

  const shown = {
    amount: shownAmount((await fields.nth(TX_AMOUNT).textContent()) ?? ''),
    fee: shownAmount((await fields.nth(TX_FEE).textContent()) ?? ''),
  };
  expect(
    shown.amount,
    `transaction-details shows ${shown.amount} XIN but the node reports ${tx.amountTQT} TQT for ${txId} ` +
      '— the amountTqt pipe or the amountTQT binding is broken',
  ).toBe(expectedAmount(tx.amountTQT));
  expect(
    shown.fee,
    `transaction-details shows a fee of ${shown.fee} XIN but the node reports ${tx.feeTQT} TQT for ${txId}`,
  ).toBe(expectedAmount(tx.feeTQT));
});

test('detail-views: account-details shows the clicked account as the node reports it', async ({
  page,
  request,
  baseURL,
}) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const row = await firstCompletedRow(page);
  const senderLink = row.locator('a.hyperlink').first();
  const clickedRs = ((await senderLink.textContent()) ?? '').trim();
  expect(clickedRs, 'the sender column of the transaction row is empty').toMatch(/^XIN-/);

  await senderLink.click();
  await page.waitForURL(/transactions\/account-details\?id=XIN-/, { timeout: DEFAULT_TIMEOUT_MS });

  const fields = page.locator('app-account-detail h4');
  await expect(
    fields.nth(ACC_RS),
    `account-details did not render the address of the clicked account (${clickedRs}) — the id travels ` +
      'as a query param here, so an empty field means getAccount failed or the binding broke',
  ).toHaveText(clickedRs, { timeout: DEFAULT_TIMEOUT_MS });

  const account = await api(request, apiOrigin, { requestType: 'getAccount', account: clickedRs });
  expect(
    account.errorCode,
    `the node does not know the account the wallet linked to (${clickedRs}): ${account.errorDescription}`,
  ).toBeUndefined();

  const balance = shownAmount((await fields.nth(ACC_BALANCE).textContent()) ?? '');
  expect(
    balance,
    `account-details shows a balance of ${balance} XIN for ${clickedRs} but the node reports ` +
      `${account.balanceTQT} TQT`,
  ).toBe(expectedAmount(account.balanceTQT));

  // Tab 1 (public key) is the active tab, so its input is in the DOM. An account
  // that never sent a transaction has none — the noOutbound pipe substitutes a sentence.
  await expect(
    page.locator('app-account-detail input.form-control').first(),
    `account-details shows a public key that is not the one the node holds for ${clickedRs} ` +
      `(${account.publicKey ?? 'none'}) — the noOutbound pipe or the tab binding regressed`,
  ).toHaveValue(account.publicKey ?? /no outbound transaction made/i);
});

test('detail-views: chain-viewer block search opens block-transaction-details for the clicked height', async ({
  page,
  request,
  baseURL,
}) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  await page.goto('#/wallet/tools/chain-viewer/blocks');
  const blockRow = page.locator('app-blocks datatable-body-row').first();
  await expect(
    blockRow,
    'the chain-viewer block list rendered no row — ExtensionsService.getBlocks returned nothing',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const clickedHeight = ((await blockRow.locator('a.btn-primary').textContent()) ?? '').trim();
  await blockRow.locator('a.btn-primary').click();
  await page.waitForURL(/chain-viewer\/block-transaction-details\?id=\d+/, { timeout: DEFAULT_TIMEOUT_MS });

  const height = (page.url().match(/block-transaction-details\?id=(\d+)/) ?? [])[1];
  expect(
    height,
    `the block list opened height ${height} although the clicked row said ${clickedHeight} — the Details ` +
      'column no longer passes the height of the row it belongs to',
  ).toBe(clickedHeight);

  const block = await api(request, apiOrigin, {
    requestType: 'getBlock',
    height,
    includeTransactions: 'true',
  });
  expect(
    block.errorCode,
    `the node has no block at height ${height}: ${block.errorDescription}`,
  ).toBeUndefined();

  const cells = page.locator('app-block-transaction-details ngx-datatable').first().locator('datatable-body-cell');
  await expect(
    cells.nth(BLK_HEIGHT),
    `block-transaction-details rendered no row for height ${height} — the forkJoin over ` +
      'searchBlocks/searchBlockById/searchTransactionById produced nothing',
  ).toHaveText(String(height), { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    cells.nth(BLK_ID),
    `block-transaction-details shows the wrong block id for height ${height} (node says ${block.block})`,
  ).toHaveText(block.block);
  await expect(
    cells.nth(BLK_TX_COUNT),
    `block-transaction-details shows the wrong transaction count for height ${height} ` +
      `(node says ${block.numberOfTransactions})`,
  ).toHaveText(String(block.numberOfTransactions));
  await expect(
    cells.nth(BLK_GENERATOR),
    `block-transaction-details shows the wrong generator for height ${height} (node says ${block.generatorRS})`,
  ).toHaveText(block.generatorRS);
});

test(
  'detail-views: the height link of block-transaction-details opens block-details for that block ' +
    '(was dead: it navigated to /extensions/chain-viewer/…, but the module is mounted at /tools)',
  async ({ page, request, baseURL }) => {
    const apiOrigin = apiOriginFromBaseURL(baseURL);

    await page.goto('#/wallet/tools/chain-viewer/blocks');
    const blockRow = page.locator('app-blocks datatable-body-row').first();
    await expect(blockRow, 'the chain-viewer block list rendered no row').toBeVisible({
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await blockRow.locator('a.btn-primary').click();
    await page.waitForURL(/block-transaction-details\?id=\d+/, { timeout: DEFAULT_TIMEOUT_MS });

    // Second hop: the Height cell writes {type:'onlyID', view:'blockDetail'} into
    // DataStoreService — the only path in the wallet into the blockDetail branch.
    const height = (page.url().match(/id=(\d+)/) ?? [])[1];
    const cells = page.locator('app-block-transaction-details ngx-datatable').first().locator('datatable-body-cell');
    await expect(cells.nth(BLK_HEIGHT), 'the block row did not render').toHaveText(String(height), {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await cells.nth(BLK_HEIGHT).locator('a.btn-primary').click();
    await page.waitForURL(/chain-viewer\/block-details/, { timeout: DEFAULT_TIMEOUT_MS });

    const block = await api(request, apiOrigin, { requestType: 'getBlock', height });
    const fields = page.locator('app-transaction-detail h4');
    await expect(
      fields.nth(0),
      `block-details did not render the block id for height ${height} (node says ${block.block})`,
    ).toHaveText(block.block, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      fields.nth(2),
      `block-details shows the wrong generator for height ${height} (node says ${block.generatorRS})`,
    ).toHaveText(block.generatorRS);
  },
);

/** A block with at least one transaction, found through TEST_ACCOUNT_1's history. */
async function blockWithTransaction(request: APIRequestContext, apiOrigin: string) {
  const history = await api(request, apiOrigin, {
    requestType: 'getBlockchainTransactions',
    account: TEST_ACCOUNT_1_ID,
    lastIndex: '0',
  });
  const tx = history.transactions?.[0];
  expect(tx, 'TEST_ACCOUNT_1 has no confirmed transaction to look up').toBeTruthy();
  return { height: String(tx.height), transaction: String(tx.transaction) };
}

test('detail-views: the Details button of a block transaction opens transaction-details for it', async ({
  page,
  request,
  baseURL,
}) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { height } = await blockWithTransaction(request, apiOrigin);

  await page.goto(`#/wallet/tools/chain-viewer/block-transaction-details?id=${height}`);
  const txRow = page
    .locator('app-block-transaction-details ngx-datatable')
    .nth(1)
    .locator('datatable-body-row')
    .filter({ has: page.locator('a.btn-primary') })
    .first();
  await expect(txRow, `block ${height} lists no transaction`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await txRow.locator('a.btn-primary:has(i.fa-list-ul)').click();
  await page.waitForURL(/chain-viewer\/transaction-details/, { timeout: DEFAULT_TIMEOUT_MS });

  const idField = page.locator('app-transaction-detail h4').nth(TX_ID);
  await expect(idField, 'transaction-details never filled in a transaction id').toHaveText(/^\s*\d+\s*$/, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const shown = ((await idField.textContent()) ?? '').trim();
  const tx = await api(request, apiOrigin, { requestType: 'getTransaction', transaction: shown });
  expect(tx.errorCode, `transaction-details shows ${shown}, which the node does not know`).toBeUndefined();
  expect(String(tx.height), `transaction-details opened a transaction that is not in block ${height}`).toBe(height);
});

test('detail-views: the generator link of block-transaction-details opens account-details for the generator', async ({
  page,
  request,
  baseURL,
}) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { height } = await blockWithTransaction(request, apiOrigin);
  const block = await api(request, apiOrigin, { requestType: 'getBlock', height });

  await page.goto(`#/wallet/tools/chain-viewer/block-transaction-details?id=${height}`);
  const cells = page.locator('app-block-transaction-details ngx-datatable').first().locator('datatable-body-cell');
  await expect(cells.nth(BLK_GENERATOR), 'the block row did not render').toHaveText(block.generatorRS, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await cells.nth(BLK_GENERATOR).locator('a.hyperlink').click();
  await page.waitForURL(/chain-viewer\/account-details\?id=XIN-/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('app-account-detail h4').nth(ACC_RS),
    `account-details does not show the generator ${block.generatorRS} of block ${height}`,
  ).toHaveText(block.generatorRS, { timeout: DEFAULT_TIMEOUT_MS });
});

/**
 * Unconfirmed transactions vanish within one devnet block (~3 s), so the list is
 * served from a route: empty first, then a real transaction in the shape
 * getUnconfirmedTransactions returns (field `transaction`, like getTransaction).
 */
async function routeUnconfirmed(page: Page, request: APIRequestContext, apiOrigin: string) {
  const { height } = await blockWithTransaction(request, apiOrigin);
  const block = await api(request, apiOrigin, { requestType: 'getBlock', height, includeTransactions: 'true' });
  const tx = block.transactions[0];
  let calls = 0;
  await page.route(/requestType=getUnconfirmedTransactions/, (route) => {
    calls += 1;
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ unconfirmedTransactions: calls === 1 ? [] : [tx], requestProcessingTime: 0 }),
    });
  });
  return { tx, calls: () => calls };
}

test('detail-views: the reload button of chain-viewer/unconfirmed reloads the list', async ({
  page,
  request,
  baseURL,
}) => {
  const { tx, calls } = await routeUnconfirmed(page, request, apiOriginFromBaseURL(baseURL));

  await page.goto('#/wallet/tools/chain-viewer/unconfirmed');
  const rows = page.locator('app-unconfirmed datatable-body-row');
  await expect.poll(calls, { message: 'the view never asked for unconfirmed transactions', timeout: DEFAULT_TIMEOUT_MS }).toBe(1);
  await expect(rows).toHaveCount(0);

  await page.locator('app-unconfirmed a.btn-grey:has(i.fa-refresh)').click();
  await expect
    .poll(calls, { message: 'the reload button did not request the unconfirmed transactions again', timeout: DEFAULT_TIMEOUT_MS })
    .toBe(2);
  await expect(rows, `the reloaded list does not show transaction ${tx.transaction}`).toHaveCount(1, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
});

test('detail-views: the Details button of chain-viewer/unconfirmed opens transaction-details for the row', async ({
  page,
  request,
  baseURL,
}) => {
  const { tx } = await routeUnconfirmed(page, request, apiOriginFromBaseURL(baseURL));

  await page.goto('#/wallet/tools/chain-viewer/unconfirmed');
  await page.locator('app-unconfirmed a.btn-grey:has(i.fa-refresh)').click();
  const row = page.locator('app-unconfirmed datatable-body-row').first();
  await expect(row).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await row.locator('a.btn-primary:has(i.fa-list-ul)').click();
  await page.waitForURL(/chain-viewer\/transaction-details/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('app-transaction-detail h4').nth(TX_ID),
    `transaction-details does not show the transaction of the clicked row (${tx.transaction})`,
  ).toHaveText(tx.transaction, { timeout: DEFAULT_TIMEOUT_MS });
});

test('detail-views: the chain-viewer transaction list opens transaction-details', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  await page.goto('#/wallet/tools/chain-viewer/transactions');
  const txRow = page.locator('app-transactions datatable-body-row').first();
  await expect(
    txRow,
    'the chain-viewer transaction list rendered no row — ExtensionsService.getTransactions returned nothing',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await txRow.locator('a:has(i.fa-list-ul)').click();
  await page.waitForURL(/chain-viewer\/transaction-details/, { timeout: DEFAULT_TIMEOUT_MS });

  const fields = page.locator('app-transaction-detail h4');
  await expect(
    fields.nth(TX_ID),
    'transaction-details opened from the chain viewer never filled in a transaction id',
  ).toHaveText(/^\s*\d+\s*$/, { timeout: DEFAULT_TIMEOUT_MS });

  const txId = ((await fields.nth(TX_ID).textContent()) ?? '').trim();
  const tx = await api(request, apiOrigin, { requestType: 'getTransaction', transaction: txId });
  expect(
    tx.errorCode,
    `the id shown by transaction-details (${txId}) is unknown to the node: ${tx.errorDescription}`,
  ).toBeUndefined();
  await expect(
    fields.nth(TX_SENDER),
    `transaction-details shows a sender the node does not report for ${txId} (${tx.senderRS})`,
  ).toHaveText(tx.senderRS);
});

test(
  'detail-views: the chain-viewer peers table lists the crawled peers and opens node-details for the clicked one',
  async ({ page, request, baseURL }) => {
    const peerApi = `${apiOriginFromBaseURL(baseURL)}/peerexplorer-backend/api/nodes`;
    const crawled = await (await request.get(peerApi, { params: { page: 1, results: 10 } })).json();
    expect(Array.isArray(crawled) && crawled.length, 'the peerexplorer backend reports no peers').toBeTruthy();

    await page.goto('#/wallet/tools/chain-viewer/peers');
    const rows = page.locator('app-peers datatable-body-row');
    await expect(
      rows,
      'the peers table does not list the peers the peerexplorer backend reports — getPeers queried the wrong ' +
        'backend or the rows were not mapped from peerState',
    ).toHaveCount(crawled.length, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(page.locator('.swal2-popup'), 'the peers view raised an error dialog').toHaveCount(0);

    const peerRow = rows.first();
    const address = ((await peerRow.locator('a.btn-primary').textContent()) ?? '').trim();
    expect(address, 'the Node Details column does not show an IP address').toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    await peerRow.locator('a.btn-primary').click();
    await page.waitForURL(/chain-viewer\/node-details\?id=/, { timeout: DEFAULT_TIMEOUT_MS });
    expect(page.url(), 'node-details was opened for a different peer than the one clicked').toContain(address);

    const peer = await (await request.get(peerApi, { params: { ip: address } })).json();
    await expect(
      page.locator('app-node-details'),
      `node-details does not show the version ${peer.peerState?.version} the peerexplorer backend reports for ${address}`,
    ).toContainText(peer.peerState.version, { timeout: DEFAULT_TIMEOUT_MS });
  },
);
