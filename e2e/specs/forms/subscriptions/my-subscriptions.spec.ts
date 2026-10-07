import { test, expect } from '../../../fixtures/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_ID,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

// Opts out of the shared alert auto-dismissal: this spec asserts the cancel dialog before confirming,
// so a handler that closes it first would race the assertion.
test.use({ autoDismissAlerts: false });

/**
 * My Subscriptions (`#/wallet/subscriptions/my-subscriptions`) — the other half
 * of create-subscription.spec.ts: a recurring payment is only useful if the
 * owner can find it again and stop it.
 *
 * The full lifecycle test walks create → list → cancel, and pins the two links
 * that a datatable regression breaks silently:
 *   - the row must carry the *subscription id*, which only becomes visible when
 *     the cancel action hands it to the cancel view as a query param
 *   - cancelling must reach the chain (type 21 / subtype 4, SubscriptionCancel)
 *     so `getSubscription` stops resolving the id
 *
 * Each run cancels the subscription it created, so it leaves the devnet as it
 * found it and stays inside the datatable's first page.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('my-subscriptions: a created subscription is listed, and cancelling it from the list removes it on chain', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  // Whole days keep the interval column exact (frequency / 86400, 4 decimals),
  // and a random one makes the row identifiable among older test leftovers.
  const days = 100 + Math.floor(Math.random() * 200);

  await page.goto('#/wallet/subscriptions/create-subscription');
  const recipient = page.locator('input[name="recipient"]');
  await expect(recipient, 'create-subscription form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await recipient.fill(TEST_ACCOUNT_2_RS);
  await page.locator('input[name="amount"]').fill('1');
  const interval = page.locator('input[name="interval"]');
  await interval.fill(String(days));
  await interval.blur();

  const next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await expect(next, 'Next did not enable for a valid subscription form').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await next.click();

  const finish = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(finish, 'Finish did not enable — SUBSCRIPTION_CREATION signing failed').toBeEnabled({
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const { txId: subscriptionId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finish);

  const created = await (
    await request.get(`${apiOrigin}/api`, {
      params: { requestType: 'getSubscription', subscription: subscriptionId },
      timeout: DEFAULT_TIMEOUT_MS,
    })
  ).json();
  expect(
    created.errorCode,
    `getSubscription did not resolve the new subscription ${subscriptionId}: ${JSON.stringify(created)}`,
  ).toBeUndefined();
  expect(Number(created.frequency), 'chain stored a different interval than the form sent').toBe(days * 86400);

  // Dismissing the success alert is what navigates the wizard onwards.
  const swalOk = page.locator('.swal2-confirm');
  await expect(swalOk, 'broadcast success alert did not appear').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await swalOk.click();
  await page.waitForURL(/\/subscriptions\/my-subscriptions$/, { timeout: DEFAULT_TIMEOUT_MS });

  // The datatable pages 10 rows at a time; if older runs piled up, say so
  // instead of failing on a "missing" row that is simply on page 2.
  const accountSubs = (
    await (
      await request.get(`${apiOrigin}/api`, {
        params: { requestType: 'getAccountSubscriptions', account: TEST_ACCOUNT_1_ID },
        timeout: DEFAULT_TIMEOUT_MS,
      })
    ).json()
  ).subscriptions as Array<{ id: string }>;
  const position = (accountSubs ?? []).findIndex((s) => s.id === subscriptionId);
  expect(
    position,
    `getAccountSubscriptions does not list ${subscriptionId} for TEST_ACCOUNT_1 — ` +
    'the subscription was created but is not attributed to the sender',
  ).toBeGreaterThanOrEqual(0);
  expect(
    position,
    `the new subscription sits at position ${position}, i.e. page ${Math.floor(position / 10) + 1} of the ` +
    'datatable — TEST_ACCOUNT_1 has accumulated uncancelled subscriptions on this devnet; cancel the stale ' +
    'ones or teach this test to page the footer',
  ).toBeLessThan(10);

  const myRow = page
    .locator('datatable-body-row')
    .filter({ has: page.locator('datatable-body-cell', { hasText: new RegExp(`^\\s*${days}\\.0000\\s*$`) }) })
    .filter({ hasText: TEST_ACCOUNT_2_RS });
  await expect(
    myRow,
    `no row shows the created subscription (interval ${days}.0000 days → ${TEST_ACCOUNT_2_RS}) — ` +
    'setPage() mapped the getAccountSubscriptions response into the wrong rows or the column props drifted',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    myRow.locator('datatable-body-cell').nth(2),
    'the amount column of the listed subscription does not show the 1 XIN that was entered',
  ).toHaveText(/^\s*1\.00\s*$/);

  await myRow.locator('a:has(i.fa-times)').click();
  await page.waitForURL(/cancel-subscription/, { timeout: DEFAULT_TIMEOUT_MS });
  expect(
    page.url(),
    'the cancel action did not pass the subscription id of the clicked row — ' +
    'cancelSubscription(row.id, row.recipientRS) is bound to the wrong row data',
  ).toContain(`id=${subscriptionId}`);
  await expect(
    page.locator('app-cancel-subscriptions h4').first(),
    'the cancel view does not show the subscription it is about to cancel',
  ).toHaveText(subscriptionId, { timeout: DEFAULT_TIMEOUT_MS });

  const cancelFinish = page.locator('app-cancel-subscriptions button.btn-primary:has(i.fa-check)');
  await expect(
    cancelFinish,
    'the cancel Finish button stayed disabled — subscriptionCancel never produced signable bytes',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  const { tx: cancelTx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, cancelFinish);

  expect(cancelTx.type, 'cancel tx has the wrong type — expected Advanced Payment (21)').toBe(21);
  expect(cancelTx.subtype, 'cancel tx has the wrong subtype — expected SubscriptionCancel (4)').toBe(4);
  expect(
    cancelTx.attachment?.subscriptionId,
    `cancel tx targets a different subscription: ${JSON.stringify(cancelTx.attachment)}`,
  ).toBe(subscriptionId);

  await expect
    .poll(
      async () => {
        const resp = await request.get(`${apiOrigin}/api`, {
          params: { requestType: 'getSubscription', subscription: subscriptionId },
          timeout: DEFAULT_TIMEOUT_MS,
        });
        return (await resp.json()).errorCode ?? null;
      },
      {
        message:
          `getSubscription still resolves ${subscriptionId} after the confirmed subscriptionCancel — ` +
          'the cancellation was accepted but never applied',
        timeout: 30_000,
      },
    )
    .not.toBeNull();

  await expect(page.locator('.swal2-confirm')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await page.locator('.swal2-confirm').click();
  await page.waitForURL(/\/subscriptions\/my-subscriptions$/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('app-my-subscriptions datatable-body-row').first(),
    'the list did not come back with any rows after cancelling — the older CASH subscription of ' +
    'TEST_ACCOUNT_1 must still be there, so an empty table means the list itself broke',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    myRow,
    'the cancelled subscription is still listed after returning to the list',
  ).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS });
});

test('my-subscriptions: the list renders its translated column headers and the Create shortcut opens the wizard', async ({ page }) => {
  await page.goto('#/wallet/subscriptions/my-subscriptions');

  await expect(
    page.locator('app-my-subscriptions'),
    'my-subscriptions page did not mount',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h2.main-title').first()).toHaveText(/My Subscriptions/i, {
    timeout: DEFAULT_TIMEOUT_MS,
  });

  const headers = (await page.locator('.datatable-header-cell-label').allTextContents()).map((h) => h.trim());
  expect(
    headers,
    `my-subscriptions column headers drifted (got ${JSON.stringify(headers)}) — a renamed table-header.* key ` +
    'or a dropped ngx-datatable-column',
  ).toEqual(['Interval (D)', 'Next Payment', 'Amount', 'Recipient', 'Actions']);

  await page.locator('app-my-subscriptions .btn-create').first().click();
  await page.waitForURL(/create-subscription/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    page.locator('input[name="recipient"]'),
    'the Create shortcut did not open the create-subscription wizard',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});
