import { test, expect } from '../../../fixtures/test';
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

/**
 * The four writing asset masks behind the row actions of
 * `#/wallet/assets/show-assets/my`: transfer-asset, dividend-payment,
 * delete-shares, delete-asset.
 *
 * Risk covered: quantity scaling. Every share count the user types is
 * multiplied by 10^decimals (`shareToQuantityPipe`) before it is signed, and
 * the dividend is an amount in XIN that the chain applies *per QNT*. A drift
 * in either conversion moves a wrong number of shares or pays a wrong amount
 * of real money, and neither is visible in the UI — the confirm step echoes
 * what was typed, not what was signed. Every test therefore reads the value
 * back off the chain (attachment + account state), never off the page.
 *
 * The fixture asset is issued with decimals=2 on purpose: at decimals=0 both
 * conversions collapse to the identity and the tests would prove nothing.
 *
 * The row actions are the only entry point into the four masks; the first test
 * pins them. The write tests open the mask at the URL that entry point builds,
 * because the table renders only the first ten of the account's holdings and a
 * fresh fixture lands among them only by chance (see that test's message).
 */

const API_BASE = process.env.API_BASE ?? `${apiOriginFromBaseURL(process.env.BASE_URL)}/api`;

const DECIMALS = 2;
const QNT_PER_SHARE = 10 ** DECIMALS;
const TQT_PER_XIN = 100_000_000;

/** 1000.00 shares — big enough that no test starves the next one. */
const SUPPLY_QNT = 100_000;

const TRANSFER_SHARES = 12.34;
const DELETE_SHARES = 3.21;
/** Binary-representation probe: 1.15 * 100 is 114.99999999999999 in IEEE-754. */
const FRACTION_SHARES = 1.15;
const DIVIDEND_PER_SHARE_XIN = 1;

const MY_ASSETS_ROUTE = '#/wallet/assets/show-assets/my';
const TABLE_PAGE_SIZE = 10;

const FIXTURE_CONFIRM_TIMEOUT_MS = 30_000;
const FIXTURE_POLL_INTERVAL_MS = 1_000;

let apiCtx: APIRequestContext;
/** Mutated by transfer / dividend / delete-shares. */
let mutAssetId: string;
let mutAssetName: string;
/** Untouched until delete-asset: a complete delete is refused once an asset
 *  has a transfer, a trade, a dividend or a share deletion on it. */
let pristineAssetId: string;
let pristineAssetName: string;

/** What the dividend the wizard broadcast actually did, for the scaling test
 *  below. Devnet throttles an asset to one dividend per block, so that test
 *  reads back this payment instead of triggering a second one. */
let paidTqtPerQnt: number;
let paidHolderQnt: number;
let paidHolderGainTqt: number;

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

