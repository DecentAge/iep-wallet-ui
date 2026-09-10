import { test, expect } from '../../../fixtures/test';
import { Page, request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * The three read-only poll views that close the voting lifecycle after
 * create-poll.spec.ts and cast-vote.spec.ts: result / voters / details
 * (`#/wallet/voting/show-polls/{result,voters,details}?id=<pollId>`).
 *
 * Risks covered:
 *   - all three components read the poll id from `route.queryParams` (an `?id=`
 *     query param, not a path segment) and call `_location.back()` when it is
 *     missing — a router regression turns the page into a silent bounce, which
 *     no smoke route test catches because the URL alone still "renders".
 *   - PollResultComponent post-processes getPollResult itself: `results[].result`
 *     arrives as a *string* (`"1"` for a voted option, `""` for an unvoted one),
 *     is divided by TOKEN_QUANTS only when `votingModel !== 0`, and feeds both
 *     the ngx-datatable and the ngx-charts pie. String arithmetic + an `|| 0`
 *     NaN guard is exactly the kind of code a framework bump breaks quietly.
 *   - PollVotersComponent hands the clicked row's transaction id to
 *     TransactionDetailComponent through the static DataStoreService (no route
 *     param), the same hand-off that read-message.spec.ts pins for messages.
 *
 * DAO polls (`src/app/module/dao`) reuse these components verbatim: dao.module
 * imports voting's PollsComponent, ShowDaoPollsComponent is only an
 * `<app-polls>` wrapper, and its row actions go through the same
 * `VotingService.detailsActions()` into `/voting/show-polls/{result,voters,details}`.
 * So this spec covers the DAO variant too; the only difference is that DAO polls
 * are asset-weighted (`votingModel === Asset`), i.e. they take the TOKEN_QUANTS
 * divisor branch — which the UI cannot show either way, see the note on
 * percentages below.
 *
 * Setup happens over the chain's REST API (`secretPhrase` signing, devnet-only):
 * a fresh poll + one vote from TEST_ACCOUNT_1 per run. Fresh poll ids keep the
 * spec rerunnable against the same chain — the "one vote per account per poll"
 * rule would otherwise reject the second run's vote.
 *
 * Note on what is asserted for the result view: the template binds only the
 * option label and the *percentage*, never `pollResults.total` or the per-option
 * `value`. Percentages are scale-invariant, so a wrong divisor is invisible in
 * the UI. Asserting the raw counter "1" and the total "1" is therefore
 * impossible without a wallet change.
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';
const VOTE_FEE_TQT = '100000000';

const marker = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pollName = `e2e-poll-results-${marker}`;
const pollDescription = `e2e poll-results.spec.ts run ${marker}`;
const optionVoted = `yes-${marker}`;
const optionUnvoted = `no-${marker}`;

let apiCtx: APIRequestContext;
let pollId: string;
let voteTxId: string;
let finishHeight: number;

/** Reads the `<h4>` of the labelled field block used by poll-details and transaction-detail. */
function labelledField(page: Page, host: string, label: string) {
  return page
    .locator(`${host} .col-md-4`)
    .filter({ has: page.locator('div.ucsb').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }) })
    .locator('h4');
}

async function awaitConfirmation(txId: string, what: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const resp = await apiCtx.get(`${API_BASE}?requestType=getTransaction&transaction=${txId}`);
    const tx = await resp.json();
    if (tx.block && typeof tx.confirmations === 'number') return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${what} tx ${txId} did not confirm within 60s — devnet forging stalled?`);
}

async function postApi(params: Record<string, string>): Promise<any> {
  const resp = await apiCtx.post(API_BASE, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams(params).toString(),
  });
  return resp.json();
}

test.beforeAll(async () => {
  // Two sequential block confirmations (createPoll, then castVote) exceed the
  // default 60 s hook budget on a slow devnet.
  test.setTimeout(180_000);

  apiCtx = await pwRequest.newContext();

  const status = await (await apiCtx.get(`${API_BASE}?requestType=getBlockchainStatus`)).json();
  finishHeight = (status.numberOfBlocks ?? 0) - 1 + 200;

  const created = await postApi({
    requestType: 'createPoll',
    name: pollName,
    description: pollDescription,
    finishHeight: String(finishHeight),
    votingModel: '0',
    minNumberOfOptions: '1',
    maxNumberOfOptions: '1',
    minRangeValue: '0',
    maxRangeValue: '1',
    option00: optionVoted,
    option01: optionUnvoted,
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: VOTE_FEE_TQT,
    deadline: '80',
    broadcast: 'true',
  });
  if (!created.transaction || created.broadcasted !== true) {
    throw new Error(`createPoll failed: ${JSON.stringify(created)}`);
  }
  pollId = created.transaction;
  await awaitConfirmation(pollId, 'createPoll');

  const voted = await postApi({
    requestType: 'castVote',
    poll: pollId,
    vote00: '1',
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: VOTE_FEE_TQT,
    deadline: '80',
    broadcast: 'true',
  });
  if (!voted.transaction || voted.broadcasted !== true) {
    throw new Error(`castVote on poll ${pollId} failed: ${JSON.stringify(voted)}`);
  }
  voteTxId = voted.transaction;
  await awaitConfirmation(voteTxId, 'castVote');

  // Separate "the chain never counted the vote" from "the wallet did not render
  // it" before any UI assertion runs.
  const result = await (await apiCtx.get(`${API_BASE}?requestType=getPollResult&poll=${pollId}`)).json();
  if (String(result?.results?.[0]?.result ?? '') !== '1') {
    throw new Error(
      `getPollResult does not show the vote this setup cast on poll ${pollId}: ${JSON.stringify(result)}`,
    );
  }
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

test('poll-result: the running poll renders 100% on the voted option and 0% on the other', async ({ page }) => {
  await page.goto(`#/wallet/voting/show-polls/result?id=${pollId}`);

  const rows = page.locator('app-poll-result datatable-body-row');
  await expect(
    rows.first(),
    `poll-result rendered no result rows for poll ${pollId} — the getPollResult subscription ` +
      'did not populate pollResults.pollData (a bounced ?id= queryParam sends the view straight back)',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    rows,
    'poll-result did not render one row per poll option — results[] and options[] got misaligned',
  ).toHaveCount(2);

  // The percentage cell, not the whole row: "0.00 %" is a substring of "100.00 %".
  const percentageOf = (option: string) =>
    rows.filter({ hasText: option }).locator('datatable-body-cell').nth(1);

  await expect(
    percentageOf(optionVoted),
    `the voted option "${optionVoted}" is not at 100% — getPollData() mis-computed the percentage ` +
      'from the string-typed results[].result, or applied the TOKEN_QUANTS divisor to a votingModel-0 poll',
  ).toHaveText('100.00 %');

  await expect(
    percentageOf(optionUnvoted),
    `the unvoted option "${optionUnvoted}" is not at 0% — the empty-string result ("") was not ` +
      'coerced to 0 and the NaN guard (|| 0) no longer catches it',
  ).toHaveText('0.00 %');

  await expect(
    page.locator('app-poll-result h3.title'),
    `poll-result did not show the poll name "${pollName}" — getPoll() subscription broken ` +
      'while getPollResult() still worked',
  ).toHaveText(pollName);

  await expect(
    page.locator('app-poll-result p.description'),
    'poll-result did not show the poll description',
  ).toHaveText(pollDescription);

  const chart = page.locator('#pie-chart2');
  await expect(
    chart,
    'the pie chart did not mount — pieChartData stayed empty although the datatable had rows',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    chart,
    `the pie chart does not name the voted option "${optionVoted}" — pieChartData was built from ` +
      'the wrong field (option.key holds the label, option.percentage the value)',
  ).toContainText(optionVoted);
});

