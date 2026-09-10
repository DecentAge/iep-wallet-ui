import { test, expect, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TradeDeskPage } from '../../../pages/trade-desk.page';
import { PublishExchangeOfferPage } from '../../../pages/publish-exchange-offer.page';
import { TradeDeskOrderConfirmPage } from '../../../pages/trade-desk-order-confirm.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_ID, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';
import {
  issueExchangeableCurrency,
  ExchangeableCurrency,
  TQT_PER_XIN,
} from '../../../helpers/issue-exchangeable-currency';

/**
 * Monetary System **currency exchange** — the three publish-offer wizards
 * under the trade desk (`#/wallet/currencies/trade/:id/publish-exchange-{,buy-,sell-}offer`)
 * plus the ask-order hand-off that turns into a `currencySell`.
 *
 * Two things drive the shape of this spec:
 *   - the wizards are **unreachable by URL**. `ngOnInit` reads the currency
 *     from the static `DataStoreService` and redirects back to the desk when
 *     the entry is missing, so every test has to click its way in from the
 *     desk.
 *   - one PUBLISH_EXCHANGE_OFFER attachment carries **both** sides of the
 *     book. The one-sided forms mirror the entered rate onto the other side
 *     and pin its limit/supply to 0, so a buy-only offer still creates a
 *     sell record. Asserting only "an offer exists" would miss swapped sides.
 *
 * Each test issues its own randomly-coded currency, which makes the spec
 * repeatable on one chain and lets every book/balance assertion be exact:
 * nothing else on the chain can touch that currency.
 *
 * Known wallet bug this spec rides on: the desk's order buttons bind
 * `[disabled]="f2.invalid && !enableSell"` (`&&` where `||` is meant), so Sell
 * stays clickable on a currency with an empty buy book. Repairing that binding
 * makes the ask-order test unreachable without a second account bidding first.
 *
 * Chain proof: `getOffer`, `getBuyOffers`, `getSellOffers`,
 * `getAccountCurrencies`, `getAccountExchangeRequests`.
 */

/** decimals=0 keeps rateTQT == rate * 1e8 and supply == the entered units. */
const CURRENCY_SUPPLY = 1000;

/** `MonetarySystem.SUBTYPE_MONETARY_SYSTEM_EXCHANGE_SELL`. */
const SUBTYPE_EXCHANGE_SELL = 6;

const BUY_ONLY_RATE_XIN = 2;
const BUY_ONLY_UNITS = 5;

const SELL_ONLY_RATE_XIN = 3;
const SELL_ONLY_UNITS = 4;

/** Two-sided offer. The chain requires buyRate <= sellRate. */
const TWO_SIDED_BUY_RATE_XIN = 1;
const TWO_SIDED_BUY_LIMIT = 8;
const TWO_SIDED_BUY_SUPPLY = 6;
const TWO_SIDED_SELL_RATE_XIN = 2;
const TWO_SIDED_SELL_LIMIT = 7;
const TWO_SIDED_SELL_SUPPLY = 5;

const ASK_ORDER_PRICE_XIN = 2;
const ASK_ORDER_UNITS = 3;

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

/** `numberOfBlocks` — the same field the wizard adds to the offer lifetime. */
async function chainHeight(request: APIRequestContext, apiOrigin: string): Promise<number> {
  const status = await apiGet(request, apiOrigin, { requestType: 'getBlockchainStatus' });
  const height = Number(status.numberOfBlocks);
  expect(
    Number.isInteger(height) && height > 0,
    `getBlockchainStatus returned numberOfBlocks=${status.numberOfBlocks} — devnet not forging?`,
  ).toBe(true);
  return height;
}

/** Offer ids are the id of the publishExchangeOffer transaction that created them. */
async function getOffer(request: APIRequestContext, apiOrigin: string, offerId: string): Promise<any> {
  const offer = await apiGet(request, apiOrigin, { requestType: 'getOffer', offer: offerId });
  expect(
    offer.errorCode,
    `getOffer found no offer for the broadcast transaction ${offerId} — the tx confirmed but ` +
    `did not create an exchange offer: ${JSON.stringify(offer)}`,
  ).toBeUndefined();
  return offer;
}

