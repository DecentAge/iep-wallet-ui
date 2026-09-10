import { test, expect } from '../../../fixtures/test';
import { APIRequestContext, Locator, Page } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TradeDeskPage } from '../../../pages/trade-desk.page';
import { TradeDeskOrderConfirmPage } from '../../../pages/trade-desk-order-confirm.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';
import {
  issueExchangeableCurrency,
  ExchangeableCurrency,
  TQT_PER_XIN,
} from '../../../helpers/issue-exchangeable-currency';

/**
 * Trade desk Buy/Sell masks (`#/wallet/currencies/trade/:id`) → currencyBuy /
 * currencySell.
 *
 * Risk: the desk takes XIN per share and a share count, the chain wants TQT per
 * QNT and QNT. Both conversions go through `decimals` in opposite directions and
 * cancel in the product, so a lost `decimals` still renders a plausible form and
 * books a wildly wrong amount. Hence a 2-decimal currency and TQT deltas on both
 * accounts. The counter offer comes from TEST_ACCOUNT_2 because iep-node happily
 * matches an account against its own offer, which would move money in a circle.
 */

const DECIMALS = 2;
const UNITS_PER_SHARE = 10 ** DECIMALS;

const CURRENCY_SUPPLY_QNT = 100_000;
const OFFER_UNITS_QNT = 2_000;
const SELLER_STOCK_QNT = 5_000;
const OFFER_LIFETIME_BLOCKS = 500;

const BUY_RATE_XIN = 3;
const BUY_SHARES = 4;

const SELL_RATE_XIN = 2;
const SELL_SHARES = 7;

/** 4.6 * 1e8 is 459999999.99999994 in binary floating point. */
const FRACTIONAL_RATE_XIN = 4.6;
const FRACTIONAL_SHARES = 5;

/** The desk hard-codes a 1 XIN fee on both order forms. */
const FEE_TQT = BigInt(TQT_PER_XIN);

const TYPE_MONETARY_SYSTEM = 5;
const SUBTYPE_EXCHANGE_BUY = 5;
const SUBTYPE_EXCHANGE_SELL = 6;

const unitsQnt = (shares: number) => shares * UNITS_PER_SHARE;
const rateTqtPerQnt = (xinPerShare: number) => Math.round(xinPerShare * TQT_PER_XIN) / UNITS_PER_SHARE;
const totalTqt = (xinPerShare: number, shares: number) =>
  BigInt(Math.round(xinPerShare * shares)) * BigInt(TQT_PER_XIN);

const enUs = (value: number, decimals: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: decimals });

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function apiGet(
  request: APIRequestContext,
  apiOrigin: string,
  params: Record<string, string>,
): Promise<any> {
  const response = await request.get(`${apiOrigin}/api`, { params, timeout: DEFAULT_TIMEOUT_MS });
  expect(
    response.ok(),
    `${params.requestType} returned HTTP ${response.status()} — is the node API reachable at ${apiOrigin}/api?`,
  ).toBe(true);
  return response.json();
}

