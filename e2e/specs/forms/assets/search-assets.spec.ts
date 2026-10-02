import { test, expect } from '../../../fixtures/test';
import { Page, Locator } from '@playwright/test';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { NodeApi, collectErrors, expectNoErrors, login, randomToken } from '../../../helpers/asset-fixtures';

/**
 * Search Assets (`#/wallet/assets/search-assets`).
 *
 * The node hands `searchAssets&query=` straight to Lucene, and Lucene matches
 * whole words only: "DAOAPJM" finds the asset, "DAOA" finds nothing. The mask
 * searches on every keystroke, so to a user typing a name the search looked
 * dead until the last letter. Stray syntax characters ("*", "a b:") came back
 * as an error object without `assets`, and the asset id — the one handle people
 * actually copy around — was not searchable at all.
 *
 * The mask now sends every word as a prefix query, looks a purely numeric input
 * up as an asset id as well, and treats an error from the node as "no hits".
 * The last test pins that degraded case against the error a node with an
 * unreadable Lucene index returns (mainnet did, see iep-node CHANGELOG).
 */

let api: NodeApi;
let assetId: string;
/** 10 chars, letters and digits only: one Lucene token. */
let assetName: string;
/** Only in the description, so a hit on it proves the description is searched. */
let descriptionWord: string;

const searchInput = (page: Page): Locator => page.locator('app-search-assets input.input-search');
const rows = (page: Page): Locator => page.locator('app-search-assets datatable-body-row');
const fixtureRow = (page: Page): Locator => rows(page).filter({ hasText: assetName });