async function offerIdsOnBook(
  request: APIRequestContext,
  apiOrigin: string,
  requestType: 'getBuyOffers' | 'getSellOffers',
  currencyId: string,
): Promise<string[]> {
  // availableOnly mirrors what the trade desk itself asks for: it hides the
  // zero-supply counterpart record that every one-sided offer leaves behind.
  const book = await apiGet(request, apiOrigin, {
    requestType,
    currency: currencyId,
    availableOnly: 'true',
  });
  return ((book.offers ?? []) as any[]).map((entry) => entry.offer as string);
}

/**
 * The account's holding of one currency. `unconfirmedUnits` is where the
 * offer's `initialSellSupply` reservation shows up (`applyAttachmentUnconfirmed`);
 * `units` only moves when an exchange actually happens.
 */
async function accountHolding(
  request: APIRequestContext,
  apiOrigin: string,
  currencyId: string,
): Promise<any> {
  return apiGet(request, apiOrigin, {
    requestType: 'getAccountCurrencies',
    account: TEST_ACCOUNT_1_RS,
    currency: currencyId,
  });
}

/**
 * The wallet signs `expirationHeight = <lifetime on the form> + <chain height
 * from its own getBlockchainStatus>`. Pinning it to a range instead of a
 * single value keeps the check exact while tolerating blocks forged mid-test.
 */
function expectExpirationHeight(
  signParams: URLSearchParams,
  lifetimeBlocks: number,
  heightBefore: number,
  heightAfter: number,
): number {
  const raw = signParams.get('expirationHeight');
  const signed = Number(raw);
  const explain =
    `the wallet signed expirationHeight="${raw}"; it must be the ${lifetimeBlocks}-block lifetime ` +
    `on the form plus the chain height, i.e. between ${heightBefore + lifetimeBlocks} and ` +
    `${heightAfter + lifetimeBlocks}. A NaN means getBlockchainStatus had not answered when Next ` +
    `was clicked; a value near ${lifetimeBlocks} means currentHeight was never added and the offer ` +
    `expires in the past; roughly ${2 * heightBefore + lifetimeBlocks} means the chain height was ` +
    'added twice, i.e. the wizard signed off a form field it had already made absolute';
  expect(signed, explain).toBeGreaterThanOrEqual(heightBefore + lifetimeBlocks);
  expect(signed, explain).toBeLessThanOrEqual(heightAfter + lifetimeBlocks);
  return signed;
}

/**
 * Confirm → Previous → Next, the correction round trip every user makes who
 * mistypes a rate. The offer signed on the way out has to be the same offer:
 * the lifetime must still be a lifetime, and the second `expirationHeight`
 * must land in the same window as the first. Returns the height that was
 * signed last — that is the one the broadcast carries to the chain.
 */