/** Fixture-only: the node signs server-side; the wallet always signs in-browser. */
async function apiBroadcast(
  request: APIRequestContext,
  apiOrigin: string,
  what: string,
  form: Record<string, string>,
): Promise<string> {
  const response = await request.post(`${apiOrigin}/api`, {
    form: { ...form, feeTQT: String(TQT_PER_XIN), deadline: '1440' },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const body = await response.json();
  if (!body.transaction || body.broadcasted !== true) {
    throw new Error(`${what} fixture was rejected by the node: ${JSON.stringify(body)}`);
  }
  return body.transaction as string;
}

async function awaitConfirmed(
  request: APIRequestContext,
  apiOrigin: string,
  txIds: string[],
  what: string,
): Promise<void> {
  const deadline = Date.now() + 6 * DEFAULT_TIMEOUT_MS;
  for (const txId of txIds) {
    let seen = false;
    while (!seen && Date.now() < deadline) {
      const tx = await apiGet(request, apiOrigin, { requestType: 'getTransaction', transaction: txId });
      if (tx.block) {
        seen = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!seen) {
      throw new Error(`${what}: tx ${txId} never made it into a block — devnet forging stalled?`);
    }
  }
}

async function chainHeight(request: APIRequestContext, apiOrigin: string): Promise<number> {
  const status = await apiGet(request, apiOrigin, { requestType: 'getBlockchainStatus' });
  const height = Number(status.numberOfBlocks);
  expect(
    Number.isInteger(height) && height > 0,
    `getBlockchainStatus returned numberOfBlocks=${status.numberOfBlocks} — devnet not forging?`,
  ).toBe(true);
  return height;
}

/** Unused side keeps the same rate with zeroed limit/supply: the chain rejects a 0 rate. */
async function publishCounterOffer(
  request: APIRequestContext,
  apiOrigin: string,
  currencyId: string,
  side: 'sell' | 'buy',
  rateTQT: number,
  unitsOnBook: number,
): Promise<string> {
  const height = await chainHeight(request, apiOrigin);
  const offered = String(unitsOnBook);
  const txId = await apiBroadcast(request, apiOrigin, `publishExchangeOffer (${side} side)`, {
    requestType: 'publishExchangeOffer',
    secretPhrase: TEST_ACCOUNT_2_PASSPHRASE,
    currency: currencyId,
    buyRateTQT: String(rateTQT),
    sellRateTQT: String(rateTQT),
    totalBuyLimit: side === 'buy' ? offered : '0',
    initialBuySupply: side === 'buy' ? offered : '0',
    totalSellLimit: side === 'sell' ? offered : '0',
    initialSellSupply: side === 'sell' ? offered : '0',
    expirationHeight: String(height + OFFER_LIFETIME_BLOCKS),
  });
  return txId;
}

async function balanceTqt(
  request: APIRequestContext,
  apiOrigin: string,
  accountRs: string,
): Promise<bigint> {
  const account = await apiGet(request, apiOrigin, { requestType: 'getAccount', account: accountRs });
  expect(
    account.balanceTQT,
    `getAccount(${accountRs}) returned no balanceTQT: ${JSON.stringify(account)}`,
  ).toBeTruthy();
  // BigInt: devnet balances exceed Number.MAX_SAFE_INTEGER.
  return BigInt(account.balanceTQT);
}

/** `{}` comes back for an account that holds none of the currency yet. */
async function holding(
  request: APIRequestContext,
  apiOrigin: string,
  accountRs: string,
  currencyId: string,
): Promise<{ units: number; unconfirmedUnits: number }> {
  const held = await apiGet(request, apiOrigin, {
    requestType: 'getAccountCurrencies',
    account: accountRs,
    currency: currencyId,
  });
  return {
    units: Number(held.units ?? 0),
    unconfirmedUnits: Number(held.unconfirmedUnits ?? 0),
  };
}

async function exchangesFor(
  request: APIRequestContext,
  apiOrigin: string,
  currencyId: string,
): Promise<any[]> {
  const book = await apiGet(request, apiOrigin, { requestType: 'getExchanges', currency: currencyId });
  return (book.exchanges ?? []) as any[];
}

/** Each value sits in the element right after its `div.ucsb` label. */
function deskField(page: Page, label: string): Locator {
  return page.locator(
    `xpath=//div[contains(@class,"ucsb")][normalize-space(.)="${label}"]/following-sibling::*[1]`,
  );
}

/** The book right below an order form (Buy form → Offers to Sell). */
function bookBelow(page: Page, formButtonClass: string): Locator {
  return page
    .locator(`form.inner-form:has(button.${formButtonClass})`)
    .locator('xpath=following-sibling::ngx-datatable[1]');
}

/** Mirror of `TradeDeskPage.placeSellOrder`, which only covers the ask form. */
async function placeBuyOrder(page: Page, priceXin: number, shares: number): Promise<void> {
  const form = page.locator('form.inner-form:has(button.btn-green)');
  const price = form.locator('input[name="price"]');
  const quantity = form.locator('input[name="quantity"]');

  await expect(price, 'bid order form did not render on the trade desk').toBeVisible({
    timeout: DEFAULT_TIMEOUT_MS,
  });

  await price.fill(String(priceXin));
  await quantity.fill(String(shares));
  await quantity.blur();

  await expect(
    form.locator('input[name="totalPrice"]'),
    `the bid form total is not ${priceXin} XIN x ${shares} shares — buyFormOnChange() no longer ` +
    'multiplies price by quantity, so the user is shown a cost that is not the one being signed',
  ).toHaveValue(new RegExp(`^${priceXin * shares}(\\.0+)?$`), { timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    form.locator('button.btn-green'),
    'Buy stayed disabled although price and quantity are filled — the f1 ngForm validators changed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await form.locator('button.btn-green').click();
}

/** getAllCurrencies orders by id, so a fresh code lands on an arbitrary page. */
async function openTradeDeskFromCurrencyList(page: Page, code: string, maxPages = 25): Promise<void> {
  await page.goto('#/wallet/currencies/show-currencies/all');
  const rows = page.locator('ngx-datatable datatable-body-row');

  for (let visited = 0; visited < maxPages; visited++) {
    await rows.first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS }).catch(() => undefined);

    const row = rows.filter({ hasText: code }).first();
    if (await row.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await row.locator('a:has(i.fa-bar-chart)').first().click();
      return;
    }

    const nextItem = page.locator('ngx-datatable li:has(a[aria-label="go to next page"])').first();
    if (!(await nextItem.isVisible().catch(() => false))) break;
    if (((await nextItem.getAttribute('class')) ?? '').includes('disabled')) break;

    // Old rows stay on screen during the refetch.
    const refetched = page.waitForResponse(
      (response) => response.url().includes('requestType=getAllCurrencies'),
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    await nextItem.locator('a').first().click();
    await refetched.catch(() => undefined);
  }

  throw new Error(
    `currency ${code} never appeared on the All tab of show-currencies within ${maxPages} pages — ` +
    'the list stopped calling getAllCurrencies, or its pager no longer advances',
  );
}

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('trade desk buy: currencyBuy pays units x rate and credits exactly those units', async ({ page, request, baseURL, infoAlerts }) => {
  test.slow();
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const currency: ExchangeableCurrency = await issueExchangeableCurrency(
    request,
    apiOrigin,
    TEST_ACCOUNT_2_PASSPHRASE,
    { supply: CURRENCY_SUPPLY_QNT, decimals: DECIMALS },
  );
  const offerTx = await publishCounterOffer(
    request,
    apiOrigin,
    currency.currencyId,
    'sell',
    rateTqtPerQnt(BUY_RATE_XIN),
    OFFER_UNITS_QNT,
  );
  await awaitConfirmed(request, apiOrigin, [offerTx], 'counter sell offer');

  const buyerBefore = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_1_RS);
  const sellerBefore = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_2_RS);
  const buyerUnitsBefore = await holding(request, apiOrigin, TEST_ACCOUNT_1_RS, currency.currencyId);

  const desk = new TradeDeskPage(page);
  await desk.goto(currency.currencyId);
  await placeBuyOrder(page, BUY_RATE_XIN, BUY_SHARES);

  const confirm = new TradeDeskOrderConfirmPage(page);
  await confirm.expectOrder(currency.currencyId, currency.name, BUY_RATE_XIN, BUY_SHARES);
  await confirm.expectSignedBytes();

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, confirm.finishButton);
  await expect
    .poll(() => infoAlerts.last()?.kind, {
      message: 'the desk did not report a successful broadcast — the buy order never left the wallet',
    })
    .toBe('success');

  expect(
    [tx.type, tx.subtype],
    `the desk's Buy button signed type/subtype ${tx.type}/${tx.subtype}; ` +
    `${TYPE_MONETARY_SYSTEM}/${SUBTYPE_EXCHANGE_BUY} is EXCHANGE_BUY — the bid form built the wrong request type`,
  ).toEqual([TYPE_MONETARY_SYSTEM, SUBTYPE_EXCHANGE_BUY]);
  expect(tx.attachment?.currency, 'the buy order was signed against the wrong currency').toBe(currency.currencyId);
  expect(
    tx.attachment?.units,
    `the wallet signed units=${tx.attachment?.units} for ${BUY_SHARES} shares of a ${DECIMALS}-decimal ` +
    `currency; the chain counts in QNT, so it must be ${unitsQnt(BUY_SHARES)} — a raw ${BUY_SHARES} means ` +
    'shareToQuantity() lost the decimals and the order is 100x too small',
  ).toBe(String(unitsQnt(BUY_SHARES)));
  expect(
    tx.attachment?.rateTQT,
    `the wallet signed rateTQT=${tx.attachment?.rateTQT} for ${BUY_RATE_XIN} XIN per share; the chain ` +
    `rate is per QNT, so it must be ${rateTqtPerQnt(BUY_RATE_XIN)} — ${BUY_RATE_XIN * TQT_PER_XIN} means ` +
    'the 10^decimals division in buyCurrency() is gone and every unit costs 100x too much',
  ).toBe(String(rateTqtPerQnt(BUY_RATE_XIN)));
  expect(tx.feeTQT, 'the desk charges a flat 1 XIN fee on an order').toBe(String(FEE_TQT));

  await expect
    .poll(() => exchangesFor(request, apiOrigin, currency.currencyId).then((list) => list.length), {
      message:
        `${currency.code} recorded no exchange for the confirmed buy order ${txId} — the transaction ` +
        'was accepted but matched no offer, so nothing was actually traded',
    })
    .toBe(1);

  const [exchange] = await exchangesFor(request, apiOrigin, currency.currencyId);
  expect(exchange.transaction, 'the recorded exchange belongs to a different transaction').toBe(txId);
  expect(exchange.buyerRS, 'the buyer on chain is not the account that placed the order').toBe(TEST_ACCOUNT_1_RS);
  expect(exchange.sellerRS, 'the counterparty is not the account that published the offer').toBe(TEST_ACCOUNT_2_RS);
  expect(exchange.units, 'the exchange moved a different number of units than ordered').toBe(String(unitsQnt(BUY_SHARES)));
  expect(exchange.rateTQT, 'the exchange settled at a different rate than the offer carried').toBe(
    String(rateTqtPerQnt(BUY_RATE_XIN)),
  );

  const buyerUnitsAfter = await holding(request, apiOrigin, TEST_ACCOUNT_1_RS, currency.currencyId);
  expect(
    buyerUnitsAfter.units - buyerUnitsBefore.units,
    `the buyer's confirmed holding moved by ${buyerUnitsAfter.units - buyerUnitsBefore.units} QNT ` +
    `instead of ${unitsQnt(BUY_SHARES)} — the units were paid for but not credited`,
  ).toBe(unitsQnt(BUY_SHARES));
  expect(
    buyerUnitsAfter.unconfirmedUnits - buyerUnitsBefore.unconfirmedUnits,
    'the bought units are confirmed but still locked out of the spendable balance',
  ).toBe(unitsQnt(BUY_SHARES));

  const expectedTotal = totalTqt(BUY_RATE_XIN, BUY_SHARES);
  const buyerAfter = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_1_RS);
  const sellerAfter = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_2_RS);
  expect(
    (buyerAfter - buyerBefore).toString(),
    `the buyer paid ${buyerBefore - buyerAfter} TQT for ${BUY_SHARES} shares at ${BUY_RATE_XIN} XIN; ` +
    `${expectedTotal} TQT plus the ${FEE_TQT} TQT fee is what the form promised. A factor of ` +
    `${UNITS_PER_SHARE} either way is the decimals scaling in buyCurrency()`,
  ).toBe((-(expectedTotal + FEE_TQT)).toString());
  expect(
    (sellerAfter - sellerBefore).toString(),
    `the offer owner received ${sellerAfter - sellerBefore} TQT instead of ${expectedTotal} — the buyer's ` +
    'money did not arrive in full at the counterparty',
  ).toBe(expectedTotal.toString());
});