async function issueFixtureAsset(name: string): Promise<string> {
  const created = await apiPost({
    requestType: 'issueAsset',
    name,
    description: 'e2e asset-mutations fixture — devnet only',
    quantityQNT: String(SUPPLY_QNT),
    decimals: String(DECIMALS),
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

/** Shares an account currently holds, in QNT. `getAccountAssets` answers `{}`
 *  for an account that holds none, so a missing field means zero. */
async function heldQnt(accountRS: string, assetId: string): Promise<number> {
  const held = await apiGet({ requestType: 'getAccountAssets', account: accountRS, asset: assetId });
  return Number(held.quantityQNT ?? 0);
}

async function assetSupplyQnt(assetId: string): Promise<number> {
  const asset = await apiGet({ requestType: 'getAsset', asset: assetId });
  return Number(asset.quantityQNT ?? 0);
}

/** Confirm steps render every value as `<div class="ucsb">Label</div><h4>value</h4>`.
 *  Matching the label exactly also pins that the i18n key resolved. */
function confirmValue(page: Page, label: string): Locator {
  return page
    .locator('aw-wizard-step .col-md-6')
    .filter({ has: page.locator('.ucsb', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) })
    .locator('h4')
    .first();
}

const nextButton = (page: Page) => page.locator('button.btn-primary:has(i.fa-chevron-right)').first();
const finishButton = (page: Page) => page.locator('button.btn-primary:has(i.fa-check)').first();

/** The four row actions of the My Assets table and the mask each opens. */
const ROW_ACTIONS = [
  { icon: 'fa-user', route: 'transfer-asset' },
  { icon: 'fa-dollar', route: 'dividend-payment' },
  { icon: 'fa-minus', route: 'delete-shares' },
  { icon: 'fa-times', route: 'delete-asset' },
] as const;

/**
 * Opens a mask at the URL its row action builds.
 *
 * The row action itself is covered by the first test below. It cannot carry the
 * write tests: the My Assets table only ever renders the first ten holdings
 * (see that test), and which ten those are depends on the asset ids the chain
 * hands out, so a fresh fixture is reachable by click only by luck.
 */
async function openMask(page: Page, assetId: string, route: string): Promise<void> {
  await page.goto(`#/wallet/assets/show-assets/${route}?id=${assetId}`);
  // getAsset fills the read-only fields asynchronously; typing before it lands
  // would sign a transaction on an empty asset id.
  await expect(
    page.locator('h6', { hasText: assetId }).first(),
    `${route} did not resolve the ?id= query param into an asset — getAsset() never answered, or ` +
    'the component fell back to _location.back()',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
}

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  mutAssetName = randomAssetName();
  mutAssetId = await issueFixtureAsset(mutAssetName);
  pristineAssetName = randomAssetName();
  pristineAssetId = await issueFixtureAsset(pristineAssetName);

  await awaitConfirmations([mutAssetId, pristineAssetId], 'issueAsset fixture');
});

test.afterAll(async () => {
  // The My Assets table only ever renders the first ten holdings (see
  // the first test), so a fixture left behind would eventually push the next
  // run's fixture out of reach. Burning the rest drops the account_asset row.
  for (const assetId of [mutAssetId, pristineAssetId]) {
    if (!assetId) continue;
    try {
      const left = await heldQnt(TEST_ACCOUNT_1_RS, assetId);
      if (left <= 0) continue;
      const burned = await apiPost({
        requestType: 'deleteAssetShares',
        asset: assetId,
        quantityQNT: String(left),
        secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
        feeTQT: String(TQT_PER_XIN),
        deadline: '80',
        broadcast: 'true',
      });
      if (burned.errorCode || !burned.transaction) {
        console.warn(`[asset-mutations cleanup] deleteAssetShares(${assetId}) failed: ${JSON.stringify(burned)}`);
      }
    } catch (err) {
      console.warn(`[asset-mutations cleanup] deleteAssetShares(${assetId}) threw: ${err}`);
    }
  }
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test.describe.serial('asset mutations', () => {
  test('show-assets/my: the four row actions open their mask on the row\'s own asset', async ({ page }) => {
    const list = await apiGet({
      requestType: 'getAccountAssets',
      account: TEST_ACCOUNT_1_RS,
      includeAssetInfo: 'true',
      includeCounts: 'true',
    });
    const held: any[] = list.accountAssets ?? [];
    // Only the first ten holdings ever render (see the assertion below), and the
    // dividend / delete-asset actions are gated on being the issuer.
    const rendered = held.slice(0, TABLE_PAGE_SIZE);
    const subject = rendered.find(
      (a) => a.issuerAccountRS === TEST_ACCOUNT_1_RS &&
        rendered.filter((b) => b.name === a.name).length === 1,
    );
    expect(
      subject,
      `none of the ${rendered.length} holdings the My Assets table renders is a uniquely named asset ` +
      `issued by ${TEST_ACCOUNT_1_RS}, so no row can carry all four actions — the beforeAll fixtures ` +
      'should have supplied one',
    ).toBeTruthy();

    for (const { icon, route } of ROW_ACTIONS) {
      await page.goto(MY_ASSETS_ROUTE);
      const table = page.locator('app-assets ngx-datatable');
      const row = table.locator('datatable-body-row', { hasText: subject.name });
      await expect(
        row,
        `"${subject.name}" is holding ${held.findIndex((a) => a.asset === subject.asset) + 1} of ` +
        `${held.length} and does not render in the My Assets table. The table never shows more than the ` +
        'first ten holdings: assets.component.ts:104 fetches the whole getAccountAssets list without ' +
        'firstIndex/lastIndex while the datatable runs with externalPaging=true, and ngx-datatable pins ' +
        'first=0 in that mode — so every pager page re-renders rows 1-10 and every holding past the tenth ' +
        'is unreachable, together with all four row actions on it',
      ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

      const action = row.locator(`a.btn:has(i.${icon})`);
      await expect(
        action,
        `the My Assets row for "${subject.name}" has no ${icon} action — the entry point into ${route} is gone`,
      ).toHaveCount(1);
      await expect(
        action,
        `the ${icon} action is rendered disabled although ${TEST_ACCOUNT_1_RS} issued "${subject.name}" — ` +
        'the accountRs === row.issuerAccountRS gate in assets.component.html compares the wrong fields, ' +
        'and Bootstrap makes a .disabled .btn pointer-events:none, so the mask is unreachable',
      ).not.toHaveClass(/\bdisabled\b/);

      await action.click();
      await page.waitForURL(new RegExp(`#/wallet/assets/show-assets/${route}\\?id=${subject.asset}$`), {
        timeout: DEFAULT_TIMEOUT_MS,
      });
      await expect(
        page.locator('h6', { hasText: subject.asset }).first(),
        `${route} opened but shows a different asset than the row it was started from — the ?id= ` +
        'hand-off in assets.component.ts passes the wrong column',
      ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    }
  });

  test('transfer-asset: the entered share count reaches the chain scaled by 10^decimals', async ({
    page, request, baseURL, infoAlerts,
  }) => {
    await openMask(page, mutAssetId, 'transfer-asset');

    await page.locator('input[name="recipientRS"]').fill(TEST_ACCOUNT_2_RS);
    await page.locator('input[name="quantity"]').fill(String(TRANSFER_SHARES));
    await page.locator('input[name="quantity"]').blur();

    await expect(
      nextButton(page),
      'Next stayed disabled after recipient + shares — the two required validators regressed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    await nextButton(page).click();

    await expect(
      confirmValue(page, 'Asset Id'),
      'the transfer confirm step lost the asset id it was opened with',
    ).toHaveText(mutAssetId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      confirmValue(page, 'Asset'),
      'the transfer confirm step shows a different asset name than getAsset returned',
    ).toHaveText(mutAssetName);
    await expect(
      confirmValue(page, 'Recipient'),
      'the transfer confirm step shows a different recipient than the one entered',
    ).toHaveText(TEST_ACCOUNT_2_RS);
    await expect(
      confirmValue(page, 'Quantity'),
      'the transfer confirm step shows a different share count than the one entered',
    ).toHaveText(String(TRANSFER_SHARES));

    await expect(
      finishButton(page),
      'Finish never enabled — transferAsset() failed to build or sign the ASSET_TRANSFER bytes',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const senderBefore = await heldQnt(TEST_ACCOUNT_1_RS, mutAssetId);
    const recipientBefore = await heldQnt(TEST_ACCOUNT_2_RS, mutAssetId);

    const { txId, tx } = await broadcastAndAwaitConfirmation(
      page, request, apiOriginFromBaseURL(baseURL), finishButton(page),
    );

    expect(tx.type, 'confirmed tx has the wrong type — expected Asset Exchange (2)').toBe(2);
    expect(tx.subtype, 'confirmed tx has the wrong subtype — expected ASSET_TRANSFER (1)').toBe(1);
    expect(tx.recipientRS, 'the transfer went to a different account than the one entered')
      .toBe(TEST_ACCOUNT_2_RS);
    expect(String(tx.attachment.asset), 'the transfer is on a different asset than the one the mask was opened with')
      .toBe(mutAssetId);

    const expectedQnt = TRANSFER_SHARES * QNT_PER_SHARE;
    expect(
      String(tx.attachment.quantityQNT),
      `transfer ${txId} signed a quantityQNT of ${tx.attachment.quantityQNT} — ${TRANSFER_SHARES} shares ` +
      `of a decimals=${DECIMALS} asset must be scaled by shareToQuantity to ${expectedQnt} QNT`,
    ).toBe(String(expectedQnt));

    expect(
      await heldQnt(TEST_ACCOUNT_2_RS, mutAssetId),
      `the recipient's holding did not grow by exactly ${expectedQnt} QNT after transfer ${txId}`,
    ).toBe(recipientBefore + expectedQnt);
    expect(
      await heldQnt(TEST_ACCOUNT_1_RS, mutAssetId),
      `the sender's holding did not shrink by exactly ${expectedQnt} QNT after transfer ${txId}`,
    ).toBe(senderBefore - expectedQnt);

    await expect
      .poll(() => infoAlerts.last()?.kind, {
        message: 'the wallet raised no success dialog after broadcasting the asset transfer',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toBe('success');
  });

  test('dividend-payment: pays every shareholder amountTQTPerQNT per QNT at the entered height', async ({
    page, request, baseURL, infoAlerts,
  }) => {
    await openMask(page, mutAssetId, 'dividend-payment');

    const heightInput = page.locator('input[name="height"]');
    // The height is prefilled from getBlockchainStatus *after* the form renders,
    // and `required` accepts the initial 0 — signing before it lands would ask
    // the chain for shareholders at height 0.
    await expect(
      heightInput,
      'the height field never left its initial 0 — getBlockChainStatus did not answer, and a dividend ' +
      'at height 0 is rejected by the node',
    ).not.toHaveValue('0', { timeout: DEFAULT_TIMEOUT_MS });
    const enteredHeight = Number(await heightInput.inputValue());

    await page.locator('input[name="amountPerQuant"]').fill(String(DIVIDEND_PER_SHARE_XIN));
    await page.locator('input[name="amountPerQuant"]').blur();

    await expect(
      nextButton(page),
      'Next stayed disabled after amount + height — the minValue="1" validator on the amount regressed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    await nextButton(page).click();

    await expect(
      confirmValue(page, 'Asset Id'),
      'the dividend confirm step lost the asset id it was opened with',
    ).toHaveText(mutAssetId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      confirmValue(page, 'Height'),
      'the dividend confirm step shows a different height than the form did',
    ).toHaveText(String(enteredHeight));

    await expect(
      finishButton(page),
      'Finish never enabled — dividendPayment() failed to build or sign the DIVIDEND_PAYMENT bytes ' +
      '(a dividend costs a fixed 10 XIN fee on devnet, the form asks for 1)',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const holderQnt = await heldQnt(TEST_ACCOUNT_2_RS, mutAssetId);
    expect(
      holderQnt,
      'TEST_ACCOUNT_2 holds no shares, so this dividend would pay nobody and prove nothing — the ' +
      'transfer test must run first',
    ).toBeGreaterThan(0);
    const holderBalanceBefore = Number(
      (await apiGet({ requestType: 'getAccount', account: TEST_ACCOUNT_2_RS })).balanceTQT,
    );

    const { txId, tx } = await broadcastAndAwaitConfirmation(
      page, request, apiOriginFromBaseURL(baseURL), finishButton(page),
    );

    expect(tx.type, 'confirmed tx has the wrong type — expected Asset Exchange (2)').toBe(2);
    expect(tx.subtype, 'confirmed tx has the wrong subtype — expected DIVIDEND_PAYMENT (6)').toBe(6);
    expect(String(tx.attachment.asset), 'the dividend is on a different asset than the one the mask was opened with')
      .toBe(mutAssetId);
    expect(
      Number(tx.attachment.height),
      `dividend ${txId} was signed for height ${tx.attachment.height} although the form showed ` +
      `${enteredHeight} — the shareholder snapshot is taken at the wrong block`,
    ).toBe(enteredHeight);

    const amountTqtPerQnt = Number(tx.attachment.amountTQTPerQNT);
    // Characterisation, not the intended contract — see the fixme below.
    expect(
      amountTqtPerQnt,
      `dividend ${txId} signed amountTQTPerQNT=${tx.attachment.amountTQTPerQNT} for the entered ` +
      `${DIVIDEND_PER_SHARE_XIN} XIN per share. Today's path is the ungeared pass-through: ` +
      'dividend-payment.component.ts:74 sends the entered amount through amountToQuantPipe (XIN -> TQT, ' +
      `* ${TQT_PER_XIN}) alone, the "/ 10^decimals" at :75 is commented out, so the value must be ` +
      `${DIVIDEND_PER_SHARE_XIN * TQT_PER_XIN}. A different value means either the input[name="amountPerQuant"] ` +
      'binding stopped delivering what was typed (ignored, stale or constant), or the scaling defect was ' +
      'fixed — in that case this line is expected to break and the fixme "Amount per Share is scaled per ' +
      'share, not per QNT" below is the one to un-fixme',
    ).toBe(DIVIDEND_PER_SHARE_XIN * TQT_PER_XIN);

    // The chain multiplies amountTQTPerQNT by every holder's QNT; pinning that
    // proves the height snapshot and the holder set are the ones the form named.
    const holderBalanceAfter = Number(
      (await apiGet({ requestType: 'getAccount', account: TEST_ACCOUNT_2_RS })).balanceTQT,
    );
    expect(
      holderBalanceAfter - holderBalanceBefore,
      `the shareholder's balance moved by ${holderBalanceAfter - holderBalanceBefore} TQT, but holding ` +
      `${holderQnt} QNT at height ${enteredHeight} must pay exactly ${holderQnt * amountTqtPerQnt} TQT`,
    ).toBe(holderQnt * amountTqtPerQnt);

    paidTqtPerQnt = amountTqtPerQnt;
    paidHolderQnt = holderQnt;
    paidHolderGainTqt = holderBalanceAfter - holderBalanceBefore;

    const dividends = await apiGet({ requestType: 'getAssetDividends', asset: mutAssetId });
    const mine = (dividends.dividends ?? []).find((d: any) => d.assetDividend === txId);
    expect(
      mine,
      `getAssetDividends(asset=${mutAssetId}) has no record for dividend ${txId} — the payment was ` +
      'confirmed but never booked as an asset dividend',
    ).toBeTruthy();
    expect(
      String(mine.amountTQTPerQNT),
      'the booked dividend rate differs from the signed attachment',
    ).toBe(String(amountTqtPerQnt));
    expect(
      Number(mine.dividendHeight),
      'the booked dividend snapshot height differs from the signed attachment',
    ).toBe(enteredHeight);

    await expect
      .poll(() => infoAlerts.last()?.kind, {
        message: 'the wallet raised no success dialog after broadcasting the dividend payment',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toBe('success');
  });

  // Asserts on the payment the previous test broadcast through the wizard:
  // devnet allows one dividend per asset per block, so triggering a second one
  // here would fail on the throttle instead of on the amount.
  test.fixme(
    'dividend-payment: "Amount per Share" is scaled per share, not per QNT — dividend-payment.component.ts:74 ' +
    'sends the entered amount through amountToQuantPipe (XIN -> TQT) alone, while the chain multiplies ' +
    'amountTQTPerQNT by every holder\'s QNT. Entering 1 XIN per share on a decimals=2 asset signs ' +
    'amountTQTPerQNT=100000000 instead of 1000000 and pays a holder of 12.34 shares 1234 XIN instead of ' +
    '12.34 XIN — 10^decimals too much. The missing "/ 10^decimals" sits commented out directly below the ' +
    'call, and the field name (amountPerQuant) contradicts the label and popover ("The dividend in XIN for ' +
    'EACH share"), so which of the two is the intended contract is a product decision',
    async () => {
      expect(paidTqtPerQnt, 'no dividend was recorded — the dividend test must run first').toBeTruthy();

      const expectedPerQnt = (DIVIDEND_PER_SHARE_XIN * TQT_PER_XIN) / QNT_PER_SHARE;
      expect(
        paidTqtPerQnt,
        `the wizard signed amountTQTPerQNT=${paidTqtPerQnt} for ${DIVIDEND_PER_SHARE_XIN} XIN per share ` +
        `on a decimals=${DECIMALS} asset, which is ${expectedPerQnt} TQT per QNT`,
      ).toBe(expectedPerQnt);

      const holderShares = paidHolderQnt / QNT_PER_SHARE;
      const expectedGain = holderShares * DIVIDEND_PER_SHARE_XIN * TQT_PER_XIN;
      expect(
        paidHolderGainTqt,
        `a holder of ${holderShares} shares was paid ${paidHolderGainTqt} TQT at ` +
        `${DIVIDEND_PER_SHARE_XIN} XIN per share, which must be ${expectedGain} TQT`,
      ).toBe(expectedGain);
    },
  );

  test(
    'transfer-asset: a share count that is not exactly representable in binary is not truncated — ' +
    'share-to-quantity.pipe.ts:11 multiplies in floating point and assets.service.ts:176 then truncates ' +
    'with parseInt, so 1.15 shares of a decimals=2 asset become 114 QNT instead of 115 (1.15 * 100 is ' +
    '114.99999999999999). The confirm step still shows 1.15, so the shares vanish silently. The same ' +
    'pipe + parseInt pair feeds send-assets, delete-shares and both trade-desk order forms',
    async ({ page, request, baseURL }) => {
      await openMask(page, mutAssetId, 'transfer-asset');

      await page.locator('input[name="recipientRS"]').fill(TEST_ACCOUNT_2_RS);
      await page.locator('input[name="quantity"]').fill(String(FRACTION_SHARES));
      await page.locator('input[name="quantity"]').blur();
      await nextButton(page).click();
      await expect(finishButton(page)).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

      const recipientBefore = await heldQnt(TEST_ACCOUNT_2_RS, mutAssetId);
      const { txId, tx } = await broadcastAndAwaitConfirmation(
        page, request, apiOriginFromBaseURL(baseURL), finishButton(page),
      );

      const expectedQnt = Math.round(FRACTION_SHARES * QNT_PER_SHARE);
      expect(
        String(tx.attachment.quantityQNT),
        `transfer ${txId} signed ${tx.attachment.quantityQNT} QNT for ${FRACTION_SHARES} shares of a ` +
        `decimals=${DECIMALS} asset. ${FRACTION_SHARES} * ${QNT_PER_SHARE} is ` +
        `${FRACTION_SHARES * QNT_PER_SHARE} in IEEE-754, and truncating that loses shares the confirm ` +
        'step still shows as sent',
      ).toBe(String(expectedQnt));
      expect(
        await heldQnt(TEST_ACCOUNT_2_RS, mutAssetId),
        `the recipient received a different number of QNT than the ${expectedQnt} the entered share count is worth`,
      ).toBe(recipientBefore + expectedQnt);
    },
  );

  test('delete-shares: burns the entered share count scaled by 10^decimals', async ({
    page, request, baseURL, infoAlerts,
  }) => {
    await openMask(page, mutAssetId, 'delete-shares');

    await page.locator('input[name="quantity"]').fill(String(DELETE_SHARES));
    await page.locator('input[name="quantity"]').blur();

    await expect(
      nextButton(page),
      'Next stayed disabled after a share count — the minValue="1" validator on the quantity regressed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    await nextButton(page).click();

    await expect(
      confirmValue(page, 'Asset Id'),
      'the delete-shares confirm step lost the asset id it was opened with',
    ).toHaveText(mutAssetId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      confirmValue(page, 'Quantity'),
      'the delete-shares confirm step shows a different share count than the one entered',
    ).toHaveText(String(DELETE_SHARES));

    await expect(
      finishButton(page),
      'Finish never enabled — deleteAssetShares() failed to build or sign the ASSET_DELETE bytes',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const holdingBefore = await heldQnt(TEST_ACCOUNT_1_RS, mutAssetId);
    const supplyBefore = await assetSupplyQnt(mutAssetId);

    const { txId, tx } = await broadcastAndAwaitConfirmation(
      page, request, apiOriginFromBaseURL(baseURL), finishButton(page),
    );

    expect(tx.type, 'confirmed tx has the wrong type — expected Asset Exchange (2)').toBe(2);
    expect(tx.subtype, 'confirmed tx has the wrong subtype — expected ASSET_DELETE (7)').toBe(7);
    expect(String(tx.attachment.asset), 'the deletion hit a different asset than the one the mask was opened with')
      .toBe(mutAssetId);

    const expectedQnt = DELETE_SHARES * QNT_PER_SHARE;
    expect(
      String(tx.attachment.quantityQNT),
      `delete ${txId} signed a quantityQNT of ${tx.attachment.quantityQNT} — ${DELETE_SHARES} shares of a ` +
      `decimals=${DECIMALS} asset must be scaled by shareToQuantity to ${expectedQnt} QNT`,
    ).toBe(String(expectedQnt));

    expect(
      await heldQnt(TEST_ACCOUNT_1_RS, mutAssetId),
      `the holding did not shrink by exactly ${expectedQnt} QNT after deletion ${txId}`,
    ).toBe(holdingBefore - expectedQnt);
    expect(
      await assetSupplyQnt(mutAssetId),
      `the asset's total supply did not shrink by exactly ${expectedQnt} QNT after deletion ${txId} — ` +
      'burnt shares must leave circulation, not only the account',
    ).toBe(supplyBefore - expectedQnt);

    await expect
      .poll(() => infoAlerts.last()?.kind, {
        message: 'the wallet raised no success dialog after broadcasting the share deletion',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toBe('success');
  });

  test('delete-asset: removes the asset from the chain', async ({
    page, request, baseURL, infoAlerts,
  }) => {
    // A complete delete is only valid while the asset has exactly one holder and
    // no transfer, trade, dividend or share deletion on it — hence its own fixture.
    await openMask(page, pristineAssetId, 'delete-asset');

    await expect(
      nextButton(page),
      'Next stayed disabled on the delete-asset form, which has no inputs to invalidate',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    await nextButton(page).click();

    await expect(
      confirmValue(page, 'Asset Id'),
      'the delete-asset confirm step lost the asset id it was opened with',
    ).toHaveText(pristineAssetId, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      confirmValue(page, 'Asset'),
      'the delete-asset confirm step shows a different asset name than getAsset returned',
    ).toHaveText(pristineAssetName);

    await expect(
      finishButton(page),
      'Finish never enabled — deleteAssetFull() failed to build or sign the ASSET_COMPLETE_DELETE bytes ' +
      '(the node refuses a complete delete once the asset has a transfer, trade, dividend or share deletion)',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const { txId, tx } = await broadcastAndAwaitConfirmation(
      page, request, apiOriginFromBaseURL(baseURL), finishButton(page),
    );

    expect(tx.type, 'confirmed tx has the wrong type — expected Asset Exchange (2)').toBe(2);
    expect(tx.subtype, 'confirmed tx has the wrong subtype — expected ASSET_COMPLETE_DELETE (8)').toBe(8);
    expect(String(tx.attachment.asset), 'the delete hit a different asset than the one the mask was opened with')
      .toBe(pristineAssetId);

    const asset = await apiGet({ requestType: 'getAsset', asset: pristineAssetId });
    expect(
      asset.errorCode,
      `getAsset(${pristineAssetId}) still answers after complete delete ${txId}: ${JSON.stringify(asset)} — ` +
      'the asset was not removed from the chain',
    ).toBeDefined();
    expect(
      await heldQnt(TEST_ACCOUNT_1_RS, pristineAssetId),
      `TEST_ACCOUNT_1 still holds shares of the deleted asset ${pristineAssetId}`,
    ).toBe(0);

    await expect
      .poll(() => infoAlerts.last()?.kind, {
        message: 'the wallet raised no success dialog after broadcasting the asset deletion',
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .toBe('success');
  });
});