async function resignAfterStepBack(
  wizard: PublishExchangeOfferPage,
  request: APIRequestContext,
  apiOrigin: string,
  lifetimeBlocks: number,
  heightBefore: number,
): Promise<number> {
  await wizard.returnToDetailsStep();
  await wizard.expectLifetimeUnchanged(lifetimeBlocks);

  const resignedParams = await wizard.submitDetailsStep();
  return expectExpirationHeight(
    resignedParams,
    lifetimeBlocks,
    heightBefore,
    await chainHeight(request, apiOrigin),
  );
}

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('publish-exchange-buy-offer: buy-only offer reaches the chain with a zeroed sell side', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const currency: ExchangeableCurrency = await issueExchangeableCurrency(
    request,
    apiOrigin,
    TEST_ACCOUNT_1_PASSPHRASE,
    { supply: CURRENCY_SUPPLY },
  );

  const desk = new TradeDeskPage(page);
  await desk.goto(currency.currencyId);

  const heightBefore = await chainHeight(request, apiOrigin);
  await desk.openPublishBuyOnlyOffer();

  const wizard = new PublishExchangeOfferPage(page);
  await wizard.expectDetailsStep(currency.currencyId, currency.code);
  const lifetimeBlocks = await wizard.expectPrefilledLifetimeBlocks();
  await wizard.expectLifetimeLabels(lifetimeBlocks);

  await wizard.input('buyRate').fill(String(BUY_ONLY_RATE_XIN));
  await wizard.input('initialBuySupply').fill(String(BUY_ONLY_UNITS));
  await wizard.input('initialBuySupply').blur();

  const signParams = await wizard.submitDetailsStep();
  expectExpirationHeight(signParams, lifetimeBlocks, heightBefore, await chainHeight(request, apiOrigin));

  const expirationHeight = await resignAfterStepBack(wizard, request, apiOrigin, lifetimeBlocks, heightBefore);

  expect(
    signParams.get('totalSellLimit'),
    'the buy-only form must pin the sell limit to 0 — it sent ' +
    `totalSellLimit=${signParams.get('totalSellLimit')}, which would open a sell side the user never asked for`,
  ).toBe('0');
  expect(
    signParams.get('initialSellSupply'),
    'the buy-only form must pin the initial sell supply to 0 — it sent ' +
    `initialSellSupply=${signParams.get('initialSellSupply')}`,
  ).toBe('0');
  expect(
    signParams.get('sellRateTQT'),
    'the buy-only form mirrors the entered rate onto the sell side; a lower sell rate than buy ' +
    'rate is rejected by the chain (buyRate <= sellRate)',
  ).toBe(signParams.get('buyRateTQT'));

  await wizard.expectConfirmValues({
    'Ticker': currency.code,
    'Currency Id': currency.currencyId,
    'Buy Rate': BUY_ONLY_RATE_XIN,
    'Units': BUY_ONLY_UNITS,
    'Expiration Height': expirationHeight,
  });
  await wizard.expectSignedBytes();

  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, wizard.finishButton);

  const offer = await getOffer(request, apiOrigin, txId);
  expect(offer.buyOffer?.currency, 'the offer was recorded against the wrong currency').toBe(currency.currencyId);
  expect(offer.buyOffer?.account, 'the offer was recorded against the wrong account').toBe(TEST_ACCOUNT_1_ID);
  expect(
    offer.buyOffer?.rateTQT,
    `on-chain buy rate does not match ${BUY_ONLY_RATE_XIN} XIN/unit — check the ` +
    'amountToQuant / 10^decimals conversion in publishExchangeOffer()',
  ).toBe(String(BUY_ONLY_RATE_XIN * TQT_PER_XIN));
  expect(offer.buyOffer?.supply, 'on-chain buy supply does not match the entered units').toBe(String(BUY_ONLY_UNITS));
  expect(
    offer.buyOffer?.limit,
    'the buy-only form sets the total buy limit from the entered units, so limit must equal supply',
  ).toBe(String(BUY_ONLY_UNITS));
  expect(
    offer.buyOffer?.expirationHeight,
    'the offer expires at a different height than the wallet signed for',
  ).toBe(expirationHeight);

  // The attachment always carries both sides; a buy-only offer is one whose
  // sell record exists but can never be hit.
  expect(
    offer.sellOffer?.supply,
    'a buy-only offer left a non-zero sell supply on chain — the buy and sell sides were swapped',
  ).toBe('0');
  expect(offer.sellOffer?.limit, 'a buy-only offer left a non-zero sell limit on chain').toBe('0');

  expect(
    await offerIdsOnBook(request, apiOrigin, 'getBuyOffers', currency.currencyId),
    `${currency.code}'s buy book must hold exactly the offer ${txId} just published`,
  ).toEqual([txId]);
  expect(
    await offerIdsOnBook(request, apiOrigin, 'getSellOffers', currency.currencyId),
    `${currency.code}'s sell book is not empty after a buy-only offer — the zero-supply sell ` +
    'record is being offered for trade',
  ).toEqual([]);

  const holding = await accountHolding(request, apiOrigin, currency.currencyId);
  expect(holding.units, 'the issued units left the account').toBe(String(CURRENCY_SUPPLY));
  expect(
    holding.unconfirmedUnits,
    'a buy-only offer locked currency units — only the XIN side should be reserved, so this ' +
    'means initialBuySupply was applied to the sell side',
  ).toBe(String(CURRENCY_SUPPLY));
});