test.fixme('trade desk buy: a fractional price reaches the chain unrounded — amountToQuant() truncates 4.6 XIN to 459999999 TQT, so the desk signs rateTQT 4599999 instead of 4600000, the order matches no offer (0 exchanges, 0 units credited) and the 1 XIN fee is lost while the wallet reports success', async ({ page, request, baseURL, infoAlerts }) => {
  test.slow();
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const currency: ExchangeableCurrency = await issueExchangeableCurrency(
    request,
    apiOrigin,
    TEST_ACCOUNT_2_PASSPHRASE,
    { supply: CURRENCY_SUPPLY_QNT, decimals: DECIMALS },
  );
  const offerTx = await publishCounterOffer(
    request,
    apiOrigin,
    currency.currencyId,
    'sell',
    rateTqtPerQnt(FRACTIONAL_RATE_XIN),
    OFFER_UNITS_QNT,
  );
  await awaitConfirmed(request, apiOrigin, [offerTx], 'counter sell offer');

  const buyerBefore = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_1_RS);
  const buyerUnitsBefore = await holding(request, apiOrigin, TEST_ACCOUNT_1_RS, currency.currencyId);

  const desk = new TradeDeskPage(page);
  await desk.goto(currency.currencyId);
  await placeBuyOrder(page, FRACTIONAL_RATE_XIN, FRACTIONAL_SHARES);

  const confirm = new TradeDeskOrderConfirmPage(page);
  await confirm.expectSignedBytes();

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, confirm.finishButton);
  await expect
    .poll(() => infoAlerts.last()?.kind, {
      message: 'the desk did not report a successful broadcast',
    })
    .toBe('success');

  expect(
    tx.attachment?.rateTQT,
    `the wallet signed rateTQT=${tx.attachment?.rateTQT} for ${FRACTIONAL_RATE_XIN} XIN per share; ` +
    `${rateTqtPerQnt(FRACTIONAL_RATE_XIN)} is the exact value. One TQT short is enough to drop the ` +
    'matching offer out of getAvailableSellOffers, so the order buys nothing and the fee is lost',
  ).toBe(String(rateTqtPerQnt(FRACTIONAL_RATE_XIN)));

  await expect
    .poll(() => exchangesFor(request, apiOrigin, currency.currencyId).then((list) => list.length), {
      message: `${currency.code} recorded no exchange for the confirmed buy order ${txId}`,
    })
    .toBe(1);

  const buyerUnitsAfter = await holding(request, apiOrigin, TEST_ACCOUNT_1_RS, currency.currencyId);
  expect(
    buyerUnitsAfter.units - buyerUnitsBefore.units,
    'the buyer was not credited the units the fractional-price order paid for',
  ).toBe(unitsQnt(FRACTIONAL_SHARES));

  const expectedTotal = totalTqt(FRACTIONAL_RATE_XIN, FRACTIONAL_SHARES);
  const buyerAfter = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_1_RS);
  expect(
    (buyerAfter - buyerBefore).toString(),
    `the buyer's balance moved by ${buyerAfter - buyerBefore} TQT; ${FRACTIONAL_SHARES} shares at ` +
    `${FRACTIONAL_RATE_XIN} XIN plus the ${FEE_TQT} TQT fee is ${-(expectedTotal + FEE_TQT)}`,
  ).toBe((-(expectedTotal + FEE_TQT)).toString());
});

