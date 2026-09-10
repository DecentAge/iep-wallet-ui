import { test, expect, AlertLog } from '../../../fixtures/test';
import { Page, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Alias trading — the sell / buy / cancel forms under `#/wallet/aliases/…`.
 *
 * create-alias.spec.ts stops at ALIAS_ASSIGNMENT. Everything that makes an
 * alias tradable is a different subtype behind a different form:
 *   ALIAS_SELL, priceTQT > 0, with recipient → private offer
 *   ALIAS_SELL, priceTQT > 0, no recipient   → public offer
 *   ALIAS_BUY                                → ownership moves to the buyer
 *   ALIAS_SELL, priceTQT = 0                 → the wallet's "cancel"
 *
 * The node stores a private offer with `buyer_id = <account>` and a public one
 * with `buyer_id IS NULL` (Alias.Offer.save → setLongZeroToNull), and both
 * buy-offer tabs are the *same* OffersComponent parameterised by the route's
 * `data.offerType`. One wrong constant there shows every seller's public offers
 * on the private tab, so each test also pins that the offer is absent from the
 * other tab.
 *
 * Registering the alias is API setup; every sell, buy and cancel goes through
 * the UI. Alias names and prices are unique per run, so the spec can be
 * replayed against the same chain.
 */

const ALIAS_URI = `acct:${TEST_ACCOUNT_1_RS}@xin`;
const SETUP_FEE_TQT = '100000000';
const TQT_PER_XIN = 100_000_000;
const CONFIRM_TIMEOUT_MS = 60_000;

/** Chain rule (errorCode 4): alias names carry only digits and Latin letters. */
const uniqueAliasName = (tag: string) =>
  `${tag}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 100–899 XIN — distinctive per run, and never wide enough for `toLocaleString` to insert a separator. */
const uniquePriceXin = () => 100 + (Date.now() % 800);

const OFFER_REQUEST = {
  Private: 'getAliasesPrivateOffers',
  Public: 'getAliasesPublicOffers',
} as const;

type OfferTab = keyof typeof OFFER_REQUEST;

const offerRow = (page: Page, aliasName: string) =>
  page.locator('datatable-body-row').filter({ hasText: aliasName });

async function aliasOwner(
  request: APIRequestContext,
  apiOrigin: string,
  aliasName: string,
): Promise<string> {
  const resp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAlias', aliasName },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const body = await resp.json();
  return body.accountRS ?? `getAlias errorCode ${body.errorCode}: ${body.errorDescription}`;
}

/** Setup only — registers the alias server-side so the UI tests start from an owned alias. */
async function registerAlias(
  request: APIRequestContext,
  apiOrigin: string,
  aliasName: string,
): Promise<void> {
  const resp = await request.post(`${apiOrigin}/api`, {
    form: {
      requestType: 'setAlias',
      aliasName,
      aliasURI: ALIAS_URI,
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      feeTQT: SETUP_FEE_TQT,
      deadline: '1440',
      broadcast: 'true',
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const created = await resp.json();
  expect(
    created.transaction,
    `setAlias setup for ${aliasName} was refused: ${JSON.stringify(created)}`,
  ).toBeTruthy();

  await expect
    .poll(() => aliasOwner(request, apiOrigin, aliasName), {
      message: `setAlias tx ${created.transaction} never confirmed — devnet forging stalled`,
      timeout: CONFIRM_TIMEOUT_MS,
    })
    .toBe(TEST_ACCOUNT_1_RS);
}

/** show-alias → search for the alias → sell action on its row. */
async function openSellForm(page: Page, aliasName: string): Promise<void> {
  await page.goto('#/wallet/aliases/show-alias');

  const search = page.locator('app-show-alias input.input-search');
  await expect(search, 'show-alias did not mount its alias search field').toBeVisible({
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await search.fill(aliasName);

  const row = offerRow(page, aliasName);
  await expect(
    row,
    `searching show-alias for ${aliasName} produced no row — the (input) handler or the ` +
      'getAliasesLike wiring behind it is broken',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

  await row.locator('a.btn:has(i.fa-dollar)').click();
  await expect(
    page,
    'the sell action on the alias row did not open show-alias/sell-alias',
  ).toHaveURL(/#\/(wallet\/)?aliases\/show-alias\/sell-alias\?/, { timeout: DEFAULT_TIMEOUT_MS });
}

/** Drives show-alias/sell-alias. `recipientRS` empty ⇒ public offer. */
async function sellAliasThroughForm(
  page: Page,
  request: APIRequestContext,
  apiOrigin: string,
  alerts: AlertLog,
  aliasName: string,
  priceXin: number,
  recipientRS: string,
): Promise<void> {
  const details = page.locator('app-sell-alias h6');
  await expect(
    details.first(),
    'sell-alias shows the wrong alias — the alias never reached it through the row click queryParams',
  ).toHaveText(aliasName);
  await expect(details.nth(1), 'sell-alias shows the wrong URI for the alias').toHaveText(ALIAS_URI);

  const next = page.locator('app-sell-alias button.btn-primary:has(i.fa-chevron-right)');
  await expect(
    next,
    'Next is enabled on an empty sell form — the price field lost its `required` validator',
  ).toBeDisabled();

  if (recipientRS) {
    await page.locator('app-sell-alias input[name="recipient"]').fill(recipientRS);
  }
  const price = page.locator('app-sell-alias input[name="price"]');
  await price.fill(String(priceXin));
  await price.blur();
  await expect(next, 'Next did not enable after a valid sale price was entered').toBeEnabled({
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await next.click();

  const finish = page.locator('app-sell-alias button.btn-primary:has(i.fa-check)');
  await expect(
    finish,
    'Finish stayed disabled — sellAlias() got no signable unsigned bytes back, so the chain ' +
      'rejected the ALIAS_SELL or the local signing step failed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finish);
  expect(tx.subtype, 'the broadcast transaction is not an ALIAS_SELL (subtype 6)').toBe(6);
  expect(
    Number(tx.attachment?.priceTQT),
    `ALIAS_SELL carries the wrong price — ${priceXin} XIN did not survive amountToQuant: ` +
      `${JSON.stringify(tx.attachment)}`,
  ).toBe(priceXin * TQT_PER_XIN);
  if (recipientRS) {
    expect(
      tx.recipientRS,
      'the private sell offer does not name the intended buyer as recipient — anyone could buy it',
    ).toBe(recipientRS);
  } else {
    expect(
      tx.recipientRS,
      'a public sell offer must carry no recipient, otherwise only that one account can buy',
    ).toBeUndefined();
  }

  await expect
    .poll(() => alerts.last()?.kind, {
      message: 'the wallet raised no success dialog after broadcasting the sell offer',
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe('success');

  await expect(
    page,
    'the wallet did not return to the alias list after the sell offer was broadcast',
  ).toHaveURL(/#\/(wallet\/)?aliases\/show-alias(?!\/)/, { timeout: DEFAULT_TIMEOUT_MS });
}

/**
 * Runs `trigger`, waits for the list request it fires, then blocks until the
 * datatable has painted exactly the rows that request answered with. Without
 * that second step every "the offer is gone" assertion would be evaluated
 * against a table that has not rendered yet, and could never fail.
 */
async function awaitListedRows(
  page: Page,
  host: string,
  requestType: string,
  trigger: () => Promise<void>,
): Promise<void> {
  const listed = page.waitForResponse((r) => r.url().includes(`requestType=${requestType}`), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await trigger();
  const answered = ((await (await listed).json()).aliases ?? []) as unknown[];
  await expect(
    page.locator(`${host} datatable-body-row`),
    `${host} rendered a different number of rows than ${requestType} answered with ` +
      `(${answered.length})`,
  ).toHaveCount(answered.length, { timeout: DEFAULT_TIMEOUT_MS });
}

async function gotoMySellOffers(page: Page): Promise<void> {
  // Route away first: a goto to the hash we are already on would not re-run ngOnInit.
  await page.goto('#/wallet/aliases/show-alias');
  await awaitListedRows(page, 'app-my-sell-offers', 'getAliasesOpenOffers', async () => {
    await page.goto('#/wallet/aliases/my-sell-offers');
  });
}

async function expectOffersTab(page: Page, tab: OfferTab): Promise<void> {
  await expect(
    page.locator('app-offers h3.card-title'),
    `the ${tab} buy-offers list did not render — the route's data.offerType never reached OffersComponent`,
  ).toHaveText(`${tab.toUpperCase()} Buy Offers`, { timeout: DEFAULT_TIMEOUT_MS });
}