test('publish-exchange-sell-offer: sell-only offer reaches the chain with a zeroed buy side', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const currency: ExchangeableCurrency = await issueExchangeableCurrency(
    request,
    apiOrigin,
    TEST_ACCOUNT_1_PASSPHRASE,
    { supply: CURRENCY_SUPPLY },
  );

  const desk = new TradeDeskPage(page);
  await desk.goto(currency.currencyId);

  const heightBefore = await chainHeight(request, apiOrigin);
  await desk.openPublishSellOnlyOffer();

  const wizard = new PublishExchangeOfferPage(page);
  await wizard.expectDetailsStep(currency.currencyId, currency.code);
  const lifetimeBlocks = await wizard.expectPrefilledLifetimeBlocks();
  await wizard.expectLifetimeLabels(lifetimeBlocks);

  await wizard.input('sellRate').fill(String(SELL_ONLY_RATE_XIN));
  await wizard.input('initialSellSupply').fill(String(SELL_ONLY_UNITS));
  await wizard.input('initialSellSupply').blur();

  const signParams = await wizard.submitDetailsStep();
  expectExpirationHeight(signParams, lifetimeBlocks, heightBefore, await chainHeight(request, apiOrigin));

  const expirationHeight = await resignAfterStepBack(wizard, request, apiOrigin, lifetimeBlocks, heightBefore);

  expect(
    signParams.get('totalBuyLimit'),
    `the sell-only form must pin the buy limit to 0 — it sent totalBuyLimit=${signParams.get('totalBuyLimit')}, ` +
    'which would lock XIN out of the account for a buy side the user never asked for',
  ).toBe('0');
  expect(
    signParams.get('initialBuySupply'),
    `the sell-only form must pin the initial buy supply to 0 — it sent initialBuySupply=${signParams.get('initialBuySupply')}`,
  ).toBe('0');
  expect(
    signParams.get('buyRateTQT'),
    'the sell-only form mirrors the entered rate onto the buy side',
  ).toBe(signParams.get('sellRateTQT'));

  await wizard.expectConfirmValues({
    'Ticker': currency.code,
    'Currency Id': currency.currencyId,
    'Sell Rate': SELL_ONLY_RATE_XIN,
    'Units': SELL_ONLY_UNITS,
    'Expiration Height': expirationHeight,
  });
  await wizard.expectSignedBytes();

  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, wizard.finishButton);

  const offer = await getOffer(request, apiOrigin, txId);
  expect(offer.sellOffer?.currency, 'the offer was recorded against the wrong currency').toBe(currency.currencyId);
  expect(offer.sellOffer?.account, 'the offer was recorded against the wrong account').toBe(TEST_ACCOUNT_1_ID);
  expect(
    offer.sellOffer?.rateTQT,
    `on-chain sell rate does not match ${SELL_ONLY_RATE_XIN} XIN/unit — check the ` +
    'amountToQuant / 10^decimals conversion in publishExchangeOffer()',
  ).toBe(String(SELL_ONLY_RATE_XIN * TQT_PER_XIN));
  expect(offer.sellOffer?.supply, 'on-chain sell supply does not match the entered units').toBe(String(SELL_ONLY_UNITS));
  expect(
    offer.sellOffer?.limit,
    'the sell-only form sets the total sell limit from the entered units, so limit must equal supply',
  ).toBe(String(SELL_ONLY_UNITS));
  expect(
    offer.sellOffer?.expirationHeight,
    'the offer expires at a different height than the wallet signed for',
  ).toBe(expirationHeight);

  expect(
    offer.buyOffer?.supply,
    'a sell-only offer left a non-zero buy supply on chain — the buy and sell sides were swapped',
  ).toBe('0');
  expect(offer.buyOffer?.limit, 'a sell-only offer left a non-zero buy limit on chain').toBe('0');

  expect(
    await offerIdsOnBook(request, apiOrigin, 'getSellOffers', currency.currencyId),
    `${currency.code}'s sell book must hold exactly the offer ${txId} just published`,
  ).toEqual([txId]);
  expect(
    await offerIdsOnBook(request, apiOrigin, 'getBuyOffers', currency.currencyId),
    `${currency.code}'s buy book is not empty after a sell-only offer — the zero-supply buy ` +
    'record is being offered for trade',
  ).toEqual([]);

  const holding = await accountHolding(request, apiOrigin, currency.currencyId);
  expect(
    holding.units,
    'publishing an offer must not move confirmed units — nothing has been exchanged yet',
  ).toBe(String(CURRENCY_SUPPLY));
  expect(
    holding.unconfirmedUnits,
    `the offer must reserve its ${SELL_ONLY_UNITS} sell units against the account, otherwise the ` +
    'same units could be spent twice while the offer sits on the book',
  ).toBe(String(CURRENCY_SUPPLY - SELL_ONLY_UNITS));
});

