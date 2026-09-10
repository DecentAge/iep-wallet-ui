import { test, expect } from '../../../fixtures/test';
import { request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_ID, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';
import { createShufflingViaApi, SeededShuffling } from '../../../helpers/create-shuffling';

/**
 * start-shuffling / stop-shuffling (`#/wallet/shuffling/show-shufflings/...`).
 *
 * Risk covered: both masks send the account's passphrase to the node to run a
 * *node-local* shuffler (`startShuffler` / `stopShuffler`) — no chain
 * transaction, so nothing is signed in the browser and `broadcastAndAwaitConfirmation`
 * cannot see them. A migration that breaks the double-`subscribe` chain in these
 * components, the `?id=` → `shufflingFullHash` hand-off, or the `isLocal` gate
 * fails silently: the wizard still shows its success dialog. Evidence is therefore
 * `getShufflers` for the effect and `getShuffling` for the shuffling being left
 * untouched on chain.
 */

const SHUFFLER_FEE_TQT = '100000000';

let apiCtx: APIRequestContext;
let apiBase: string;
let seeded: SeededShuffling;
let recipient: { publicKey: string; accountRS: string };

test.beforeAll(async ({ baseURL }) => {
  apiCtx = await pwRequest.newContext();
  apiBase = `${apiOriginFromBaseURL(baseURL)}/api`;
  seeded = await createShufflingViaApi(apiCtx, apiBase);

  // startShuffler refuses a recipient that already exists on chain.
  const marker = `e2e-shuffler-recipient-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const resp = await apiCtx.get(apiBase, {
    params: { requestType: 'getAccountId', secretPhrase: marker },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const json = await resp.json();
  expect(json.publicKey, `getAccountId did not derive a recipient key for "${marker}"`).toBeTruthy();
  recipient = { publicKey: json.publicKey, accountRS: json.accountRS };
});

test.afterAll(async () => {
  // A shuffler outlives the browser session and keeps signing.
  await stopShufflerViaApi();
  await apiCtx?.dispose();
});

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

async function startShufflerViaApi(): Promise<void> {
  await apiCtx.post(apiBase, {
    form: {
      requestType: 'startShuffler',
      shufflingFullHash: seeded.fullHash,
      recipientPublicKey: recipient.publicKey,
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      feeTQT: SHUFFLER_FEE_TQT,
      deadline: '60',
      broadcast: 'false',
    },
  });
}

async function stopShufflerViaApi(): Promise<void> {
  await apiCtx.post(apiBase, {
    form: {
      requestType: 'stopShuffler',
      shufflingFullHash: seeded.fullHash,
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      feeTQT: SHUFFLER_FEE_TQT,
      deadline: '60',
      broadcast: 'false',
    },
  });
}

/** The shufflers the node runs for this account on the seeded shuffling only. */
async function fetchShufflers(request: APIRequestContext): Promise<any[]> {
  const resp = await request.get(apiBase, {
    params: {
      requestType: 'getShufflers',
      account: TEST_ACCOUNT_1_ID,
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      includeParticipantState: true,
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(resp.ok(), `getShufflers failed with HTTP ${resp.status()}`).toBe(true);
  const json = await resp.json();
  expect(json.errorCode, `getShufflers returned an error: ${JSON.stringify(json)}`).toBeUndefined();
  return (json.shufflers ?? []).filter((s: any) => s.shufflingFullHash === seeded.fullHash);
}

async function fetchShuffling(request: APIRequestContext): Promise<any> {
  const resp = await request.get(apiBase, {
    params: { requestType: 'getShuffling', shuffling: seeded.shufflingId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const json = await resp.json();
  expect(json.errorCode, `getShuffling returned an error: ${JSON.stringify(json)}`).toBeUndefined();
  return json;
}

test('start-shuffling: the form starts a node shuffler and leaves the shuffling untouched on chain', async ({ page, request, infoAlerts }) => {
  await stopShufflerViaApi(); // retry-safe: the node keeps one shuffler per (account, shuffling)
  expect(
    await fetchShufflers(request),
    `a shuffler for ${seeded.fullHash} was still running before the test started — stopShuffler did not clear it`,
  ).toEqual([]);

  const before = await fetchShuffling(request);
  expect(Number(before.stage), 'the seeded shuffling must still be in REGISTRATION (0) when the test starts').toBe(0);

  await page.goto(`#/wallet/shuffling/show-shufflings/start-shuffling?id=${seeded.fullHash}`);

  const recipientKey = page.locator('input[name="recipientPublickey"]');
  const start = page.locator('button.btn-primary:has(i.fa-play)');
  await expect(recipientKey, 'start-shuffling form did not mount — the ?id= query param never resolved').toBeVisible({
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await expect(
    start,
    'Start must stay disabled while the required recipient public key is empty — the `f.invalid` gate is broken',
  ).toBeDisabled();

  await recipientKey.fill(recipient.publicKey);
  await recipientKey.blur();
  await expect(
    start,
    'Start stayed disabled with a valid recipient key — either the required validator or `isLocal` ' +
    '(NodeService.isLocalNode(), true on devnet) regressed, and the mask becomes unusable',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const posted = page.waitForRequest(
    (r) =>
      r.url().endsWith('/api') &&
      r.method() === 'POST' &&
      (r.postData() ?? '').includes('requestType=startShuffler'),
    { timeout: DEFAULT_TIMEOUT_MS * 2 },
  );
  await start.click();
  const body = (await posted).postData() ?? '';
  expect(
    body.includes(`shufflingFullHash=${seeded.fullHash}`),
    `startShuffler was sent without the shuffling from the ?id= param — body was "${body.replace(/secretPhrase=[^&]*/, 'secretPhrase=***')}"`,
  ).toBe(true);
  expect(
    body.includes(`recipientPublicKey=${recipient.publicKey}`),
    'startShuffler was sent without the recipient public key typed into the form — the shuffled coins ' +
    'would go to whatever the node defaults to',
  ).toBe(true);

  await expect
    .poll(() => infoAlerts.last()?.kind, {
      timeout: DEFAULT_TIMEOUT_MS * 2,
      message: 'no success dialog after Start — startShuffle() swallowed the nested subscribe',
    })
    .toBe('success');
  await expect(
    page,
    'the wallet did not return to the My-shufflings list after starting the shuffler',
  ).toHaveURL(/show-shufflings\/my$/, { timeout: DEFAULT_TIMEOUT_MS });

  const shufflers = await fetchShufflers(request);
  expect(
    shufflers.length,
    `the node runs no shuffler for ${seeded.fullHash} after the form reported success — startShuffler ` +
    'was never sent, or the node rejected it and the component reported success anyway',
  ).toBe(1);
  expect(
    shufflers[0].accountRS,
    'the shuffler runs for a different account than the logged-in one',
  ).toBe(TEST_ACCOUNT_1_RS);
  expect(
    shufflers[0].recipientRS,
    `the shuffler pays out to ${shufflers[0].recipientRS} instead of the account behind the public key ` +
    'entered in the form — the recipientPublicKey field is mis-wired',
  ).toBe(recipient.accountRS);
  expect(Number(shufflers[0].participantState), 'a freshly started shuffler must be in participant state REGISTERED (0)').toBe(0);

  const after = await fetchShuffling(request);
  expect(
    Number(after.stage),
    'the shuffling left REGISTRATION — startShuffler is a node-local operation and must not move the ' +
    'shuffling on chain',
  ).toBe(0);
  expect(
    Number(after.registrantCount),
    'the registrant count changed — the form broadcast a shufflingRegister instead of (or on top of) ' +
    'the node-local startShuffler',
  ).toBe(Number(before.registrantCount));
});

test('stop-shuffling: the form stops the running shuffler', async ({ page, request, infoAlerts }) => {
  await startShufflerViaApi(); // retry-safe: no-op when the previous test already started one
  expect(
    (await fetchShufflers(request)).length,
    `no shuffler is running for ${seeded.fullHash}, so there is nothing for stop-shuffling to stop`,
  ).toBe(1);

  await page.goto(`#/wallet/shuffling/show-shufflings/stop-shuffling?id=${seeded.fullHash}`);

  const stop = page.locator('button.btn-primary:has(i.fa-stop)');
  await expect(
    page.locator('h6', { hasText: seeded.fullHash }),
    'stop-shuffling does not display the shuffling from the ?id= query param — the hand-off from the ' +
    'list is broken and the form would stop whatever the node picks',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(stop, 'Stop is disabled although the form has no required input').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const posted = page.waitForRequest(
    (r) =>
      r.url().endsWith('/api') &&
      r.method() === 'POST' &&
      (r.postData() ?? '').includes('requestType=stopShuffler'),
    { timeout: DEFAULT_TIMEOUT_MS * 2 },
  );
  await stop.click();
  const body = (await posted).postData() ?? '';
  expect(
    body.includes(`shufflingFullHash=${seeded.fullHash}`),
    'stopShuffler was sent without the shuffling from the ?id= param — it would stop an unrelated shuffler',
  ).toBe(true);

  await expect
    .poll(() => infoAlerts.last()?.kind, {
      timeout: DEFAULT_TIMEOUT_MS * 2,
      message: 'no success dialog after Stop — stopShuffle() swallowed the nested subscribe',
    })
    .toBe('success');
  await expect(
    page,
    'the wallet did not return to the My-shufflings list after stopping the shuffler',
  ).toHaveURL(/show-shufflings\/my$/, { timeout: DEFAULT_TIMEOUT_MS });

  expect(
    await fetchShufflers(request),
    `the node still runs a shuffler for ${seeded.fullHash} after the form reported success — the ` +
    'shuffler keeps signing with the stored passphrase',
  ).toEqual([]);

  const after = await fetchShuffling(request);
  expect(
    Number(after.stage),
    'the shuffling left REGISTRATION — stopShuffler is node-local and must not move it on chain',
  ).toBe(0);
});

test(
  'show-shufflings: the My tab start/stop actions reflect whether a shuffler runs',
  async ({ page, request }) => {
    await stopShufflerViaApi();
    await page.goto('#/wallet/shuffling/show-shufflings/my');

    const amount = (Number(seeded.amountTQT) / 1e8).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const row = page.locator('datatable-body-row').filter({ has: page.getByText(amount, { exact: true }) });
    const play = row.locator('a:has(i.fa-play)');
    const stop = row.locator('a:has(i.fa-stop)');

    await expect(play, 'with no shuffler running the start action must be clickable for the issuer').not.toHaveClass(/disabled/);
    await expect(stop, 'with no shuffler running there is nothing to stop').toHaveClass(/disabled/);

    await startShufflerViaApi();
    expect((await fetchShufflers(request)).length).toBe(1);
    await page.locator('.card-header a:has(i.fa-refresh)').first().click();

    await expect(play, 'a second shuffler cannot be started for the same shuffling').toHaveClass(/disabled/);
    await expect(stop, 'the running shuffler must be stoppable from the list').not.toHaveClass(/disabled/);
  },
);
