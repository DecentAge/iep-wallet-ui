import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_RS } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Cast Vote wizard (`#/wallet/voting/show-polls/vote?id=<pollId>`) — votes
 * on an existing on-chain poll. Pairs with create-poll.spec.ts to cover the
 * full poll lifecycle (CREATE → VOTE) and exercises the VOTE_CASTING subtype,
 * which no other test in the suite touches.
 *
 * Migration risks this catches:
 *   - 2-step archwizard with NO template-driven validators on step 1 — the
 *     "form valid" gate is a logic-driven `isStepOneFormValid` flag set by
 *     `handleOptions()` based on min/max-options bounds. Step 1's exit gate
 *     uses `[canExit]="isStepOneFormValid"` instead of `[disabled]="f.invalid"`
 *     — a regression in archwizard's canExit/awNextStep interplay hits here
 *     and not in the other forms.
 *   - dynamic checkbox array generated via *ngFor over `poll.options` — the
 *     only form in the suite where the form fields don't exist at template
 *     compile time but are built from API data after route activation
 *   - the `?id=<pollId>` queryParams subscription that drives `getPollDetails()`
 *     — different navigation pattern from every other form
 *   - the VOTE_CASTING subtype attachment encoding inside signTransactionHex
 *
 * Drives the wizard through Finish + broadcast on devnet, then verifies the
 * vote with `getPollVote`. The "one vote per account per poll" rule that
 * normally would break reruns is sidestepped because the `beforeAll` creates
 * a fresh poll per test invocation (timestamped name + new pollId), so each
 * run votes against a different poll.
 *
 * Setup (`beforeAll`): creates a fresh poll via the chain's REST API (signing
 * server-side via `secretPhrase`, allowed on devnet) so the test has a known
 * poll ID to navigate to. Cleanest approach because:
 *   - skipping the wallet UI for setup avoids re-running the create-poll
 *     wizard before every test
 *   - direct API call gives back the poll ID synchronously
 *   - `broadcast=true` forces inclusion in the next forged block; we then
 *     poll getTransaction until it lands so the vote-form's getPollDetails
 *     call sees the poll
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';

let pollId: string;
let pollName: string;
let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  // Pin the poll's finishHeight comfortably above current height. 200 blocks
  // ≈ 20 minutes at the devnet's ~6-s block time — well past any test run.
  const statusResp = await apiCtx.get(`${API_BASE}?requestType=getBlockchainStatus`);
  const status = await statusResp.json();
  const currentHeight: number = (status.numberOfBlocks ?? 0) - 1;

  pollName = `e2e-vote-poll-${Date.now().toString(36)}`;
  const params = new URLSearchParams({
    requestType: 'createPoll',
    name: pollName,
    description: 'e2e test poll — auto-created by cast-vote.spec.ts',
    finishHeight: String(currentHeight + 200),
    votingModel: '0',                         // 0 = account-based voting
    minNumberOfOptions: '1',
    maxNumberOfOptions: '1',
    minRangeValue: '0',
    maxRangeValue: '1',
    option00: 'Yes',
    option01: 'No',
    secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
    feeTQT: '100000000',
    deadline: '80',
    broadcast: 'true',
  });
  const createResp = await apiCtx.post(API_BASE, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: params.toString(),
  });
  const created = await createResp.json();
  if (!created.transaction || created.broadcasted !== true) {
    throw new Error(`createPoll failed: ${JSON.stringify(created)}`);
  }
  pollId = created.transaction;

  // Wait until the create-poll tx is included in a block — `getPollDetails`
  // returns errorCode 4 ("Unknown poll") for any poll whose creating tx is
  // still in mempool, and the vote form would never enable Next.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const txResp = await apiCtx.get(`${API_BASE}?requestType=getTransaction&transaction=${pollId}`);
    const tx = await txResp.json();
    if (tx.block && typeof tx.confirmations === 'number') return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`poll tx ${pollId} did not confirm within 60s — devnet forging stalled?`);
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