test('publish-exchange-offer: two-sided offer records both books with the entered rates and limits', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const currency: ExchangeableCurrency = await issueExchangeableCurrency(
    request,
    apiOrigin,
    TEST_ACCOUNT_1_PASSPHRASE,
    { supply: CURRENCY_SUPPLY },
  );

  const desk = new TradeDeskPage(page);
  await desk.goto(currency.currencyId);

  const heightBefore = await chainHeight(request, apiOrigin);
  await desk.openPublishExchangeOffer();

  const wizard = new PublishExchangeOfferPage(page);
  await wizard.expectDetailsStep(currency.currencyId, currency.code);
  const lifetimeBlocks = await wizard.expectPrefilledLifetimeBlocks();
  await wizard.expectLifetimeLabels(lifetimeBlocks);

  // Six inputs, all distinct values: swapping any pair changes the chain state
  // in a way the assertions below pick up.
  await wizard.input('buyRate').fill(String(TWO_SIDED_BUY_RATE_XIN));
  await wizard.input('sellRate').fill(String(TWO_SIDED_SELL_RATE_XIN));
  await wizard.input('buyLimit').fill(String(TWO_SIDED_BUY_LIMIT));
  await wizard.input('sellLimit').fill(String(TWO_SIDED_SELL_LIMIT));
  await wizard.input('initialBuySupply').fill(String(TWO_SIDED_BUY_SUPPLY));
  await wizard.input('initialSellSupply').fill(String(TWO_SIDED_SELL_SUPPLY));
  await wizard.input('initialSellSupply').blur();

  const signParams = await wizard.submitDetailsStep();
  expectExpirationHeight(signParams, lifetimeBlocks, heightBefore, await chainHeight(request, apiOrigin));

  const expirationHeight = await resignAfterStepBack(wizard, request, apiOrigin, lifetimeBlocks, heightBefore);

  await wizard.expectConfirmValues({
    'Name': currency.name,
    'Ticker': currency.code,
    'Currency Id': currency.currencyId,
    'Buy Rate': TWO_SIDED_BUY_RATE_XIN,
    'Buy Limit': TWO_SIDED_BUY_LIMIT,
    'Inital Buy Supply': TWO_SIDED_BUY_SUPPLY,
    'Sell Rate': TWO_SIDED_SELL_RATE_XIN,
    'Sell Limit': TWO_SIDED_SELL_LIMIT,
    'Inital Sell Supply': TWO_SIDED_SELL_SUPPLY,
    'Expiration Height': expirationHeight,
  });
  await wizard.expectSignedBytes();

  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, wizard.finishButton);

  const offer = await getOffer(request, apiOrigin, txId);

  expect(
    offer.buyOffer?.rateTQT,
    `on-chain buy rate does not match the entered ${TWO_SIDED_BUY_RATE_XIN} XIN/unit`,
  ).toBe(String(TWO_SIDED_BUY_RATE_XIN * TQT_PER_XIN));
  expect(offer.buyOffer?.supply, 'on-chain initial buy supply does not match').toBe(String(TWO_SIDED_BUY_SUPPLY));
  expect(offer.buyOffer?.limit, 'on-chain total buy limit does not match').toBe(String(TWO_SIDED_BUY_LIMIT));

  expect(
    offer.sellOffer?.rateTQT,
    `on-chain sell rate does not match the entered ${TWO_SIDED_SELL_RATE_XIN} XIN/unit`,
  ).toBe(String(TWO_SIDED_SELL_RATE_XIN * TQT_PER_XIN));
  expect(offer.sellOffer?.supply, 'on-chain initial sell supply does not match').toBe(String(TWO_SIDED_SELL_SUPPLY));
  expect(offer.sellOffer?.limit, 'on-chain total sell limit does not match').toBe(String(TWO_SIDED_SELL_LIMIT));

  expect(
    offer.buyOffer?.expirationHeight,
    'the offer expires at a different height than the wallet signed for',
  ).toBe(expirationHeight);

  expect(
    await offerIdsOnBook(request, apiOrigin, 'getBuyOffers', currency.currencyId),
    `${currency.code}'s buy book must hold exactly the two-sided offer ${txId}`,
  ).toEqual([txId]);
  expect(
    await offerIdsOnBook(request, apiOrigin, 'getSellOffers', currency.currencyId),
    `${currency.code}'s sell book must hold exactly the two-sided offer ${txId}`,
  ).toEqual([txId]);

  const holding = await accountHolding(request, apiOrigin, currency.currencyId);
  expect(
    holding.units,
    'publishing an offer must not move confirmed units — nothing has been exchanged yet',
  ).toBe(String(CURRENCY_SUPPLY));
  expect(
    holding.unconfirmedUnits,
    `the offer must reserve exactly its ${TWO_SIDED_SELL_SUPPLY} sell units (the buy side is ` +
    'reserved in XIN, not in units)',
  ).toBe(String(CURRENCY_SUPPLY - TWO_SIDED_SELL_SUPPLY));
});

