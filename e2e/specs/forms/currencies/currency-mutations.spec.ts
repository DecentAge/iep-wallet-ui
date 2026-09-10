import { test, expect, AlertLog } from '../../../fixtures/test';
import { request as pwRequest, APIRequestContext, Locator, Page } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
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
 * Currency mutations — the three Monetary System forms a row action opens:
 * transfer-currency, delete-currency/:id and my-open-offers/cancel-offer.
 *
 * Risk: transfer-currency signs `units × 10^decimals` (a lost decimals lookup
 * ships a hundredth of the intended amount and still reports success), while
 * delete-currency and cancel-offer take their subject from the route the row
 * action filled (a lost hand-off destroys or cancels something else). So each
 * test is entered by clicking the row and pins the number or the id on chain.
 *
 * Three currencies, not one: `Currency.canBeDeletedBy` only lets the issuer
 * delete a currency it is the sole holder of, so the one handed to
 * TEST_ACCOUNT_2 can never be the one the delete test removes; the offer test
 * needs a third because the chain keeps one offer per account per currency.
 */

const API_ORIGIN = apiOriginFromBaseURL(process.env.BASE_URL || undefined);

const TYPE_MONETARY_SYSTEM = 5;
const SUBTYPE_CURRENCY_TRANSFER = 3;
const SUBTYPE_PUBLISH_EXCHANGE_OFFER = 4;
const SUBTYPE_CURRENCY_DELETION = 8;

/** decimals > 0 is what makes the 10^decimals scaling observable. */
const TRANSFER_DECIMALS = 2;
const TRANSFER_SUPPLY_QNT = 100_000;
const TRANSFER_UNITS_TYPED = 1.25;
const TRANSFER_UNITS_QNT = TRANSFER_UNITS_TYPED * 10 ** TRANSFER_DECIMALS;

const PLAIN_SUPPLY_QNT = 1000;

/** Setup offer: buy side only, so it lands on the "buy" tab of my-open-offers. */
const OFFER_RATE_TQT = 2 * TQT_PER_XIN;
const OFFER_UNITS = 10;
const OFFER_LIFETIME_BLOCKS = 1000;

const MAX_CANCEL_LIFETIME_BLOCKS = 5;

const CONFIRM_TIMEOUT_MS = 60_000;

let apiCtx: APIRequestContext;
let transferable: ExchangeableCurrency;
let deletable: ExchangeableCurrency;
let offered: ExchangeableCurrency;
let openOfferId: string;

async function apiGet(ctx: APIRequestContext, params: Record<string, string>): Promise<any> {
  const response = await ctx.get(`${API_ORIGIN}/api`, { params, timeout: DEFAULT_TIMEOUT_MS });
  expect(
    response.ok(),
    `${params.requestType} returned HTTP ${response.status()} — is the node API reachable at ${API_ORIGIN}/api?`,
  ).toBe(true);
  return response.json();
}

/** Held units in QNT; a holding the chain never created answers `{}`. */
async function heldUnits(
  ctx: APIRequestContext,
  account: string,
  currencyId: string,
): Promise<number> {
  const holding = await apiGet(ctx, {
    requestType: 'getAccountCurrencies',
    account,
    currency: currencyId,
  });
  return Number(holding.units ?? 0);
}

/** Offer ids are the id of the publishExchangeOffer tx that created them. */
async function offerIdsOnBuyBook(ctx: APIRequestContext, currencyId: string): Promise<string[]> {
  const book = await apiGet(ctx, {
    requestType: 'getBuyOffers',
    currency: currencyId,
    availableOnly: 'true',
  });
  return ((book.offers ?? []) as any[]).map((entry) => String(entry.offer));
}

