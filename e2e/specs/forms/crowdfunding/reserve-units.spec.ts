import { test, expect } from '../../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_ID, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';
import { createTestCampaign } from '../../../helpers/create-campaign';

/**
 * reserve-units (`#/wallet/crowdfunding/show-campaigns/reserve-units`).
 *
 * Risk covered: the mask takes a *total* in XIN and derives what actually goes
 * on chain — `amountPerUnitTQT = amountTotal / reserveSupply * 1e8` — while the
 * node debits `reserveSupply * amountPerUnitTQT`. A scaling regression in that
 * chain of divisions books a wrong amount and is invisible in the UI, so every
 * number is pinned against getTransaction / getCurrency / getCurrencyFounders
 * and the account balance. The route carries no query param either: it reads its
 * subject from `DataStoreService`, so it is only reachable through the list.
 */

const RESERVE_SUPPLY = 100;
const TOTAL_XIN = 100;
const EXPECTED_PER_UNIT_TQT = '100000000';
const FEE_TQT = 100_000_000;

let apiBase: string;
let currencyId: string;
let campaignCode: string;

test.beforeAll(async ({ browser, baseURL }) => {
  apiBase = `${apiOriginFromBaseURL(baseURL)}/api`;
  const info = await createTestCampaign(browser, baseURL);
  currencyId = info.txId; // the currency id is the issueCurrency tx id
  campaignCode = info.code;
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

async function apiJson(request: APIRequestContext, params: Record<string, string>): Promise<any> {
  const resp = await request.get(apiBase, { params, timeout: DEFAULT_TIMEOUT_MS });
  expect(resp.ok(), `${params.requestType} failed with HTTP ${resp.status()}`).toBe(true);
  const json = await resp.json();
  expect(json.errorCode, `${params.requestType} returned an error: ${JSON.stringify(json)}`).toBeUndefined();
  return json;
}

const balanceOf = async (request: APIRequestContext): Promise<bigint> =>
  BigInt((await apiJson(request, { requestType: 'getAccount', account: TEST_ACCOUNT_1_ID })).balanceTQT);

test('reserve-units: subscribing 100 XIN books 1 XIN per unit on chain and debits reserveSupply × that', async ({ page, request, baseURL, infoAlerts }) => {
  const before = await apiJson(request, { requestType: 'getCurrency', currency: currencyId });
  expect(
    String(before.currentReservePerUnitTQT),
    `campaign ${campaignCode} already carries a reserve — the beforeAll campaign is not fresh`,
  ).toBe('0');
  expect(Number(before.reserveSupply), 'the seeded campaign must offer 100 units').toBe(RESERVE_SUPPLY);
  const balanceBefore = await balanceOf(request);

  await page.goto('#/wallet/crowdfunding/show-campaigns/all');
  const row = page
    .locator('datatable-body-row')
    .filter({ has: page.getByText(campaignCode, { exact: true }) });
  await expect(
    row,
    `campaign ${campaignCode} is not on the first page of show-campaigns/all — getAllCrowdfundings orders ` +
    'by issuance_height desc and this one was created last, so it should be at the top',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

  await row.locator('a:has(i.fa-bus)').click();
  await expect(
    page,
    'the reserve action did not open reserve-units — openReserveCampaign() did not navigate',
  ).toHaveURL(/reserve-units$/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('h6', { hasText: currencyId }),
    'reserve-units does not show the campaign id — the DataStoreService hand-off from the list is broken ' +
    'and the form would subscribe to a different campaign (the route carries no query param to fall back on)',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h6', { hasText: campaignCode }), 'reserve-units does not show the campaign ticker').toBeVisible();

  const amountTotal = page.locator('input[name="amountTotal"]');
  const amountUnit = page.locator('input[name="amountUnit"]');
  await amountTotal.fill(String(TOTAL_XIN));
  await expect(
    amountUnit,
    `entering ${TOTAL_XIN} XIN for ${RESERVE_SUPPLY} units must derive 1 XIN per unit — onAmountChange() ` +
    'divides by the wrong field or does not run at all',
  ).toHaveValue('1', { timeout: DEFAULT_TIMEOUT_MS });

  const next = page.locator('button.btn-primary:has(i.fa-chevron-right)').first();
  await expect(next, 'Next stayed disabled with a valid total').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await next.click();

  const finish = page.locator('button:has(i.fa-check)').first();
  await expect(
    finish,
    'Finish stayed disabled — currencyReserveIncrease was not signed locally, so validBytes never became true',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOriginFromBaseURL(baseURL), finish);

  await expect
    .poll(() => infoAlerts.last()?.kind, { timeout: DEFAULT_TIMEOUT_MS, message: 'no success dialog after Finish' })
    .toBe('success');

  expect(
    String(tx.attachment?.amountPerUnitTQT),
    `the confirmed transaction reserves ${tx.attachment?.amountPerUnitTQT} TQT per unit instead of ` +
    `${EXPECTED_PER_UNIT_TQT} — the amountTotal → amountPerUnitTQT scaling in getAndVerifyAccount() is wrong`,
  ).toBe(EXPECTED_PER_UNIT_TQT);
  expect(String(tx.feeTQT), 'the mask hardcodes a 1 XIN fee').toBe(String(FEE_TQT));

  const after = await apiJson(request, { requestType: 'getCurrency', currency: currencyId });
  expect(
    String(after.currentReservePerUnitTQT),
    `getCurrency reports ${after.currentReservePerUnitTQT} TQT per unit after the subscription instead of ` +
    `${EXPECTED_PER_UNIT_TQT} — the campaign did not receive what the form said it would`,
  ).toBe(EXPECTED_PER_UNIT_TQT);

  const founders: any[] = (await apiJson(request, { requestType: 'getCurrencyFounders', currency: currencyId })).founders ?? [];
  const mine = founders.filter((f) => f.accountRS === TEST_ACCOUNT_1_RS);
  expect(
    mine.length,
    `${TEST_ACCOUNT_1_RS} is not listed among the founders of ${campaignCode} — the reserve was booked for ` +
    'another account, or getCurrencyFounders no longer reports it',
  ).toBe(1);
  expect(String(mine[0].amountPerUnitTQT), 'the founder entry carries a different amount than the transaction').toBe(
    EXPECTED_PER_UNIT_TQT,
  );

  const spent = balanceBefore - (await balanceOf(request));
  expect(
    spent,
    `the account was debited ${spent} TQT — the node charges reserveSupply × amountPerUnitTQT plus the fee, ` +
    `so ${RESERVE_SUPPLY} × ${EXPECTED_PER_UNIT_TQT} + ${FEE_TQT} was expected`,
  ).toBe(BigInt(RESERVE_SUPPLY) * BigInt(EXPECTED_PER_UNIT_TQT) + BigInt(FEE_TQT));

  // goBack() from the success dialog already re-mounted the list, pre-confirmation.
  await page.goto('#/wallet/crowdfunding/show-campaigns/all');
  await page.locator('.card-header a:has(i.fa-refresh)').first().click();
  await expect(
    row.locator('datatable-body-cell').nth(5),
    'the Raised column does not show the subscribed total — the cell renders ' +
    '`currentReservePerUnitTQT * reserveSupply | amountTqt`, so a scaling regression shows up here first',
  ).toHaveText('100.00', { timeout: DEFAULT_TIMEOUT_MS });
});

test(
  'reserve-units: a total that is not a whole multiple of the reserve supply books the exact TQT per unit',
  async ({ page, request, baseURL }) => {
    await page.goto('#/wallet/crowdfunding/show-campaigns/all');
    const row = page.locator('datatable-body-row').filter({ has: page.getByText(campaignCode, { exact: true }) });
    await row.locator('a:has(i.fa-bus)').click();

    await page.locator('input[name="amountTotal"]').fill('115');
    await expect(page.locator('input[name="amountUnit"]')).toHaveValue('1.15');
    await page.locator('button.btn-primary:has(i.fa-chevron-right)').first().click();

    const finish = page.locator('button:has(i.fa-check)').first();
    await expect(finish).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOriginFromBaseURL(baseURL), finish);
    expect(String(tx.attachment?.amountPerUnitTQT), '1.15 XIN per unit must book exactly 115000000 TQT').toBe('115000000');
  },
);
