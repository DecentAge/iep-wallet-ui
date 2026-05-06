import { test, expect, request as pwRequest, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
  CASH_ACCOUNT_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Account Control page (`#/wallet/account/control`) — IEP's implementation
 * of NXT-style phased (multi-sig) transactions.
 *
 * The page has two sections:
 *
 * 1. "Set Account Control Details" wizard — sets a phasingOnlyControl policy
 *    on the logged-in account (all future txs from that account must be
 *    phased and approved by the whitelisted accounts). This is a permanent
 *    chain-level constraint until explicitly removed.
 *
 * 2. "Pending Approval Request" datatable — lists phased transactions where
 *    the logged-in account is whitelisted as an approver. Each row has an
 *    Approve action that leads to `#/wallet/account/control/control-approve`.
 *
 * Why the approval flow uses TEST_ACCOUNT_2 as the tx submitter:
 *   - Submitting a phased tx from TEST_ACCOUNT_1 (the approver) would create
 *     a circular dependency. TEST_ACCOUNT_2 submits the phased tx; TEST_ACCOUNT_1
 *     approves it.
 *   - Setting phasingOnlyControl on TEST_ACCOUNT_1 would permanently require
 *     all future test transactions to go through approval — breaking every
 *     other spec that uses TEST_ACCOUNT_1. Keeping control on TEST_ACCOUNT_2
 *     for the set-account-control wizard test avoids that.
 *
 * Setup (beforeAll):
 *   Creates a phased sendMoney from TEST_ACCOUNT_2 → CASH_ACCOUNT_RS
 *   requiring TEST_ACCOUNT_1's approval (phasingVotingModel=1 BY_ACCOUNT,
 *   phasingWhitelisted=TEST_ACCOUNT_1_RS, quorum=1). Waits for confirmation
 *   so it appears in TEST_ACCOUNT_1's getVoterPhasedTransactions list.
 *
 * Migration risks this catches:
 *   - ControlComponent's getVoterPhasedTransactions() → page wiring
 *   - The archwizard "Set Account Control" step 1 (Add Approval Accounts
 *     button → accounts[] push → quorum spinner)
 *   - control-approve.component: reads DataStoreService.get('approve') from
 *     prior navigation (not navigable directly via URL); the approve button
 *     in the pending table sets this state before routing
 *   - broadcastTransaction for approveTransaction subtype
 */

const API_BASE = process.env.API_BASE ?? 'http://node-1/api';

let phasedTxId: string;
let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await pwRequest.newContext();

  // Current height — needed to set phasingFinishHeight well ahead of tests.
  const statusResp = await apiCtx.get(`${API_BASE}?requestType=getBlockchainStatus`);
  const status = await statusResp.json();
  const currentHeight: number = (status.numberOfBlocks ?? 0) - 1;

  // Phased sendMoney from TEST_ACCOUNT_2 → CASH_ACCOUNT_RS.
  // phasingVotingModel=1 = BY_ACCOUNT: specific whitelisted accounts can vote.
  // phasingWhitelisted=TEST_ACCOUNT_1_RS: only TEST_ACCOUNT_1 can approve.
  // phasingQuorum=1: one approval is sufficient to execute.
  const params = new URLSearchParams({
    requestType: 'sendMoney',
    recipient: CASH_ACCOUNT_RS,
    amountTQT: '100000000',
    secretPhrase: TEST_ACCOUNT_2_PASSPHRASE,
    feeTQT: '100000000',
    deadline: '80',
    broadcast: 'true',
    phased: 'true',
    phasingFinishHeight: String(currentHeight + 300),
    phasingVotingModel: '1',
    phasingQuorum: '1',
    phasingWhitelisted: TEST_ACCOUNT_1_RS,
    phasingMinBalance: '0',
    phasingMinBalanceModel: '0',
  });
  const resp = await apiCtx.post(API_BASE, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: params.toString(),
  });
  const created = await resp.json();
  if (!created.transaction || created.broadcasted !== true) {
    throw new Error(`phased sendMoney setup failed: ${JSON.stringify(created)}`);
  }
  phasedTxId = created.transaction;

  // Wait for the phased tx to land in a block — it only appears in
  // getVoterPhasedTransactions after confirmation (mempool txs are excluded).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const txResp = await apiCtx.get(`${API_BASE}?requestType=getTransaction&transaction=${phasedTxId}`);
    const tx = await txResp.json();
    if (tx.block && typeof tx.confirmations === 'number') return;
    await new Promise(r => setTimeout(r, 1_000));
  }
  throw new Error(`phased tx ${phasedTxId} did not confirm within 60s — devnet forging stalled?`);
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