/** Type a query and return the Lucene query the mask sent for it. */
async function searchFor(page: Page, text: string): Promise<string | null> {
  const sent = page.waitForRequest((r) => r.url().includes('requestType=searchAssets'), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await searchInput(page).fill(text);
  return new URL((await sent).url()).searchParams.get('query');
}

test.beforeAll(async () => {
  api = await NodeApi.create();
  const token = randomToken();
  assetName = `srch${token}`.slice(0, 10);
  descriptionWord = `zq${token}`;

  assetId = await api.broadcast('issueAsset search fixture', TEST_ACCOUNT_1_PASSPHRASE, {
    requestType: 'issueAsset',
    name: assetName,
    description: `e2e search fixture ${descriptionWord} devnet only`,
    quantityQNT: '100000',
    decimals: '2',
  });
  await api.awaitConfirmations([assetId], 'issueAsset search fixture');

  // The Lucene index is written when the block commits; make sure the node
  // itself finds the fixture before blaming the wallet.
  await api.until(`the node's fulltext index listing ${assetName}`, async () => {
    const found = await api.get({ requestType: 'searchAssets', query: assetName });
    return found.assets?.some((a: any) => a.asset === assetId) ? true : undefined;
  });
});

test.afterAll(async () => {
  await api?.dispose();
});

test.beforeEach(async ({ page }) => {
  await login(page, TEST_ACCOUNT_1_PASSPHRASE);
  await page.goto('#/wallet/assets/search-assets');
  await expect(searchInput(page), 'the Search Assets mask did not mount').toBeVisible({
    timeout: DEFAULT_TIMEOUT_MS,
  });
});

test('search-assets: the full asset name finds the asset with its issuer', async ({ page }) => {
  await searchFor(page, assetName);

  await expect(fixtureRow(page), `searching for "${assetName}" did not list the asset`).toHaveCount(1, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await expect(
    fixtureRow(page).locator('datatable-body-cell').nth(1),
    'the Issuer column does not show the account that issued the asset',
  ).toHaveText(TEST_ACCOUNT_1_RS);
});

test('search-assets: the first letters of a name are enough', async ({ page }) => {
  const prefix = assetName.slice(0, 7);
  const sentQuery = await searchFor(page, prefix);

  expect(
    sentQuery,
    'the mask sent the typed text as a whole-word Lucene query — "srch1ab" then only matches an asset ' +
    'named exactly that, and the search looks dead while the user is still typing',
  ).toBe(`${prefix}*`);
  await expect(
    fixtureRow(page),
    `the prefix "${prefix}" of "${assetName}" did not list the asset`,
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
});

test('search-assets: upper case finds a lower-case name', async ({ page }) => {
  await searchFor(page, assetName.slice(0, 8).toUpperCase());

  await expect(fixtureRow(page), 'the search is case-sensitive').toHaveCount(1, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
});

test('search-assets: a word from the description finds the asset', async ({ page }) => {
  await searchFor(page, descriptionWord.slice(0, 6));

  await expect(
    fixtureRow(page),
    `"${descriptionWord}" occurs only in the description of ${assetName} — the popover promises a search ` +
    'over name and description',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
});

test('search-assets: several words narrow the result down', async ({ page }) => {
  const sentQuery = await searchFor(page, `${assetName.slice(0, 6)}  ${descriptionWord}`);

  expect(sentQuery, 'each word must become its own prefix term').toBe(
    `${assetName.slice(0, 6)}* ${descriptionWord}*`,
  );
  await expect(fixtureRow(page)).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(rows(page), 'two terms that only this asset carries must leave exactly one row').toHaveCount(1);
});

test('search-assets: the asset id finds the asset', async ({ page }) => {
  const byId = page.waitForRequest(
    (r) => r.url().includes('requestType=getAsset&') && r.url().includes(`asset=${assetId}`),
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  await searchInput(page).fill(assetId);
  await byId;

  await expect(
    fixtureRow(page),
    `the asset id ${assetId} did not list ${assetName} — the id is not part of the fulltext index, so it ` +
    'needs its own getAsset lookup',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
});

test('search-assets: emptying the field empties the result', async ({ page }) => {
  await searchFor(page, assetName);
  await expect(fixtureRow(page)).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

  await searchInput(page).fill('');

  await expect(rows(page), 'the hits of the previous search stayed on screen under an empty field').toHaveCount(0, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
});

test('search-assets: Lucene syntax characters neither break the search nor reach the node', async ({ page }) => {
  const errors = collectErrors(page);

  // Characters only: nothing left to search for, so no request and no hits.
  let searchRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('requestType=searchAssets')) searchRequests++;
  });
  await searchInput(page).fill('*');
  await page.waitForTimeout(1_000);
  expect(searchRequests, '"*" alone is not a search term and must not be sent to Lucene').toBe(0);
  await expect(rows(page)).toHaveCount(0);

  // Wrapped in syntax, the word itself still has to be found.
  const sentQuery = await searchFor(page, `("${assetName}"): `);
  expect(sentQuery, 'syntax characters must be stripped from the query, not sent to Lucene').toBe(`${assetName}*`);
  await expect(fixtureRow(page)).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

  expectNoErrors(errors, 'search-assets');
});

test('search-assets: the three row actions open issuer, asset and trade desk of the row', async ({ page }) => {
  // Issuer link.
  await searchFor(page, assetName);
  await expect(fixtureRow(page)).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
  await fixtureRow(page).locator('a.hyperlink', { hasText: TEST_ACCOUNT_1_RS }).click();
  await page.waitForURL(/#\/wallet\/assets\/search-assets\/account-details\?id=XIN-/, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await expect(
    page.locator('app-account-detail h4').first(),
    'account-details did not open on the issuer of the row',
  ).toContainText(TEST_ACCOUNT_1_RS, { timeout: DEFAULT_TIMEOUT_MS });

  // Details action.
  await page.goto('#/wallet/assets/search-assets');
  await searchFor(page, assetName);
  await fixtureRow(page).locator('a:has(i.fa-info-circle)').click();
  await page.waitForURL(/#\/wallet\/assets\/search-assets\/asset-details\?id=\d+$/, {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(page.url(), 'asset-details was opened for a different asset than the row').toContain(`id=${assetId}`);
  await expect(page.locator('app-asset-details h4').first()).toHaveText(assetName, {
    timeout: DEFAULT_TIMEOUT_MS,
  });

  // Trade desk action.
  await page.goto('#/wallet/assets/search-assets');
  await searchFor(page, assetName);
  await fixtureRow(page).locator('a:has(i.fa-bar-chart)').click();
  await page.waitForURL(new RegExp(`#/wallet/assets/trade/${assetId}$`), { timeout: DEFAULT_TIMEOUT_MS });
});

test('search-assets: a node whose fulltext index is broken still finds an asset by id', async ({ page }) => {
  const errors = collectErrors(page);

  // What a node answers when it cannot read its Lucene index: HTTP 200, an
  // error object, no `assets`.
  await page.route(/requestType=searchAssets/, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        errorDescription:
          'org.h2.jdbc.JdbcSQLNonTransientException: Exception calling user-defined function: ' +
          '"search(...): Could not load codec \'Lucene87\'. Did you forget to add lucene-backward-codecs.jar?"',
        errorCode: 4,
      }),
    }),
  );

  await searchFor(page, assetName);
  await expect(rows(page), 'an error object from the node must render as "no hits"').toHaveCount(0);

  await searchInput(page).fill(assetId);
  await expect(
    fixtureRow(page),
    'the id lookup does not depend on the fulltext index and must still find the asset',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

  expectNoErrors(errors, 'search-assets with a failing searchAssets');
});