test('cast-vote: 2-step wizard broadcasts castVote and getPollVote returns the recorded vote', async ({ page, request, baseURL }) => {
  await page.goto(`#/wallet/voting/show-polls/vote?id=${pollId}`);

  // The dynamic checkboxes use the Bootstrap 4 custom-checkbox pattern:
  // the `<input type=checkbox>` is dimensionally hidden (opacity:0, 0×0)
  // and the visible click target is the sibling `<label for="<index>">`.
  // The input's `id="{{ option.index }}"` is also a hidden bug — HTML4 ids
  // must begin with a letter, though browsers tolerate digit-leading ids
  // (and `for="0"` still resolves correctly). CSS still forbids `#0`, which
  // is why we use attribute-selector form here.
  const optionYesInput = page.locator('input[type="checkbox"][id="0"]');
  const optionYesLabel = page.locator('label.custom-control-label[for="0"]');
  await expect(
    optionYesLabel,
    `vote form did not render the option label for poll ${pollId} — the *ngFor over ` +
    'poll.options did not run, likely because getPollDetails returned no poll',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Confirm the poll name renders (read-only display in step 1).
  await expect(
    page.getByText(pollName).first(),
    `step-1 did not render the poll name "${pollName}" — getPollDetails subscription broken`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Select option 0 ("Yes"). One option satisfies maxNumberOfOptions=1 and
  // flips `isStepOneFormValid` to true via handleOptions(). Click the label —
  // the underlying input is dimensionally hidden so .check() on it would
  // fail actionability; the for=id wiring + native change event fire the
  // (change)="handleOptions(option.index)" handler the same way.
  await optionYesLabel.click();
  await expect(optionYesInput, 'checkbox did not toggle after label click — for=id wiring broken').toBeChecked();

  // Step 1 Next button — has chevron-right, NO `[disabled]` binding (the
  // wizard's canExit gate handles the rejection). Clicking with no option
  // selected pops a sweetalert; here we click after selecting one.
  const step1Next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await step1Next.click();   // calls nextStep() → signs VOTE_CASTING attachment

  // Finish button (step-2-only marker — has fa-check icon) only enables when
  // validBytes becomes true after castVote's backend call signs locally.
  // Wait for it as the step-2-reached signal first, since archwizard hides
  // but doesn't unmount step-1 DOM (so `<h4>` matches both step-1 and step-2
  // copies of the poll name; locating a step-2-exclusive element is cleaner
  // than `.filter({ visible: true })`).
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not become enabled — either archwizard did not transition ' +
    'to step 2 (`isStepOneFormValid`/canExit gate broken) or VOTE_CASTING signing failed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Poll name re-rendered in step-2 confirm — filter by visibility because
  // step-1's hidden copy of the same `<h4>` would otherwise win `.first()`.
  await expect(
    page.locator('h4', { hasText: pollName }).filter({ visible: true }).first(),
    'step-2 confirm did not render the poll name — archwizard rendered step 2 chrome ' +
    'but the binding to poll.name regressed',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Verify the signed-transaction textarea contains hex bytes — direct proof
  // the signing chain produced output for this subtype.
  //
  // Unlike the other wizard forms (escrow / subscription / issue-asset / send)
  // which initialize `unsignedTx: boolean = false` (textarea hidden, toggle
  // reveals), poll-vote uses `signedTx: boolean = true` so the textarea is
  // ALREADY visible on entering step 2. So no toggle click here — just read.
  const signedBytes = page.locator('textarea[name="key"]').first();
  await expect(signedBytes).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const bytesText = ((await signedBytes.inputValue()) ?? '').trim();
  expect(
    /^[0-9a-fA-F]+$/.test(bytesText) && bytesText.length > 100,
    `signed-transaction textarea did not contain a hex blob (got "${bytesText.slice(0, 60)}…") — ` +
    `cryptoService.signTransactionHex output may have changed`,
  ).toBe(true);

  // Click Finish → wallet POSTs broadcastTransaction → poll until confirmed.
  // The "one vote per poll per account" rule is sidestepped: each test run's
  // beforeAll creates a NEW poll, so this account hasn't voted on it before.
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // Verify the vote landed: getPollVote returns the vote vector keyed by
  // (pollId, voter accountId/RS). Index 0 (the option we ticked) should be 1.
  const voteResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getPollVote', poll: pollId, account: TEST_ACCOUNT_1_RS },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(voteResp.ok()).toBe(true);
  const vote = await voteResp.json();
  expect(
    vote.errorCode,
    `getPollVote returned an error after broadcast (tx ${txId}, poll ${pollId}): ${JSON.stringify(vote)}`,
  ).toBeUndefined();
  expect(Array.isArray(vote.votes), 'getPollVote did not return a votes array').toBe(true);
  expect(
    Number(vote.votes?.[0] ?? 0),
    `vote on option 0 (Yes) was not recorded — full response: ${JSON.stringify(vote)}`,
  ).toBeGreaterThanOrEqual(1);
});