test('trade desk sell: currencySell debits the units and books units x rate in XIN', async ({ page, request, baseURL, infoAlerts }) => {
  test.slow();
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const currency: ExchangeableCurrency = await issueExchangeableCurrency(
    request,
    apiOrigin,
    TEST_ACCOUNT_2_PASSPHRASE,
    { supply: CURRENCY_SUPPLY_QNT, decimals: DECIMALS },
  );
  const stockTx = await apiBroadcast(request, apiOrigin, 'transferCurrency', {
    requestType: 'transferCurrency',
    secretPhrase: TEST_ACCOUNT_2_PASSPHRASE,
    recipient: TEST_ACCOUNT_1_RS,
    currency: currency.currencyId,
    units: String(SELLER_STOCK_QNT),
  });
  const offerTx = await publishCounterOffer(
    request,
    apiOrigin,
    currency.currencyId,
    'buy',
    rateTqtPerQnt(SELL_RATE_XIN),
    OFFER_UNITS_QNT,
  );
  await awaitConfirmed(request, apiOrigin, [stockTx, offerTx], 'sell-side fixture');

  const sellerBefore = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_1_RS);
  const buyerBefore = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_2_RS);
  const sellerUnitsBefore = await holding(request, apiOrigin, TEST_ACCOUNT_1_RS, currency.currencyId);
  expect(
    sellerUnitsBefore.unconfirmedUnits,
    `the fixture transfer of ${SELLER_STOCK_QNT} QNT did not reach ${TEST_ACCOUNT_1_RS} — nothing to sell`,
  ).toBe(SELLER_STOCK_QNT);

  const desk = new TradeDeskPage(page);
  await desk.goto(currency.currencyId);
  await desk.placeSellOrder(SELL_RATE_XIN, SELL_SHARES);

  const confirm = new TradeDeskOrderConfirmPage(page);
  await confirm.expectOrder(currency.currencyId, currency.name, SELL_RATE_XIN, SELL_SHARES);
  await confirm.expectSignedBytes();

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, confirm.finishButton);
  await expect
    .poll(() => infoAlerts.last()?.kind, {
      message: 'the desk did not report a successful broadcast — the sell order never left the wallet',
    })
    .toBe('success');

  expect(
    [tx.type, tx.subtype],
    `the desk's Sell button signed type/subtype ${tx.type}/${tx.subtype}; ` +
    `${TYPE_MONETARY_SYSTEM}/${SUBTYPE_EXCHANGE_SELL} is EXCHANGE_SELL — the ask form built the wrong request type`,
  ).toEqual([TYPE_MONETARY_SYSTEM, SUBTYPE_EXCHANGE_SELL]);
  expect(tx.attachment?.currency, 'the sell order was signed against the wrong currency').toBe(currency.currencyId);
  expect(
    tx.attachment?.units,
    `the wallet signed units=${tx.attachment?.units} for ${SELL_SHARES} shares of a ${DECIMALS}-decimal ` +
    `currency; it must be ${unitsQnt(SELL_SHARES)} QNT`,
  ).toBe(String(unitsQnt(SELL_SHARES)));
  expect(
    tx.attachment?.rateTQT,
    `the wallet signed rateTQT=${tx.attachment?.rateTQT} for ${SELL_RATE_XIN} XIN per share; the chain ` +
    `rate is per QNT, so it must be ${rateTqtPerQnt(SELL_RATE_XIN)} — check the 10^decimals division in ` +
    'sellCurrency()',
  ).toBe(String(rateTqtPerQnt(SELL_RATE_XIN)));
  expect(tx.feeTQT, 'the desk charges a flat 1 XIN fee on an order').toBe(String(FEE_TQT));

  await expect
    .poll(() => exchangesFor(request, apiOrigin, currency.currencyId).then((list) => list.length), {
      message:
        `${currency.code} recorded no exchange for the confirmed sell order ${txId} — the order was ` +
        'accepted but matched no buy offer, so the units never changed hands',
    })
    .toBe(1);

  const [exchange] = await exchangesFor(request, apiOrigin, currency.currencyId);
  expect(exchange.transaction, 'the recorded exchange belongs to a different transaction').toBe(txId);
  expect(exchange.sellerRS, 'the seller on chain is not the account that placed the order').toBe(TEST_ACCOUNT_1_RS);
  expect(exchange.buyerRS, 'the counterparty is not the account that published the offer').toBe(TEST_ACCOUNT_2_RS);
  expect(exchange.units, 'the exchange moved a different number of units than ordered').toBe(String(unitsQnt(SELL_SHARES)));
  expect(exchange.rateTQT, 'the exchange settled at a different rate than the offer carried').toBe(
    String(rateTqtPerQnt(SELL_RATE_XIN)),
  );

  const sellerUnitsAfter = await holding(request, apiOrigin, TEST_ACCOUNT_1_RS, currency.currencyId);
  expect(
    sellerUnitsBefore.units - sellerUnitsAfter.units,
    `the seller gave up ${sellerUnitsBefore.units - sellerUnitsAfter.units} QNT instead of ` +
    `${unitsQnt(SELL_SHARES)} — the units billed differ from the units ordered`,
  ).toBe(unitsQnt(SELL_SHARES));
  expect(
    sellerUnitsBefore.unconfirmedUnits - sellerUnitsAfter.unconfirmedUnits,
    'the units reserved for the sell order were never released back into the spendable holding',
  ).toBe(unitsQnt(SELL_SHARES));

  const expectedTotal = totalTqt(SELL_RATE_XIN, SELL_SHARES);
  const sellerAfter = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_1_RS);
  const buyerAfter = await balanceTqt(request, apiOrigin, TEST_ACCOUNT_2_RS);
  expect(
    (sellerAfter - sellerBefore).toString(),
    `the seller took ${sellerAfter - sellerBefore} TQT for ${SELL_SHARES} shares at ${SELL_RATE_XIN} XIN; ` +
    `${expectedTotal} TQT minus the ${FEE_TQT} TQT fee is what the form promised. A factor of ` +
    `${UNITS_PER_SHARE} either way is the decimals scaling in sellCurrency()`,
  ).toBe((expectedTotal - FEE_TQT).toString());
  expect(
    (buyerAfter - buyerBefore).toString(),
    `the offer owner paid ${buyerBefore - buyerAfter} TQT instead of ${expectedTotal}`,
  ).toBe((-expectedTotal).toString());
});