test('poll-voters: the voter row opens the castVote transaction in the detail view', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const votesResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getPollVotes', poll: pollId, includeWeights: 'true', firstIndex: 0, lastIndex: 9 },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const votes = await votesResp.json();
  expect(
    votes?.votes?.[0]?.transaction,
    `getPollVotes does not report the castVote tx ${voteTxId} for poll ${pollId}: ${JSON.stringify(votes)}`,
  ).toBe(voteTxId);

  await page.goto(`#/wallet/voting/show-polls/voters?id=${pollId}`);

  const voterRow = page.locator('app-poll-voters datatable-body-row', { hasText: TEST_ACCOUNT_1_RS });
  await expect(
    voterRow,
    `the voters list does not show ${TEST_ACCOUNT_1_RS} as a voter of poll ${pollId} — ` +
      'getPollVotes ran but voterRS is no longer the column prop, or the ?id= queryParam never arrived',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

  await voterRow.locator('button.actionBtn').click();
  await page.waitForURL(/voters\/transaction-details/, { timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    labelledField(page, 'app-transaction-detail', 'Transaction ID'),
    `the detail view does not show the castVote tx ${voteTxId} — goToDetails() put the wrong id into ` +
      'DataStoreService, or TransactionDetailComponent lost it on the route change',
  ).toHaveText(voteTxId, { timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    labelledField(page, 'app-transaction-detail', 'Transaction Type'),
    'the detail view does not classify the transaction as a vote — the transactionTextSubType pipe ' +
      'no longer maps type 1 / subtype 3',
  ).toHaveText('Vote Casting');

  await expect(
    labelledField(page, 'app-transaction-detail', 'Sender'),
    `the detail view shows the wrong sender for the vote cast by ${TEST_ACCOUNT_1_RS}`,
  ).toHaveText(TEST_ACCOUNT_1_RS);
});

test('poll-details: the metadata view matches what getPoll returns', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const pollResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getPoll', poll: pollId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const poll = await pollResp.json();
  expect(poll.errorCode, `getPoll failed for ${pollId}: ${JSON.stringify(poll)}`).toBeUndefined();

  await page.goto(`#/wallet/voting/show-polls/details?id=${pollId}`);

  const name = labelledField(page, 'app-poll-details', 'Name');
  await expect(
    name,
    `poll-details did not render poll ${pollId} — the getPoll subscription never populated this.poll`,
  ).toHaveText(poll.name, { timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    labelledField(page, 'app-poll-details', 'Description'),
    'poll-details shows a description that differs from getPoll',
  ).toHaveText(poll.description);

  await expect(
    labelledField(page, 'app-poll-details', 'Poll Id'),
    'poll-details shows a different poll id than the one requested',
  ).toHaveText(poll.poll);

  await expect(
    labelledField(page, 'app-poll-details', 'Issuer'),
    'poll-details shows the wrong issuer — accountRS binding broken',
  ).toHaveText(poll.accountRS);

  await expect(
    labelledField(page, 'app-poll-details', 'Block height finished'),
    `poll-details shows a finishHeight that differs from getPoll (${poll.finishHeight})`,
  ).toHaveText(String(poll.finishHeight));

  await expect(
    labelledField(page, 'app-poll-details', 'Voting Model'),
    'poll-details did not translate votingModel 0 to "Account" — the votingModel pipe regressed ' +
      'or its [innerHTML] binding was stripped by the sanitizer',
  ).toHaveText('Account');

  await expect(
    labelledField(page, 'app-poll-details', 'Options').locator('li'),
    `poll-details did not list the poll options ${JSON.stringify(poll.options)} — the *ngFor over ` +
      'poll.options rendered nothing or in the wrong order',
  ).toHaveText(poll.options);
});
