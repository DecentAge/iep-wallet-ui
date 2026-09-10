import { test, expect, request as pwRequest, APIRequestContext, Locator, Page } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_1_ID,
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';
import {
  createShufflingViaApi,
  registerForShufflingViaApi,
  SeededShuffling,
} from '../../../helpers/create-shuffling';

/**
 * Shuffling module (`#/wallet/shuffling/*`) — create a shuffling, list it,
 * inspect it, join it.
 *
 * Two devnet realities shape this spec:
 *
 * 1. Joining needs a second account: `canRegisterEnabled()` disables the join
 *    action for the issuer, and a second logged-in session is out of scope. The
 *    join is broadcast through the node API; what gets asserted is how the
 *    wallet renders it.
 * 2. `ShufflingsComponent.setPage()` assigns `page.totalElements` only in the MY
 *    branch, so the All tab's pager never works and only the first ten rows of
 *    `getAllShufflings` (ordered by `blocks_remaining ASC`) are reachable. Since
 *    blocks_remaining decays, anything still running from an earlier run sorts
 *    ahead of a fresh shuffling — so the seeded one is given a window that
 *    undercuts every window currently on the chain, landing it at position 0.
 *
 * Every read-side assertion compares the DOM against a getShuffling /
 * getAllShufflings / getShufflingParticipants response fetched in the same test.
 * The seeded shuffling is located by its per-run unique amount, never by row
 * index — earlier runs leave behind rows that are identical in every other field.
 */

const HOLDING_TYPE_XIN = 'XIN';
const STAGE_REGISTRATION = 'Registration';

let apiCtx: APIRequestContext;
let apiBase: string;
let seeded: SeededShuffling;

