import { test, expect } from '../../../fixtures/test';
import { request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_ID, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';
import { awaitConfirmation } from '../../../helpers/create-shuffling';

/**
 * delete-property (`#/wallet/account/properties/delete-property`).
 *
 * Risk covered: the mask has no form of its own — it takes account, property and
 * `mode` from the query string the my-properties row hands it, and signs the
 * deletion straight from `ngOnInit`. `deleteProperty()` swaps recipient and
 * setter depending on `mode`, so a wrong hand-off produces a perfectly valid
 * transaction that deletes nothing (or someone else's property) while the wallet
 * still reports success. getAccountProperties is the only proof.
 */

const FEE_TQT = '100000000';

let apiCtx: APIRequestContext;
let apiBase: string;
let propertyKey: string;
let propertyValue: string;

test.beforeAll(async ({ baseURL }) => {
  apiCtx = await pwRequest.newContext();
  apiBase = `${apiOriginFromBaseURL(baseURL)}/api`;

  propertyKey = `e2e-del-${Date.now().toString(36)}`;
  propertyValue = `v-${Math.random().toString(36).slice(2, 8)}`;

  const resp = await apiCtx.post(apiBase, {
    form: {
      requestType: 'setAccountProperty',
      recipient: TEST_ACCOUNT_1_ID,
      property: propertyKey,
      value: propertyValue,
      feeTQT: FEE_TQT,
      deadline: '60',
      broadcast: 'true',
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    },
  });
  const json = await resp.json();
  expect(json.transaction, `seeding setAccountProperty failed: ${JSON.stringify(json)}`).toBeTruthy();
  await awaitConfirmation(apiCtx, apiBase, json.transaction);
});

test.afterAll(async () => {
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

async function fetchProperty(request: APIRequestContext): Promise<any[]> {
  const resp = await request.get(apiBase, {
    params: { requestType: 'getAccountProperties', recipient: TEST_ACCOUNT_1_ID, property: propertyKey },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const json = await resp.json();
  expect(json.errorCode, `getAccountProperties returned an error: ${JSON.stringify(json)}`).toBeUndefined();
  return json.properties ?? [];
}

test('delete-property: removing a property from my-properties makes it vanish from getAccountProperties', async ({ page, request, baseURL, infoAlerts }) => {
  expect(
    (await fetchProperty(request)).length,
    `the seeded property "${propertyKey}" is not on the chain — the beforeAll setAccountProperty did not stick`,
  ).toBe(1);

  await page.goto('#/wallet/account/properties/my-properties');
  const row = page
    .locator('datatable-body-row')
    .filter({ has: page.getByText(propertyKey, { exact: true }) });
  await expect(
    row,
    `the seeded property "${propertyKey}" is not listed on the first page of my-properties — the table pages ` +
    'ten rows server-side with no way back, so either the list is not rendering getAccountProperties or ' +
    'this account has collected more than ten properties and needs cleaning up',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    row.locator('datatable-body-cell').nth(2),
    'the value column does not show what was set on chain',
  ).toHaveText(propertyValue);

  await row.locator('a.btn-outline-danger').click();
  await expect(
    page,
    'the delete action did not hand over setter, property and mode — goToDeleteProperty() passes the wrong ' +
    'row fields, and delete-property would sign a deletion for a different property',
  ).toHaveURL(
    new RegExp(`delete-property\\?id=${TEST_ACCOUNT_1_RS}&property=${propertyKey}&mode=1$`),
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  await expect(
    page.locator('h4', { hasText: propertyKey }),
    'the confirm step does not name the property being deleted',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h4', { hasText: TEST_ACCOUNT_1_RS }), 'the confirm step does not name the account').toBeVisible();

  const finish = page.locator('button:has(i.fa-check)').first();
  await expect(
    finish,
    'Finish stayed disabled — deleteAccountProperty was never signed in ngOnInit, so validBytes stayed false',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOriginFromBaseURL(baseURL), finish);
  await expect
    .poll(() => infoAlerts.last()?.kind, { timeout: DEFAULT_TIMEOUT_MS, message: 'no success dialog after Finish' })
    .toBe('success');

  expect(tx.senderRS, 'the deletion was signed by a different account than the logged-in one').toBe(TEST_ACCOUNT_1_RS);
  expect(String(tx.feeTQT), 'the mask hardcodes a 1 XIN fee').toBe(FEE_TQT);

  await expect
    .poll(async () => (await fetchProperty(request)).length, {
      timeout: DEFAULT_TIMEOUT_MS,
      message:
        `"${propertyKey}" is still set on ${TEST_ACCOUNT_1_RS} after a confirmed deleteAccountProperty — the ` +
        'mode-1 recipient/setter swap in deleteProperty() sent the deletion for another pair of accounts',
    })
    .toBe(0);
});