/** Setup only — the flow under test is the cancel, not the publish. */
async function publishBuyOffer(ctx: APIRequestContext, currencyId: string): Promise<string> {
  const status = await apiGet(ctx, { requestType: 'getBlockchainStatus' });
  const expirationHeight = Number(status.numberOfBlocks) + OFFER_LIFETIME_BLOCKS;

  const response = await ctx.post(`${API_ORIGIN}/api`, {
    form: {
      requestType: 'publishExchangeOffer',
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      currency: currencyId,
      buyRateTQT: String(OFFER_RATE_TQT),
      // The chain rejects buyRate > sellRate, hence the mirrored rate.
      sellRateTQT: String(OFFER_RATE_TQT),
      totalBuyLimit: String(OFFER_UNITS),
      totalSellLimit: '0',
      initialBuySupply: String(OFFER_UNITS),
      initialSellSupply: '0',
      expirationHeight: String(expirationHeight),
      feeTQT: String(TQT_PER_XIN),
      deadline: '1440',
      broadcast: 'true',
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const published = await response.json();
  if (!published.transaction || published.broadcasted !== true) {
    throw new Error(
      `publishExchangeOffer fixture for currency ${currencyId} was refused by the node: ${JSON.stringify(published)}`,
    );
  }

  const offerId = String(published.transaction);
  await expect
    .poll(async () => offerIdsOnBuyBook(ctx, currencyId), {
      message: `the setup offer ${offerId} never reached ${currencyId}'s buy book — devnet forging stalled?`,
      timeout: CONFIRM_TIMEOUT_MS,
    })
    .toEqual([offerId]);
  return offerId;
}

/**
 * The row whose ticker cell holds `code`, or null when no page has it. These
 * lists are account-scoped and grow with every run on this shared chain, so the
 * pager has to be walked in both directions: to find the row, and to prove it
 * is gone afterwards.
 */
async function findRowByTicker(
  page: Page,
  host: string,
  code: string,
  maxPages = 25,
): Promise<Locator | null> {
  for (let visited = 0; visited < maxPages; visited++) {
    const rows = page.locator(`${host} datatable-body-row`);
    // An unpainted table would look empty and skip the page the ticker is on.
    await rows.first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS }).catch(() => undefined);

    const match = rows.filter({ hasText: code });
    if ((await match.count()) > 0) return match.first();

    const nextPage = page.locator(`${host} li:has(a[aria-label="go to next page"])`).first();
    if (!(await nextPage.isVisible({ timeout: 2_000 }).catch(() => false))) return null;
    // An enabled next-button carries an empty class attribute, not a missing one.
    const classes = (await nextPage.getAttribute('class', { timeout: 2_000 }).catch(() => null)) ?? '';
    if (classes.includes('disabled')) return null;

    await nextPage.locator('a').first().click();
    // Off-page wait: the open-offers pager refetches.
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

async function requireRowByTicker(page: Page, host: string, code: string): Promise<Locator> {
  const row = await findRowByTicker(page, host, code);
  expect(
    row,
    `no row for ticker ${code} on any page of ${host} — the list request behind it returned ` +
    'nothing for this account, or the ticker column stopped rendering the code',
  ).not.toBeNull();
  return row!;
}

/** Re-fetches a list through its own reload button. */
async function reloadList(page: Page, host: string, requestType: string): Promise<void> {
  const listed = page.waitForResponse((r) => r.url().includes(`requestType=${requestType}`), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await page.locator(`${host} a.btn:has(i.fa-refresh)`).first().click();
  await listed;
}

/** Confirm-step values sit in the `<h4>` right after their `div.ucsb` label. */
function confirmValue(page: Page, host: string, label: string): Locator {
  return page.locator(
    `xpath=//${host}//div[contains(@class,"ucsb")][normalize-space(.)="${label}"]/following-sibling::h4[1]`,
  );
}

async function expectSuccessAlert(alerts: AlertLog, what: string): Promise<void> {
  await expect
    .poll(() => alerts.last()?.kind, {
      message: `the wallet raised no success dialog after ${what}`,
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe('success');
}

test.beforeAll(async () => {
  // Four confirmations in sequence — more than the per-test budget.
  test.setTimeout(150_000);
  apiCtx = await pwRequest.newContext();

  transferable = await issueExchangeableCurrency(apiCtx, API_ORIGIN, TEST_ACCOUNT_1_PASSPHRASE, {
    supply: TRANSFER_SUPPLY_QNT,
    decimals: TRANSFER_DECIMALS,
  });
  deletable = await issueExchangeableCurrency(apiCtx, API_ORIGIN, TEST_ACCOUNT_1_PASSPHRASE, {
    supply: PLAIN_SUPPLY_QNT,
  });
  offered = await issueExchangeableCurrency(apiCtx, API_ORIGIN, TEST_ACCOUNT_1_PASSPHRASE, {
    supply: PLAIN_SUPPLY_QNT,
  });
  openOfferId = await publishBuyOffer(apiCtx, offered.currencyId);
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('transfer-currency: the row action hands over the currency and the units reach the chain scaled by 10^decimals', async ({ page, request, infoAlerts }) => {
  await page.goto('#/wallet/currencies/show-currencies/my');
  const row = await requireRowByTicker(page, 'app-currencies', transferable.code);

  await row.locator('a.btn:has(i.fa-user)').click();
  await expect(
    page,
    'the transfer action on the My-currencies row did not open show-currencies/transfer-currency ' +
    `with id=${transferable.currencyId} — openTransferCurrency() lost the currency id`,
  ).toHaveURL(
    new RegExp(`#/(wallet/)?currencies/show-currencies/transfer-currency\\?id=${transferable.currencyId}$`),
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  // Gate: clicking Next before `decimals` arrives signs NaN units.
  const details = page.locator('app-transfer-currency h6');
  await expect(
    details.first(),
    'the transfer form shows no ticker — the id query param never reached getCurrencyById',
  ).toHaveText(transferable.code, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    details.nth(1),
    'the transfer form shows a different currency id than the row it was opened from',
  ).toHaveText(transferable.currencyId);

  const next = page.locator('app-transfer-currency button.btn-primary:has(i.fa-chevron-right)');
  await expect(
    next,
    'Next is enabled on an empty transfer form — recipient and units lost their `required` validators',
  ).toBeDisabled();

  await page.locator('app-transfer-currency input[name="recipient"]').fill(TEST_ACCOUNT_2_RS);
  const units = page.locator('app-transfer-currency input[name="units"]');
  await units.fill(String(TRANSFER_UNITS_TYPED));
  await units.blur();
  await expect(
    next,
    'Next stayed disabled although recipient and units are filled in',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const senderBefore = await heldUnits(apiCtx, TEST_ACCOUNT_1_RS, transferable.currencyId);
  const recipientBefore = await heldUnits(apiCtx, TEST_ACCOUNT_2_RS, transferable.currencyId);
  expect(
    senderBefore,
    `the issuer must still hold the full ${TRANSFER_SUPPLY_QNT} QNT of ${transferable.code} before the transfer`,
  ).toBe(TRANSFER_SUPPLY_QNT);
  expect(
    recipientBefore,
    `TEST_ACCOUNT_2 already holds units of the freshly issued ${transferable.code} — the setup ` +
    'currency is not exclusive to this run',
  ).toBe(0);

  await next.click();

  const finish = page.locator('app-transfer-currency button.btn-primary:has(i.fa-check)');
  await expect(
    finish,
    'Finish never enabled — the node rejected the CURRENCY_TRANSFER or client-side signing failed. ' +
    'A NaN units value (decimals not loaded when Next was clicked) shows up exactly like this.',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    confirmValue(page, 'app-transfer-currency', 'Recipient'),
    'the confirm step names a different recipient than the one entered',
  ).toHaveText(TEST_ACCOUNT_2_RS);
  await expect(
    confirmValue(page, 'app-transfer-currency', 'Units'),
    'the confirm step shows different units than the ones entered',
  ).toHaveText(String(TRANSFER_UNITS_TYPED));

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, API_ORIGIN, finish);

  expect(tx.type, `tx ${txId} is not a Monetary System transaction`).toBe(TYPE_MONETARY_SYSTEM);
  expect(tx.subtype, `tx ${txId} is not a CURRENCY_TRANSFER`).toBe(SUBTYPE_CURRENCY_TRANSFER);
  expect(tx.recipientRS, 'the transfer went to a different account than the form named').toBe(TEST_ACCOUNT_2_RS);
  expect(
    String(tx.attachment?.currency),
    'the transfer moved a different currency than the row it was started from',
  ).toBe(transferable.currencyId);
  expect(
    Number(tx.attachment?.units),
    `the chain recorded ${tx.attachment?.units} QNT for the ${TRANSFER_UNITS_TYPED} units typed into a ` +
    `${TRANSFER_DECIMALS}-decimals currency; it must be ${TRANSFER_UNITS_QNT}. A value of ` +
    `${TRANSFER_UNITS_TYPED} means transferCurrency() stopped multiplying by 10^decimals and ships a ` +
    `hundredth of the intended amount; ${TRANSFER_UNITS_QNT * 100} means it scaled twice.`,
  ).toBe(TRANSFER_UNITS_QNT);

  await expectSuccessAlert(infoAlerts, 'broadcasting the currency transfer');

  await expect
    .poll(() => heldUnits(apiCtx, TEST_ACCOUNT_2_RS, transferable.currencyId), {
      message:
        `TEST_ACCOUNT_2 never received the ${TRANSFER_UNITS_QNT} QNT of ${transferable.code} that tx ${txId} carries`,
      timeout: CONFIRM_TIMEOUT_MS,
    })
    .toBe(recipientBefore + TRANSFER_UNITS_QNT);
  expect(
    await heldUnits(apiCtx, TEST_ACCOUNT_1_RS, transferable.currencyId),
    'the sender was debited a different number of units than the recipient was credited',
  ).toBe(senderBefore - TRANSFER_UNITS_QNT);

  await expect(
    page,
    'the wallet did not return to the My-currencies list after the transfer was broadcast',
  ).toHaveURL(/#\/(wallet\/)?currencies\/show-currencies\/my$/, { timeout: DEFAULT_TIMEOUT_MS });
});

test('delete-currency: the row action fills the :id route and the currency is gone from the chain', async ({ page, request, infoAlerts }) => {
  await page.goto('#/wallet/currencies/show-currencies/my');
  const row = await requireRowByTicker(page, 'app-currencies', deletable.code);

  await row.locator('a.btn:has(i.fa-times)').click();
  await expect(
    page,
    'the delete action on the My-currencies row did not open delete-currency with the currency in ' +
    `the path — expected .../delete-currency/${deletable.currencyId}. A missing :id segment means ` +
    'openDeleteCurrency() navigated without its parameter and the form would delete nothing at all.',
  ).toHaveURL(
    new RegExp(`#/(wallet/)?currencies/show-currencies/delete-currency/${deletable.currencyId}$`),
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  const details = page.locator('app-delete-currency h6');
  await expect(
    details.first(),
    'the delete form shows no ticker — the :id route param never reached getCurrencyById',
  ).toHaveText(deletable.code, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    details.nth(1),
    'the delete form is about a different currency than the row it was opened from',
  ).toHaveText(deletable.currencyId);

  await page.locator('app-delete-currency button.btn-primary:has(i.fa-chevron-right)').click();

  const finish = page.locator('app-delete-currency button.btn-primary:has(i.fa-check)');
  await expect(
    finish,
    'Finish never enabled — canDeleteCurrency said no (the issuer must be the sole holder, so a ' +
    'currency whose units were transferred away can never be deleted) or signing the ' +
    'CURRENCY_DELETION failed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    confirmValue(page, 'app-delete-currency', 'Ticker'),
    'the confirm step names a different ticker than the row the delete was started from',
  ).toHaveText(deletable.code);

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, API_ORIGIN, finish);

  expect(tx.type, `tx ${txId} is not a Monetary System transaction`).toBe(TYPE_MONETARY_SYSTEM);
  expect(tx.subtype, `tx ${txId} is not a CURRENCY_DELETION`).toBe(SUBTYPE_CURRENCY_DELETION);
  expect(
    String(tx.attachment?.currency),
    `the deletion targets ${tx.attachment?.currency} instead of ${deletable.currencyId} — the wallet ` +
    'signed away a currency other than the one whose row was clicked',
  ).toBe(deletable.currencyId);

  await expectSuccessAlert(infoAlerts, 'broadcasting the currency deletion');

  await expect
    .poll(
      async () =>
        (await apiGet(apiCtx, { requestType: 'getCurrency', currency: deletable.currencyId })).errorCode,
      {
        message:
          `getCurrency still resolves ${deletable.code} (${deletable.currencyId}) after tx ${txId} ` +
          'confirmed — the CURRENCY_DELETION was accepted but the currency was not removed',
        timeout: CONFIRM_TIMEOUT_MS,
      },
    )
    .toBeDefined();
  expect(
    await heldUnits(apiCtx, TEST_ACCOUNT_1_RS, deletable.currencyId),
    'the issuer still holds units of the deleted currency',
  ).toBe(0);

  await expect(
    page,
    'the wallet did not return to the My-currencies list after the deletion was broadcast',
  ).toHaveURL(/#\/(wallet\/)?currencies\/show-currencies\/my$/, { timeout: DEFAULT_TIMEOUT_MS });

  await reloadList(page, 'app-currencies', 'getAccountCurrencies');
  expect(
    await findRowByTicker(page, 'app-currencies', deletable.code),
    `${deletable.code} is still listed under My currencies although the chain no longer knows it`,
  ).toBeNull();
});

test('cancel-offer: the row action takes back the published buy offer and the book empties', async ({ page, request, infoAlerts }) => {
  await page.goto('#/wallet/currencies/my-open-offers/buy');
  const row = await requireRowByTicker(page, 'app-open-offers', offered.code);

  await row.locator('a.btn:has(i.fa-times)').click();
  await expect(
    page,
    'the cancel action on the open-offer row did not open my-open-offers/cancel-offer with the ' +
    `currency and the offer type — expected currency=${offered.currencyId}&offerType=BUY`,
  ).toHaveURL(
    new RegExp(`#/(wallet/)?currencies/my-open-offers/cancel-offer\\?currency=${offered.currencyId}&offerType=BUY$`),
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  await expect(
    confirmValue(page, 'app-cancel-offer', 'Ticker'),
    'the cancel screen names a different ticker than the offer row it was opened from',
  ).toHaveText(offered.code, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    confirmValue(page, 'app-cancel-offer', 'Currency Id'),
    'the cancel screen is about a different currency than the offer row it was opened from',
  ).toHaveText(offered.currencyId);

  // The signed replacement lives ~2 blocks: nothing slow before the click.
  const finish = page.locator('app-cancel-offer button.btn-primary:has(i.fa-check)');
  await expect(
    finish,
    'Finish never enabled — cancelExchangeOffer() got no signable bytes back. Without it the user ' +
    'has no way to take an offer off the book at all.',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, API_ORIGIN, finish);

  expect(tx.type, `tx ${txId} is not a Monetary System transaction`).toBe(TYPE_MONETARY_SYSTEM);
  expect(
    tx.subtype,
    `tx ${txId} is not a PUBLISH_EXCHANGE_OFFER — the wallet cancels by republishing the offer with ` +
    'a two-block lifetime, which is what replaces the standing one',
  ).toBe(SUBTYPE_PUBLISH_EXCHANGE_OFFER);
  expect(
    String(tx.attachment?.currency),
    'the cancel was signed against a different currency than the offer row it was started from',
  ).toBe(offered.currencyId);
  expect(
    Number(tx.attachment?.expirationHeight) - Number(tx.height),
    `the replacement offer runs for ${Number(tx.attachment?.expirationHeight) - Number(tx.height)} blocks ` +
    `past height ${tx.height}. A cancel must expire within ${MAX_CANCEL_LIFETIME_BLOCKS} blocks — anything ` +
    'longer leaves a live offer on the book that the user believes they cancelled.',
  ).toBeLessThanOrEqual(MAX_CANCEL_LIFETIME_BLOCKS);

  await expectSuccessAlert(infoAlerts, 'broadcasting the offer cancellation');

  const cancelled = await apiGet(apiCtx, { requestType: 'getOffer', offer: openOfferId });
  expect(
    cancelled.errorCode,
    `getOffer still resolves the original offer ${openOfferId} after the cancel confirmed — the ` +
    'republished offer did not replace it, so the old rate is still tradable',
  ).toBeDefined();

  await expect
    .poll(() => offerIdsOnBuyBook(apiCtx, offered.currencyId), {
      message:
        `${offered.code}'s buy book never emptied after the cancel. The original offer ${openOfferId} ` +
        `was replaced by ${txId}, and that replacement has to expire on its own within a few blocks.`,
      timeout: CONFIRM_TIMEOUT_MS,
    })
    .toEqual([]);

  await expect(
    page,
    'the wallet did not return to the open-offers list after the cancel was broadcast',
  ).toHaveURL(/#\/(wallet\/)?currencies\/my-open-offers(\/buy)?$/, { timeout: DEFAULT_TIMEOUT_MS });

  await reloadList(page, 'app-open-offers', 'getBuyOffers');
  expect(
    await findRowByTicker(page, 'app-open-offers', offered.code),
    `${offered.code} still has an open buy offer in the wallet although the chain's book is empty`,
  ).toBeNull();
});

test('transfer-currency: a transfer of 0 units must not be signable', async ({ page }) => {
  // transfer-currency.component.html:90 binds `minValue="0"`; the chain rejects
  // units <= 0, so the user gets a raw error dialog instead of a refusal.
  await page.goto(`#/wallet/currencies/show-currencies/transfer-currency?id=${transferable.currencyId}`);
  await expect(
    page.locator('app-transfer-currency h6').first(),
    'the transfer form did not render',
  ).toHaveText(transferable.code, { timeout: DEFAULT_TIMEOUT_MS });

  await page.locator('app-transfer-currency input[name="recipient"]').fill(TEST_ACCOUNT_2_RS);
  const units = page.locator('app-transfer-currency input[name="units"]');
  await units.fill('0');
  await units.blur();

  await expect(
    page.locator('app-transfer-currency button.btn-primary:has(i.fa-chevron-right)'),
    'Next is enabled for a 0-unit transfer, which the chain always rejects',
  ).toBeDisabled();
});

test('delete-currency: the confirm step labels the currency id with a raw i18n key', async ({ page }) => {
  // delete-currency.component.html:71 asks for a key no locale file defines, so
  // ngx-translate echoes it back. Uses the transfer currency — the delete
  // test's own is off the chain by now.
  await page.goto(`#/wallet/currencies/show-currencies/delete-currency/${transferable.currencyId}`);
  await expect(
    page.locator('app-delete-currency h6').first(),
    'the delete screen did not render',
  ).toHaveText(transferable.code, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('app-delete-currency div.ucsb', { hasText: /currency-id-label/ }),
    'the delete confirm step renders the untranslated i18n key ' +
    '"currencies.transfer-currency.currency-id-label" instead of "Currency Id"',
  ).toHaveCount(0);
});