async function gotoBuyOffers(page: Page, tab: OfferTab): Promise<void> {
  await awaitListedRows(page, 'app-offers', OFFER_REQUEST[tab], async () => {
    await page.goto(`#/wallet/aliases/buy-offers/${tab.toLowerCase()}`);
  });
  await expectOffersTab(page, tab);
}

async function switchBuyOffersTab(page: Page, tab: OfferTab): Promise<void> {
  await awaitListedRows(page, 'app-offers', OFFER_REQUEST[tab], async () => {
    await page.locator('app-buy-offers ul.nav-tabs a').filter({ hasText: tab }).click();
  });
  await expectOffersTab(page, tab);
}

/** Drives buy-offers/buy-alias from the offer row of the alias. */
async function buyAliasThroughForm(
  page: Page,
  request: APIRequestContext,
  apiOrigin: string,
  aliasName: string,
  priceXin: number,
): Promise<void> {
  await offerRow(page, aliasName).locator('a.btn:has(i.fa-shopping-cart)').click();
  await expect(page, 'the buy action on the offer row did not open buy-offers/buy-alias').toHaveURL(
    /#\/(wallet\/)?aliases\/buy-offers\/buy-alias\?/,
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  const details = page.locator('app-buy-alias h6');
  await expect(
    details.first(),
    'buy-alias shows the wrong alias — the aliasName queryParam from the offer row was lost',
  ).toHaveText(aliasName);
  await expect(
    details.nth(1),
    'buy-alias shows the wrong asking price — the priceTQT queryParam or the amountTqt pipe is wrong',
  ).toContainText(`${priceXin}.00`);

  await page.locator('app-buy-alias button.btn-primary:has(i.fa-chevron-right)').click();

  const finish = page.locator('app-buy-alias button.btn-primary:has(i.fa-check)');
  await expect(
    finish,
    'Finish stayed disabled — buyAlias() got no signable bytes back: the offer is gone, the bid ' +
      'undercuts the asking price, or the chain considers this account the wrong buyer',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finish);
  expect(tx.subtype, 'the broadcast transaction is not an ALIAS_BUY (subtype 7)').toBe(7);
  expect(
    Number(tx.amountTQT),
    `the buyer paid ${tx.amountTQT} TQT instead of the ${priceXin} XIN asking price`,
  ).toBe(priceXin * TQT_PER_XIN);
}

/** Drives my-sell-offers/cancel-alias-sell from the offer row of the alias. */
async function cancelOfferThroughForm(
  page: Page,
  request: APIRequestContext,
  apiOrigin: string,
  alerts: AlertLog,
  aliasName: string,
  priceXin: number,
): Promise<void> {
  await offerRow(page, aliasName).locator('a.btn:has(i.fa-times)').click();
  await expect(
    page,
    'the cancel action on the offer row did not open my-sell-offers/cancel-alias-sell',
  ).toHaveURL(/#\/(wallet\/)?aliases\/my-sell-offers\/cancel-alias-sell\?/, {
    timeout: DEFAULT_TIMEOUT_MS,
  });

  const details = page.locator('app-cancel-alias-sell h6');
  await expect(
    details.first(),
    'cancel-alias-sell shows the wrong alias — the aliasName queryParam from the offer row was lost',
  ).toHaveText(aliasName);
  await expect(
    details.nth(1),
    'cancel-alias-sell shows the wrong sale price — the priceTQT queryParam was lost',
  ).toContainText(`${priceXin}.00`);

  await page.locator('app-cancel-alias-sell button.btn-primary:has(i.fa-chevron-right)').click();

  const finish = page.locator('app-cancel-alias-sell button.btn-primary:has(i.fa-check)');
  await expect(
    finish,
    'Finish stayed disabled — cancelAlias() got no signable bytes back, so the chain rejected ' +
      'the withdrawal',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finish);
  expect(tx.subtype, 'the withdrawal is not an ALIAS_SELL (subtype 6)').toBe(6);
  expect(
    Number(tx.attachment?.priceTQT),
    `withdrawing an offer must send priceTQT 0, not ${tx.attachment?.priceTQT} — anything else ` +
      're-prices the offer instead of removing it',
  ).toBe(0);

  await expect
    .poll(() => alerts.last()?.kind, {
      message: 'the wallet raised no success dialog after broadcasting the withdrawal',
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe('success');

  await expect(
    page,
    'the wallet did not return to my-sell-offers after the withdrawal was broadcast',
  ).toHaveURL(/#\/(wallet\/)?aliases\/my-sell-offers(?!\/)/, { timeout: DEFAULT_TIMEOUT_MS });
}

test.describe('aliases: trading', () => {
  test.beforeEach(async ({ page }) => {
    const welcome = new WelcomePage(page);
    const dashboard = new DashboardPage(page);
    await welcome.goto();
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await dashboard.expectVisible();
  });

  test('alias-trading: a private sell offer reaches only the named buyer, who takes ownership through buy-alias', async ({
    page,
    request,
    baseURL,
    browser,
    infoAlerts,
  }) => {
    test.setTimeout(180_000);
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const aliasName = uniqueAliasName('e2eprv');
    const priceXin = uniquePriceXin();

    await registerAlias(request, apiOrigin, aliasName);

    await openSellForm(page, aliasName);
    await sellAliasThroughForm(
      page,
      request,
      apiOrigin,
      infoAlerts,
      aliasName,
      priceXin,
      TEST_ACCOUNT_2_RS,
    );

    await gotoMySellOffers(page);
    const mine = offerRow(page, aliasName);
    await expect(
      mine,
      `my-sell-offers does not list ${aliasName} — the seller cannot see the offer it just placed`,
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      mine,
      'my-sell-offers names the wrong buyer for the private offer',
    ).toContainText(TEST_ACCOUNT_2_RS);
    await expect(
      mine,
      `my-sell-offers shows the wrong price for ${aliasName} — expected ${priceXin}.00 XIN`,
    ).toContainText(`${priceXin}.00`);

    const context = await browser.newContext({ baseURL });
    try {
      const buyer = await context.newPage();
      const welcome = new WelcomePage(buyer);
      await welcome.goto();
      await welcome.login(TEST_ACCOUNT_2_PASSPHRASE);
      await new DashboardPage(buyer).expectVisible();

      await gotoBuyOffers(buyer, 'Public');
      await expect(
        offerRow(buyer, aliasName),
        `${aliasName} was offered privately but shows up on the public tab — every private offer ` +
          'is exposed to the whole network',
      ).toHaveCount(0);

      await switchBuyOffersTab(buyer, 'Private');
      const offered = offerRow(buyer, aliasName);
      await expect(
        offered,
        `the named buyer does not see the private offer for ${aliasName} — ` +
          'getAliasesPrivateOffers is queried with the wrong account',
      ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
      await expect(offered, 'the private offer names the wrong seller').toContainText(
        TEST_ACCOUNT_1_RS,
      );
      await expect(
        offered,
        `the private offer shows the wrong price — expected ${priceXin}.00 XIN`,
      ).toContainText(`${priceXin}.00`);

      await buyAliasThroughForm(buyer, request, apiOrigin, aliasName, priceXin);
    } finally {
      await context.close();
    }

    await expect
      .poll(() => aliasOwner(request, apiOrigin, aliasName), {
        message:
          `${aliasName} did not change hands — the ALIAS_BUY confirmed but getAlias still reports ` +
          'the seller as owner',
        timeout: CONFIRM_TIMEOUT_MS,
      })
      .toBe(TEST_ACCOUNT_2_RS);
  });

  test('alias-trading: a public sell offer is open to any account and transfers ownership on purchase', async ({
    page,
    request,
    baseURL,
    browser,
    infoAlerts,
  }) => {
    test.setTimeout(180_000);
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const aliasName = uniqueAliasName('e2epub');
    const priceXin = uniquePriceXin();

    await registerAlias(request, apiOrigin, aliasName);

    await openSellForm(page, aliasName);
    await sellAliasThroughForm(page, request, apiOrigin, infoAlerts, aliasName, priceXin, '');

    await gotoMySellOffers(page);
    await expect(
      offerRow(page, aliasName),
      `my-sell-offers does not list the public offer for ${aliasName}`,
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      offerRow(page, aliasName),
      `my-sell-offers shows the wrong price for ${aliasName} — expected ${priceXin}.00 XIN`,
    ).toContainText(`${priceXin}.00`);

    const context = await browser.newContext({ baseURL });
    try {
      const buyer = await context.newPage();
      const welcome = new WelcomePage(buyer);
      await welcome.goto();
      await welcome.login(TEST_ACCOUNT_2_PASSPHRASE);
      await new DashboardPage(buyer).expectVisible();

      await gotoBuyOffers(buyer, 'Private');
      await expect(
        offerRow(buyer, aliasName),
        `${aliasName} was offered publicly but shows up under private offers — the private tab ` +
          'no longer filters by buyer',
      ).toHaveCount(0);

      await switchBuyOffersTab(buyer, 'Public');
      const offered = offerRow(buyer, aliasName);
      await expect(
        offered,
        `the public offer for ${aliasName} is not listed — an offer without a recipient is ` +
          'invisible to buyers',
      ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
      await expect(offered, 'the public offer names the wrong seller').toContainText(
        TEST_ACCOUNT_1_RS,
      );
      await expect(
        offered,
        `the public offer shows the wrong price — expected ${priceXin}.00 XIN`,
      ).toContainText(`${priceXin}.00`);

      await buyAliasThroughForm(buyer, request, apiOrigin, aliasName, priceXin);
    } finally {
      await context.close();
    }

    await expect
      .poll(() => aliasOwner(request, apiOrigin, aliasName), {
        message: `${aliasName} did not change hands after the public purchase confirmed`,
        timeout: CONFIRM_TIMEOUT_MS,
      })
      .toBe(TEST_ACCOUNT_2_RS);
  });

  test('alias-trading: cancel-alias-sell takes the offer off both the seller list and the public buy offers', async ({
    page,
    request,
    baseURL,
    infoAlerts,
  }) => {
    test.setTimeout(150_000);
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const aliasName = uniqueAliasName('e2ecxl');
    const priceXin = uniquePriceXin();

    await registerAlias(request, apiOrigin, aliasName);

    await openSellForm(page, aliasName);
    await sellAliasThroughForm(page, request, apiOrigin, infoAlerts, aliasName, priceXin, '');

    await gotoBuyOffers(page, 'Public');
    await expect(
      offerRow(page, aliasName),
      `${aliasName} is not on the public buy offers — the cancellation below would prove nothing`,
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    await gotoMySellOffers(page);
    await expect(
      offerRow(page, aliasName),
      `my-sell-offers does not list ${aliasName}, so its cancel action is unreachable`,
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    await cancelOfferThroughForm(page, request, apiOrigin, infoAlerts, aliasName, priceXin);

    await gotoMySellOffers(page);
    await expect(
      offerRow(page, aliasName),
      `${aliasName} is still listed under my-sell-offers after the sale was withdrawn`,
    ).toHaveCount(0);

    await gotoBuyOffers(page, 'Public');
    await expect(
      offerRow(page, aliasName),
      `${aliasName} can still be bought publicly after the sale was withdrawn`,
    ).toHaveCount(0);
  });

  test.fixme(
    'alias-trading: withdrawing an offer leaves the alias with its owner — cancel-alias-sell.component.ts:52 ' +
      'passes params.aliasId as the sellAlias recipient, and priceTQT 0 means "hand the alias to the recipient" ' +
      '(Alias.sellAlias → changeOwner), so a cancel gives the alias away to the phantom account whose numeric id is the aliasId',
    async ({ page, request, baseURL, infoAlerts }) => {
      test.setTimeout(150_000);
      const apiOrigin = apiOriginFromBaseURL(baseURL);
      const aliasName = uniqueAliasName('e2ecxo');
      const priceXin = uniquePriceXin();

      await registerAlias(request, apiOrigin, aliasName);

      await openSellForm(page, aliasName);
      await sellAliasThroughForm(page, request, apiOrigin, infoAlerts, aliasName, priceXin, '');

      await gotoMySellOffers(page);
      await cancelOfferThroughForm(page, request, apiOrigin, infoAlerts, aliasName, priceXin);

      expect(
        await aliasOwner(request, apiOrigin, aliasName),
        `withdrawing the sale transferred ${aliasName} away from ${TEST_ACCOUNT_1_RS} — the owner ` +
          'lost the alias to an account nobody holds the keys for',
      ).toBe(TEST_ACCOUNT_1_RS);
    },
  );
});