test('trade desk route: the currency list hands over the id, and the desk renders that currency at its own decimals', async ({ page, request, baseURL }) => {
  test.slow();
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const currency: ExchangeableCurrency = await issueExchangeableCurrency(
    request,
    apiOrigin,
    TEST_ACCOUNT_2_PASSPHRASE,
    { supply: CURRENCY_SUPPLY_QNT, decimals: DECIMALS },
  );
  const offerTx = await publishCounterOffer(
    request,
    apiOrigin,
    currency.currencyId,
    'sell',
    rateTqtPerQnt(BUY_RATE_XIN),
    OFFER_UNITS_QNT,
  );
  await awaitConfirmed(request, apiOrigin, [offerTx], 'counter sell offer');

  await openTradeDeskFromCurrencyList(page, currency.code);

  await expect(
    page,
    `the currency list opened a trade desk for a different id than ${currency.currencyId} (${currency.code}) — ` +
    'openTradeDesk() is passing the wrong column, so the user would trade another currency',
  ).toHaveURL(new RegExp(`#/wallet/currencies/trade/${currency.currencyId}$`), { timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    deskField(page, 'Currency Id').locator('a.hyperlink'),
    'the desk shows a different currency id than the route carries — trade/:id and getCurrency drifted apart',
  ).toHaveText(currency.currencyId, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(deskField(page, 'Name'), 'the desk names the wrong currency').toHaveText(currency.name);
  await expect(deskField(page, 'Ticker'), 'the desk shows the wrong ticker').toHaveText(currency.code);
  await expect(
    deskField(page, 'Issuer').locator('a.hyperlink'),
    'the desk attributes the currency to the wrong issuer',
  ).toHaveText(TEST_ACCOUNT_2_RS);

  const supplyShares = CURRENCY_SUPPLY_QNT / UNITS_PER_SHARE;
  await expect(
    deskField(page, 'Supply'),
    `the desk shows the supply raw instead of scaled by the currency's ${DECIMALS} decimals — ` +
    `${CURRENCY_SUPPLY_QNT} QNT is ${supplyShares} units`,
  ).toHaveText(new RegExp(`^\\s*${escapeRe(enUs(supplyShares, DECIMALS))}\\s+UNITS\\s*$`));

  const sellBook = bookBelow(page, 'btn-green');
  const offerRow = sellBook.locator('datatable-body-row').first();
  await expect(
    offerRow,
    `the desk's sell book stayed empty although ${currency.code} carries the offer ${offerTx} — ` +
    'the desk is asking getSellOffers for the wrong currency',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const cells = offerRow.locator('datatable-body-cell');
  const offerShares = OFFER_UNITS_QNT / UNITS_PER_SHARE;
  await expect(
    cells.nth(0),
    `the book price is not the ${BUY_RATE_XIN} XIN per unit the offer carries — rateTqtToPrice lost the ` +
    'currency decimals, so the desk advertises a price nobody can trade at',
  ).toHaveText(enUs(BUY_RATE_XIN, DECIMALS));
  await expect(
    cells.nth(1),
    `the book quantity is not the ${offerShares} units the offer put up (${OFFER_UNITS_QNT} QNT)`,
  ).toHaveText(enUs(offerShares, DECIMALS));
  await expect(
    cells.nth(2),
    `the book sum is not quantity x price (${offerShares} x ${BUY_RATE_XIN} XIN)`,
  ).toHaveText(enUs(offerShares * BUY_RATE_XIN, DECIMALS));
});