test('trade desk ask order: currencySell registers an exchange request for the account', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const currency: ExchangeableCurrency = await issueExchangeableCurrency(
    request,
    apiOrigin,
    TEST_ACCOUNT_1_PASSPHRASE,
    { supply: CURRENCY_SUPPLY },
  );

  const desk = new TradeDeskPage(page);
  await desk.goto(currency.currencyId);
  await desk.placeSellOrder(ASK_ORDER_PRICE_XIN, ASK_ORDER_UNITS);

  const confirm = new TradeDeskOrderConfirmPage(page);
  await confirm.expectOrder(currency.currencyId, currency.name, ASK_ORDER_PRICE_XIN, ASK_ORDER_UNITS);
  await confirm.expectSignedBytes();

  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, confirm.finishButton);

  const requests = await apiGet(request, apiOrigin, {
    requestType: 'getAccountExchangeRequests',
    account: TEST_ACCOUNT_1_RS,
    currency: currency.currencyId,
  });
  const recorded = ((requests.exchangeRequests ?? []) as any[]);
  expect(
    recorded.map((entry) => entry.transaction),
    `${currency.code} must carry exactly the one exchange request ${txId} the desk just sent — ` +
    `got ${JSON.stringify(recorded)}`,
  ).toEqual([txId]);
  expect(
    recorded[0].subtype,
    `the desk's Sell button registered subtype ${recorded[0].subtype}; ${SUBTYPE_EXCHANGE_SELL} ` +
    'is EXCHANGE_SELL and 5 is EXCHANGE_BUY, so the ask form built the wrong request type',
  ).toBe(SUBTYPE_EXCHANGE_SELL);
  expect(
    recorded[0].units,
    'the recorded exchange request is for a different number of units than the desk order',
  ).toBe(String(ASK_ORDER_UNITS));
  expect(
    recorded[0].rateTQT,
    `the recorded exchange request rate does not match the entered ${ASK_ORDER_PRICE_XIN} XIN — ` +
    'check the amountToQuant / 10^decimals conversion in trade-desk-sell.component.ts',
  ).toBe(String(ASK_ORDER_PRICE_XIN * TQT_PER_XIN));

  // Nothing on this fresh currency's buy book can match the request, so
  // exchangeCurrencyForXIN() must hand every unit back — confirmed *and*
  // unconfirmed have to be whole again.
  const holding = await accountHolding(request, apiOrigin, currency.currencyId);
  expect(
    holding.units,
    'units left the account although no buy offer existed to match the sell request against',
  ).toBe(String(CURRENCY_SUPPLY));
  expect(
    holding.unconfirmedUnits,
    'the units the unmatched sell request reserved were never released — they stay locked out ' +
    'of the account for good',
  ).toBe(String(CURRENCY_SUPPLY));
});