test.beforeAll(async ({ baseURL }) => {
  apiCtx = await pwRequest.newContext();
  apiBase = `${apiOriginFromBaseURL(baseURL)}/api`;
  seeded = await createShufflingViaApi(apiCtx, apiBase);
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

/** Formats a TQT amount the way the `amountTqt` and `quantToAmount|numberString` pipes do. */
function formatAmount(tqt: string | number): string {
  return (Number(tqt) / 1e8).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function apiJson(request: APIRequestContext, params: Record<string, string | boolean>): Promise<any> {
  const resp = await request.get(apiBase, { params, timeout: DEFAULT_TIMEOUT_MS });
  expect(resp.ok(), `${params.requestType} request failed with HTTP ${resp.status()}`).toBe(true);
  const json = await resp.json();
  expect(
    json.errorCode,
    `${params.requestType} returned an error: ${JSON.stringify(json)}`,
  ).toBeUndefined();
  return json;
}

/** Same query the All tab issues (first page, active shufflings only). */
async function fetchAllShufflings(request: APIRequestContext): Promise<any[]> {
  const json = await apiJson(request, {
    requestType: 'getAllShufflings',
    firstIndex: '0',
    lastIndex: '9',
    includeFinished: false,
    includeHoldingInfo: true,
  });
  return json.shufflings ?? [];
}

/** Same query the My tab issues. */
async function fetchAccountShufflings(request: APIRequestContext): Promise<any[]> {
  const json = await apiJson(request, {
    requestType: 'getAccountShufflings',
    account: TEST_ACCOUNT_1_ID,
    firstIndex: '0',
    lastIndex: '9',
    includeFinished: false,
    includeHoldingInfo: true,
  });
  return json.shufflings ?? [];
}

async function fetchShuffling(request: APIRequestContext): Promise<any> {
  return apiJson(request, {
    requestType: 'getShuffling',
    shuffling: seeded.shufflingId,
    includeHoldingInfo: true,
  });
}

async function fetchParticipants(request: APIRequestContext): Promise<any[]> {
  const json = await apiJson(request, {
    requestType: 'getShufflingParticipants',
    shuffling: seeded.shufflingId,
  });
  return json.participants ?? [];
}

/**
 * The seeded shuffling's row in a shufflings datatable, matched on the amount
 * cell — the only field that distinguishes it from the rows earlier runs left
 * on the chain.
 */
function seededRow(page: Page): Locator {
  return page
    .locator('datatable-body-row')
    .filter({ has: page.getByText(formatAmount(seeded.amountTQT), { exact: true }) });
}

/** Fails when the seeded shuffling has dropped off the single page the tab renders. */
function expectSeededListed(shufflings: any[], listName: string): void {
  expect(
    shufflings.map((s) => s.shuffling),
    `seeded shuffling ${seeded.shufflingId} is not among the first 10 rows of ${listName} — ` +
    `it was seeded with a ${seeded.registrationPeriod}-block window to undercut everything already running, ` +
    'so ten or more shufflings must still be expiring sooner than that (the window has a floor so the ' +
    'shuffling survives the run). Wait a few minutes for them to expire, or re-bootstrap the devnet.',
  ).toContain(seeded.shufflingId);
}

/**
 * Asserts the datatable renders exactly one row per API entry. The component
 * fetches once on load, so a shuffling expiring in between would leave the two
 * out of step — hence the reload button in the retry loop.
 */
async function expectRowCountToMatchApi(
  rows: Locator,
  fetchRows: () => Promise<any[]>,
  what: string,
  refresh?: Locator,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const [domCount, apiRows] = await Promise.all([rows.count(), fetchRows()]);
        if (domCount === apiRows.length) return 'match';
        if (refresh) await refresh.first().click();
        return `${domCount} row(s) rendered vs ${apiRows.length} returned by the API`;
      },
      { timeout: DEFAULT_TIMEOUT_MS, message: what },
    )
    .toBe('match');
}

test('create-shuffling: step-1 validators gate Next on participant count, amount and finish height', async ({ page }) => {
  await page.goto('#/wallet/shuffling/create-shuffling');

  const amount = page.locator('input[name="amount"]');
  await expect(amount, 'create-shuffling step-1 form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const participantCount = page.locator('input[name="participantCount"]');
  const finishHeight = page.locator('input[name="finishHeight"]');
  const next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  const errorFor = (text: RegExp) => page.locator('.input-error', { hasText: text });

  await expect(amount, 'amount must default to the 1000 XIN chain minimum').toHaveValue('1000');
  await expect(finishHeight, 'registration window must default to 1440 blocks').toHaveValue('1440');
  await expect(participantCount, 'participantCount must start empty so the form is invalid').toHaveValue('');
  await expect(
    next,
    'Next must stay disabled while the required participantCount is empty — the `f.invalid` gate is broken',
  ).toBeDisabled();

  // Below Constants.MIN_NUMBER_OF_SHUFFLING_PARTICIPANTS (3).
  await participantCount.fill('2');
  await participantCount.blur();
  await expect(
    errorFor(/Participant Count must be greater than 3/i),
    'participantCount=2 did not raise the minValue error — the custom [minValue] validator directive is not running',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(next, 'Next must stay disabled with participantCount below the chain minimum').toBeDisabled();

  // Above Constants.MAX_NUMBER_OF_SHUFFLING_PARTICIPANTS (30).
  await participantCount.fill('31');
  await participantCount.blur();
  await expect(
    errorFor(/Participant Count must be less than equal to 30/i),
    'participantCount=31 did not raise the maxValue error — the custom [maxValue] validator directive is not running',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(next, 'Next must stay disabled with participantCount above the chain maximum').toBeDisabled();

  await participantCount.fill('3');
  await participantCount.blur();

  // Below Constants.SHUFFLING_DEPOSIT_TQT (1000 XIN).
  await amount.fill('500');
  await amount.blur();
  await expect(
    errorFor(/Amount must be greater than equal to 1000/i),
    'amount=500 did not raise the minValue error — the chain rejects any XIN shuffling below the 1000 XIN deposit',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(next, 'Next must stay disabled with an amount below the chain minimum').toBeDisabled();

  await amount.fill('1000');
  await amount.blur();
  await expect(
    next,
    'Next did not enable with participantCount=3 / amount=1000 — a validator is rejecting a valid form',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // The finish-height stepper writes straight to the model (increment/decrement
  // by 1440, clamped to 1440..20000) — no ngModel binding runs on those clicks.
  await page.locator('a.btn-primary:has(i.fa-plus)').click();
  await expect(finishHeight, 'increment() did not add one 1440-block step').toHaveValue('2880');
  await page.locator('a.btn-primary:has(i.fa-fast-forward)').click();
  await expect(finishHeight, 'max() did not clamp the registration window to 20000').toHaveValue('20000');
  await page.locator('a.btn-primary:has(i.fa-minus)').click();
  await expect(finishHeight, 'decrement() did not subtract one 1440-block step').toHaveValue('18560');
  await page.locator('a.btn-primary:has(i.fa-fast-backward)').click();
  await expect(finishHeight, 'min() did not clamp the registration window back to 1440').toHaveValue('1440');

  await expect(next, 'Next must remain enabled after the stepper wrote a valid finish height').toBeEnabled();
});

test('create-shuffling: an unknown currency ticker surfaces the chain error and keeps Next disabled', async ({ page, request }) => {
  await page.goto('#/wallet/shuffling/create-shuffling');

  await expect(page.locator('input[name="amount"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await page.locator('input[name="participantCount"]').fill('3');
  await page.locator('input[name="participantCount"]').blur();
  await expect(next, 'the XIN form must be valid before switching the holding type').toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Holding type Currency (value 2) reveals the ticker input, which validates
  // against the chain via getCurrency on every keystroke.
  await page.locator('select[name="holdingType"]').selectOption('2');
  const ticker = page.locator('input[name="currencyCode"]');
  await expect(
    ticker,
    'selecting holding type "Currency" did not reveal the ticker input — the *ngIf on holdingType==2 is broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const unknownTicker = 'ZZQQZZ';
  const rawError = (await request.get(apiBase, {
    params: { requestType: 'getCurrency', code: unknownTicker },
    timeout: DEFAULT_TIMEOUT_MS,
  }).then((r) => r.json())).errorDescription;
  expect(rawError, `getCurrency(${unknownTicker}) unexpectedly resolved — pick a ticker that does not exist`).toBeTruthy();
  // getCurrency() unescapes the two quote entities before writing currencyError.
  const chainError = String(rawError).replace('&#34;', '"').replace('&#34;', '"');

  await ticker.fill(unknownTicker);
  await expect(
    page.locator('.input-error', { hasText: chainError }),
    `the wizard did not show the chain's "${chainError}" for an unknown ticker — ` +
    'getCurrency() is not writing errorDescription into currencyError',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    next,
    'Next stayed enabled with an unresolvable holding — `[disabled]="f.invalid || currencyError || assetError"` regressed, ' +
    'and the wizard would sign a shufflingCreate with an undefined holding',
  ).toBeDisabled();
});

test('create-shuffling: wizard signs shufflingCreate and getShuffling returns the new shuffling', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/shuffling/create-shuffling');
  await expect(page.locator('input[name="amount"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await page.locator('input[name="participantCount"]').fill('3');
  await page.locator('input[name="amount"]').fill('1000');
  await page.locator('input[name="amount"]').blur();

  const next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await expect(next).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await next.click();     // createShuffle() signs the SHUFFLING_CREATION attachment

  const finish = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finish,
    'Finish stayed disabled — SHUFFLING_CREATION signing failed, so validBytes never became true',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await page.locator('button.btn-raised:has(i.fa-key)').first().click();
  const signedBytes = page.locator('textarea[name="key"]').first();
  await expect(signedBytes).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const bytesText = ((await signedBytes.inputValue()) ?? '').trim();
  expect(
    /^[0-9a-fA-F]+$/.test(bytesText) && bytesText.length > 100,
    `signed-transaction textarea did not contain a hex blob (got "${bytesText.slice(0, 60)}…")`,
  ).toBe(true);

  const { txId } = await broadcastAndAwaitConfirmation(
    page, request, apiOriginFromBaseURL(baseURL), finish,
  );

  // The shufflingCreate tx id is the shuffling id.
  const shuffling = await apiJson(request, {
    requestType: 'getShuffling',
    shuffling: txId,
    includeHoldingInfo: true,
  });
  expect(shuffling.issuerRS, 'the new shuffling was not issued by the logged-in account').toBe(TEST_ACCOUNT_1_RS);
  expect(Number(shuffling.participantCount), 'on-chain participantCount does not match the wizard input').toBe(3);
  expect(String(shuffling.amount), 'on-chain amount does not match the 1000 XIN entered in the wizard').toBe('100000000000');
  expect(Number(shuffling.stage), 'a fresh shuffling must be in the REGISTRATION stage (0)').toBe(0);
});

test('show-shufflings: the All tab renders the seeded shuffling and its details action carries the shuffling id', async ({ page, request }) => {
  expectSeededListed(await fetchAllShufflings(request), 'getAllShufflings');
  const chain = await fetchShuffling(request);

  await page.goto('#/wallet/shuffling/show-shufflings/all');

  await expect(
    page.locator('h3.card-title'),
    'the All tab heading is missing or untranslated — the `shufflingType: "ALL"` route data is not reaching the component',
  ).toHaveText('All Shufflings', { timeout: DEFAULT_TIMEOUT_MS });

  await expectRowCountToMatchApi(
    page.locator('datatable-body-row'),
    () => fetchAllShufflings(request),
    'the All datatable does not render one row per getAllShufflings entry — setPage() maps ' +
    '`response.shufflings`, so an API key rename empties the table',
    page.locator('.card-header a:has(i.fa-refresh)'),
  );

  const row = seededRow(page);
  await expect(
    row,
    `no row shows the seeded shuffling's amount of ${formatAmount(seeded.amountTQT)} XIN — ` +
    'the amount column is not rendering the chain value, or the row is not on the page',
  ).toHaveCount(1);

  const cells = row.locator('datatable-body-cell');
  await expect(
    cells.nth(0),
    'participants cell must read "participantCount / registrantCount" from the chain',
  ).toHaveText(`${chain.participantCount} / ${chain.registrantCount}`);
  await expect(cells.nth(1), 'stage cell — shufflingStage pipe must map stage 0 to Registration').toHaveText(STAGE_REGISTRATION);
  await expect(cells.nth(2), 'type cell — holdingType pipe must map holding type 0 to XIN').toHaveText(HOLDING_TYPE_XIN);
  // The column is headed "assigne" but bound to `issuerRS` — assert what it binds.
  await expect(cells.nth(5), 'issuer cell does not match the chain').toHaveText(chain.issuerRS);

  // Rows carry no visible id, so the details action is what proves this row
  // really is the seeded shuffling.
  await row.locator('a:has(i.fa-question-circle-o)').click();
  await expect(
    page,
    'the row\'s details action did not navigate to the seeded shuffling — openShufflingDetails() ' +
    'passes the wrong row field',
  ).toHaveURL(new RegExp(`shuffling-details\\?id=${seeded.shufflingId}$`), { timeout: DEFAULT_TIMEOUT_MS });
});

test('shuffling-details: every field mirrors the getShuffling response', async ({ page, request }) => {
  const chain = await fetchShuffling(request);
  expect(chain.assigneeRS, 'getShuffling returned no assigneeRS — nothing to compare the DOM against').toBeTruthy();
  expect(chain.shufflingFullHash, 'getShuffling returned no shufflingFullHash').toBeTruthy();
  expect(chain.shufflingStateHash, 'getShuffling returned no shufflingStateHash').toBeTruthy();

  await page.goto(`#/wallet/shuffling/show-shufflings/shuffling-details?id=${seeded.shufflingId}`);

  const details = page.locator('app-shuffling-details');
  const value = (label: string) =>
    details.locator('.col-md-4').filter({ has: page.locator('.ucsb', { hasText: label }) }).locator('h4');

  await expect(
    value('Shuffling Id'),
    'shuffling-details did not render the id from the ?id= query param — getShuffleDetails() did not resolve',
  ).toHaveText(seeded.shufflingId, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(value('Holding Type'), 'holding type does not match the chain').toHaveText(HOLDING_TYPE_XIN);
  await expect(value('Amount'), 'amount does not match the chain (quantToAmount|numberString)')
    .toHaveText(`${formatAmount(chain.amount)} ${HOLDING_TYPE_XIN}`);
  await expect(value('Issuer'), 'issuer does not match the chain').toHaveText(chain.issuerRS);
  await expect(value('Last Assigne'), 'assignee does not match the chain').toHaveText(chain.assigneeRS);
  await expect(value('Participant Count'), 'participant count does not match the chain')
    .toHaveText(String(chain.participantCount));
  await expect(value('Registrant Count'), 'registrant count does not match the chain')
    .toHaveText(String(chain.registrantCount));
  await expect(value('State'), 'stage does not match the chain').toHaveText(STAGE_REGISTRATION);
  // "Block Remaining" is deliberately not asserted: it drops every block
  // (~2.4 s on devnet), so any fixed expectation races the forger.

  // In REGISTRATION the chain reports the same value for both hashes, so the
  // panes are told apart by their aria-labelledby tab and by visibility.
  const hashTabs = details.locator('.nav-tabs button');
  const fullHashPane = details.getByLabel('Full Hash');
  const stageHashPane = details.getByLabel('Stage Hash');

  await expect(hashTabs, 'the details view must offer the full-hash and stage-hash tabs').toHaveCount(2);
  await expect(
    fullHashPane,
    'the full-hash pane does not show the chain\'s shufflingFullHash — the ngbNav content did not render',
  ).toHaveText(chain.shufflingFullHash, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    stageHashPane,
    'the stage-hash pane is showing while the full-hash tab is the active one',
  ).toBeHidden();

  await hashTabs.nth(1).click();
  await expect(
    hashTabs.nth(1),
    'clicking the stage-hash tab did not activate it — ngbNav activeId binding broken',
  ).toHaveClass(/active/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    stageHashPane,
    'the stage-hash tab does not show the chain\'s shufflingStateHash',
  ).toHaveText(chain.shufflingStateHash, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    fullHashPane,
    'the full-hash pane stayed visible after switching to the stage-hash tab',
  ).toBeHidden();
});

test('show-shufflings: the My tab links to the participant list of the seeded shuffling', async ({ page, request }) => {
  expectSeededListed(await fetchAccountShufflings(request), 'getAccountShufflings');

  await page.goto('#/wallet/shuffling/show-shufflings/my');

  await expect(
    page.locator('h3.card-title'),
    'the My tab heading is missing or untranslated — the `shufflingType: "MY"` route data is not reaching the component',
  ).toHaveText('My Shufflings', { timeout: DEFAULT_TIMEOUT_MS });

  await expectRowCountToMatchApi(
    page.locator('datatable-body-row'),
    () => fetchAccountShufflings(request),
    'the My datatable does not render one row per getAccountShufflings entry — the forkJoin of ' +
    'getAccountShufflings + getShufflers may have failed (it swallows errors and leaves rows empty)',
    page.locator('.card-header a:has(i.fa-refresh)'),
  );

  const row = seededRow(page);
  await expect(
    row,
    `no My-tab row shows the seeded shuffling's amount of ${formatAmount(seeded.amountTQT)} XIN`,
  ).toHaveCount(1);

  // In the My tab the participants cell is a link; in the All tab it is plain text.
  await row.locator('datatable-body-cell').first().locator('a.hyperlink').click();
  await expect(
    page,
    'the participants link did not navigate to the seeded shuffling — openShufflingParticipants() ' +
    'passes the wrong row field',
  ).toHaveURL(new RegExp(`shuffling-participants\\?id=${seeded.shufflingId}$`), { timeout: DEFAULT_TIMEOUT_MS });

  const participantRows = page.locator('app-shuffling-participants datatable-body-row');
  await expectRowCountToMatchApi(
    participantRows,
    () => fetchParticipants(request),
    'the participants datatable does not render one row per getShufflingParticipants entry',
  );

  // The issuer is registered automatically when the shuffling is created.
  await expect(
    participantRows.locator('datatable-body-cell', { hasText: TEST_ACCOUNT_1_RS }),
    'the issuer is not listed as a participant of its own shuffling',
  ).toHaveCount(1);
});

test('join-shuffling: TEST_ACCOUNT_2 registers and the wallet shows the second registrant', async ({ page, request }) => {
  // Retry-safe: on a CI retry the account is already registered, and the chain
  // rejects a second registration.
  const before = await fetchParticipants(request);
  if (!before.some((p) => p.accountRS === TEST_ACCOUNT_2_RS)) {
    await registerForShufflingViaApi(request, apiBase, seeded.fullHash, TEST_ACCOUNT_2_PASSPHRASE);
  }

  const participants = await fetchParticipants(request);
  expect(
    participants.map((p) => p.accountRS).sort(),
    `shufflingRegister did not add ${TEST_ACCOUNT_2_RS} to shuffling ${seeded.shufflingId}`,
  ).toEqual([TEST_ACCOUNT_1_RS, TEST_ACCOUNT_2_RS].sort());

  const chain = await fetchShuffling(request);
  expect(Number(chain.registrantCount), 'registrantCount did not grow to 2 after the join').toBe(2);
  expect(
    Number(chain.stage),
    'the shuffling left REGISTRATION with only 2 of 3 participants — the later assertions assume it is still open',
  ).toBe(0);

  await page.goto(`#/wallet/shuffling/show-shufflings/shuffling-participants?id=${seeded.shufflingId}`);

  const participantRows = page.locator('app-shuffling-participants datatable-body-row');
  await expect(
    participantRows,
    'the participants view does not show both registrants — getShufflingParticipants is not re-read or `response.participants` is unmapped',
  ).toHaveCount(2, { timeout: DEFAULT_TIMEOUT_MS });
  for (const accountRs of [TEST_ACCOUNT_1_RS, TEST_ACCOUNT_2_RS]) {
    await expect(
      participantRows.locator('datatable-body-cell', { hasText: accountRs }),
      `participant ${accountRs} is missing from the participants table`,
    ).toHaveCount(1);
  }
  // Participant state 0 (REGISTERED) is piped through `shufflingStage`, which
  // labels it "Registration".
  await expect(
    participantRows.first().locator('datatable-body-cell').first(),
    'participant state cell is empty — the state column lost its cell template',
  ).toHaveText(STAGE_REGISTRATION);

  await page.goto('#/wallet/shuffling/show-shufflings/all');
  await expect(
    seededRow(page).locator('datatable-body-cell').first(),
    'the All tab still shows the pre-join registrant count — the list is serving a stale getAllShufflings response',
  ).toHaveText(`${seeded.participantCount} / 2`, { timeout: DEFAULT_TIMEOUT_MS });
});
