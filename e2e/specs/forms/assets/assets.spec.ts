import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Asset list + send-asset (`#/wallet/assets/`) — two distinct concerns:
 *
 * 1. List smoke: the ngx-datatable mounts and i18n loads correctly.
 * 2. Send-asset two-account flow: issues an asset in beforeAll (via direct
 *    API call), then drives the send-assets wizard from TEST_ACCOUNT_1 to
 *    TEST_ACCOUNT_2 and verifies the transfer on chain via getAccountAssets.
 *    This covers the send-assets form (3 required fields — assetId, shares,
 *    recipientRS) and the ASSET_TRANSFER subtype signing path.
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';

let issuedAssetId: string;
let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  // Issue an asset via direct API (server-side signing with secretPhrase —
  // allowed on devnet). Uses a timestamped name to avoid collisions across reruns.
  const assetName = `e2ea${Date.now().toString(36)}`.slice(0, 10);
  const params = new URLSearchParams({
    requestType: 'issueAsset',
    name: assetName,
    description: 'e2e test asset for send-assets spec — do not use in prod',
    quantityQNT: '1000',
    decimals: '0',
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: '100000000',
    deadline: '80',
    broadcast: 'true',
  });
  const resp = await apiCtx.post(API_BASE, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: params.toString(),
  });
  const created = await resp.json();
  if (!created.transaction || created.broadcasted !== true) {
    throw new Error(`issueAsset failed in beforeAll: ${JSON.stringify(created)}`);
  }
  issuedAssetId = created.transaction;

  // Wait for the issue tx to confirm so the wallet's sendAsset call can look
  // it up via getAsset — the form validates the asset exists before signing.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const txResp = await apiCtx.get(`${API_BASE}?requestType=getTransaction&transaction=${issuedAssetId}`);
    const tx = await txResp.json();
    if (tx.block && typeof tx.confirmations === 'number') return;
    await new Promise(r => setTimeout(r, 1_000));
  }
  throw new Error(`issueAsset tx ${issuedAssetId} did not confirm within 60s — devnet forging stalled?`);
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

test('assets: datatable mounts on show-assets/all', async ({ page }) => {
  // The AssetsComponent (with ngx-datatable) is nested under show-assets.
  await page.goto('#/wallet/assets/show-assets/all');

  const datatable = page.locator('ngx-datatable').first();
  await expect(datatable).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The tab strip on the parent show-assets renders "All" + "My" tabs.
  const allTab = page.locator('a.nav-link', { hasText: /^All$/i }).first();
  await expect(allTab).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('assets: page title renders i18n-translated label', async ({ page }) => {
  // Catches translation-bundle regressions: if i18n loads broke, the title
  // would show the bare key like "assets.show.all-table-title".
  await page.goto('#/wallet/assets/show-assets/all');
  const title = page.locator('h3.card-title').first();
  await expect(title).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const text = (await title.textContent())?.trim() ?? '';
  expect(
    text.includes('.'),
    `card title looks like an untranslated i18n key ("${text}") — ` +
    `the @ngx-translate bundle may have failed to load`,
  ).toBe(false);
});

test('assets: send-assets wizard transfers shares to TEST_ACCOUNT_2 and getAccountAssets confirms receipt', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/assets/send-assets');

  const assetIdInput = page.locator('input[name="assetId"]');
  const sharesInput  = page.locator('input[name="shares"]');
  const recipientInput = page.locator('input[name="recipientRS"]');
  const nextButton   = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(assetIdInput, 'send-assets form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton).toBeDisabled();

  await assetIdInput.fill(issuedAssetId);
  await sharesInput.fill('10');
  await recipientInput.fill(TEST_ACCOUNT_2_RS);
  await recipientInput.blur();

  await expect(
    nextButton,
    'Next did not enable after assetId + shares + recipientRS filled — ' +
    'one of the three required validators may have regressed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await nextButton.click();   // calls sendAsset() → signs ASSET_TRANSFER attachment

  // Step 2: Finish enables when validBytes === true (signing completed).
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — ASSET_TRANSFER signing failed (asset ID lookup or crypto path)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // Chain-side: type=2 (Asset Exchange), subtype=1 (ASSET_TRANSFER)
  expect(tx.type, 'confirmed tx wrong type — expected Asset Exchange (2)').toBe(2);
  expect(tx.subtype, 'confirmed tx wrong subtype — expected ASSET_TRANSFER (1)').toBe(1);
  expect(tx.recipientRS, 'transfer recipient on chain does not match TEST_ACCOUNT_2').toBe(TEST_ACCOUNT_2_RS);

  // Verify TEST_ACCOUNT_2 now holds shares of the issued asset.
  const assetsResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAccountAssets', account: TEST_ACCOUNT_2_RS, asset: issuedAssetId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(assetsResp.ok()).toBe(true);
  const accountAssets = await assetsResp.json();
  expect(
    accountAssets.errorCode,
    `getAccountAssets returned an error after transfer (tx ${txId}): ${JSON.stringify(accountAssets)}`,
  ).toBeUndefined();
  expect(
    Number(accountAssets.quantityQNT ?? 0),
    `TEST_ACCOUNT_2 does not hold any shares of asset ${issuedAssetId} after transfer`,
  ).toBeGreaterThanOrEqual(10);
});