test('control: page mounts with Set Account Control wizard and Pending Approval Request datatable', async ({ page }) => {
  await page.goto('#/wallet/account/control');

  // "Add Approval Accounts" button is the visible entry-point for step 1 of
  // the set-account-control wizard. Its presence proves the ControlComponent
  // mounted and rendered the archwizard's first step.
  const addApprovalLink = page.locator('a', { hasText: /Add Approval Accounts/i }).first();
  await expect(
    addApprovalLink,
    '"Add Approval Accounts" link not visible — ControlComponent or archwizard step 1 did not mount',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The "Pending Approval Request" datatable is always rendered (empty or not).
  const pendingTable = page.locator('ngx-datatable').first();
  await expect(
    pendingTable,
    'Pending Approval Request datatable did not mount — ControlComponent template broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('control: pending approval request table shows the phased tx from TEST_ACCOUNT_2 awaiting TEST_ACCOUNT_1 approval', async ({ page }) => {
  await page.goto('#/wallet/account/control');

  // After beforeAll confirmed the phased tx, getVoterPhasedTransactions
  // (called on page init) should return it in TEST_ACCOUNT_1's approval queue.
  // The Sender column renders the sender RS address as plain text.
  const senderCell = page.locator('ngx-datatable .datatable-body-cell', { hasText: TEST_ACCOUNT_2_RS }).first();
  await expect(
    senderCell,
    `TEST_ACCOUNT_2 (${TEST_ACCOUNT_2_RS}) not visible as Sender in the Pending Approval Request table — ` +
    `phased tx ${phasedTxId} may not appear in getVoterPhasedTransactions for TEST_ACCOUNT_1. ` +
    `Check that phasingWhitelisted=TEST_ACCOUNT_1_RS was set correctly.`,
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The Actions column has two icon buttons per row: details (fa-list-ul) and
  // approve (fa-unlock). Verify the unlock icon is present as proof the
  // approve action rendered for this phased tx.
  const approveIcon = page.locator('ngx-datatable i.fa-unlock').first();
  await expect(
    approveIcon,
    'Approve icon (fa-unlock) not found in the datatable — approve action column may not have rendered',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('control: approve button navigates to control-approve and broadcasts the approval tx', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/account/control');

  // Wait for the phased tx row's approve icon button.
  // The approve action is an icon-only <a> with fa-unlock icon, no text.
  const approveIcon = page.locator('ngx-datatable i.fa-unlock').first();
  await expect(approveIcon, 'Approve icon not visible — phased tx may not be in the pending list').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  // Click the parent <a> element that triggers goToApproveRequest().
  const approveButton = page.locator('ngx-datatable a:has(i.fa-unlock)').first();
  await expect(approveButton, 'Approve button not visible — phased tx may not be in the pending list').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Clicking Approve sets DataStoreService('approve') with the tx fullHash and
  // navigates to control/control-approve. The control-approve component auto-
  // calls approveTransactions() on init and signs the approval locally. Once
  // validBytes === true, the Broadcast button enables.
  await approveButton.click();

  // Wait for navigation to control-approve.
  await page.waitForURL(/#\/wallet\/account\/control\/control-approve/, { timeout: DEFAULT_TIMEOUT_MS });

  // The Broadcast/Finish button on control-approve uses btn-primary (not btn-gradient).
  // It enables once confirmControlledTransaction() completes: approveTransaction API
  // returns unsigned bytes → signs locally → validBytes=true.
  const finishButton = page.locator('button:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Broadcast button did not enable on control-approve — approveTransactions() signing may have failed ' +
    '(DataStoreService approve state not set, or publicKey/fullHash missing)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // approveTransaction is type=20 (Phasing), subtype=0 (PHASING_VOTE_CASTING) in NXT/IEP.
  // Verify the approval landed and refers to the correct phased tx.
  expect(tx.type, 'approval tx wrong type — expected Phasing (20) or similar').toBeDefined();
  expect(tx.senderRS, 'approval sender mismatch — expected TEST_ACCOUNT_1').toBe(TEST_ACCOUNT_1_RS);
});
