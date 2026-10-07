import { test, expect } from '../../../fixtures/test';
import { APIRequestContext, Page } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  CreateDaoWizardPage,
  DaoWizardNames,
  randomDaoNames,
  teamMemberAliasName,
} from '../../../pages/create-dao-wizard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_RS,
  TEST_ACCOUNT_2_ID,
  CASH_ACCOUNT_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

// Opts out of the shared alert auto-dismissal: CreateDaoWizardPage asserts that the
// result dialog names the broadcast transactions, so it needs the dialog to stay.
test.use({ autoDismissAlerts: false });
import {
  clickAndCollectBroadcasts,
  awaitTransactionsConfirmed,
} from '../../../helpers/broadcast-collect';

/**
 * create-dao wizard (`#/wallet/dao/create-dao`).
 *
 * There is no DAO transaction type on chain. `DaoService` composes a DAO out of
 * two ordinary primitives, which is what the assertions below verify:
 *
 *   DAO     issueAsset `DAO<prefix>`               + setAlias `DAO<name>XT<prefix>`
 *   team    issueAsset `DAO<prefix>XE<teamPrefix>` + setAlias `DAO<prefix>XN<team>XE<teamPrefix>`
 *   member  setAlias `DAO<prefix>XN<team>XR<role>XE<teamPrefix>` + transferAsset (team + DAO token)
 *
 * Alias URIs carry the account as `acct:<RS>@xin`; every DAO name the UI shows
 * is parsed back out of those alias names. The wizard is also the only wallet
 * flow that changes route between steps, so each step is bounded by a
 * broadcast, a result dialog and a `waitForURL`.
 *
 * Leftovers per run: two assets (1000 / 500 QNT, held by the creating account),
 * two aliases and 4 XIN in fees. No orders, leases or locked balance, so
 * nothing another spec can trip over. Every chain-unique name is randomised.
 */

test.describe.configure({ mode: 'serial' });

/** Transaction (type, subtype) pairs, as `getTransaction` reports them. */
const ISSUE_ASSET: [number, number] = [2, 0];
const SET_ALIAS: [number, number] = [1, 1];
const TRANSFER_ASSET: [number, number] = [2, 1];

const DAO_DESCRIPTION = 'e2e regression DAO — created by create-dao.spec.ts';
const TEAM_DESCRIPTION = 'e2e regression DAO team — created by create-dao.spec.ts';

// Handed from the wizard test to the approval-accounts test.
let created: DaoWizardNames | null = null;

async function api(
  request: APIRequestContext,
  apiOrigin: string,
  params: Record<string, string>,
): Promise<any> {
  const resp = await request.get(`${apiOrigin}/api`, { params, timeout: DEFAULT_TIMEOUT_MS });
  expect(resp.ok(), `${params.requestType} responded HTTP ${resp.status()}`).toBe(true);
  return resp.json();
}

function queryParams(url: string): URLSearchParams {
  try {
    return new URL(url).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/** Arm before the click that triggers it; the wallet talks to the node over
 *  GET `/api?requestType=…`, so the query string identifies the call. */
function awaitApiCall(page: Page, requestType: string, expectedParams: Record<string, string> = {}) {
  return page.waitForResponse(
    (resp) => {
      const params = queryParams(resp.url());
      if (params.get('requestType') !== requestType) return false;
      return Object.entries(expectedParams).every(([key, value]) => params.get(key) === value);
    },
    { timeout: DEFAULT_TIMEOUT_MS },
  );
}

function only(txs: any[], [type, subtype]: [number, number]): any[] {
  return txs.filter((tx) => tx.type === type && tx.subtype === subtype);
}

function describeTxs(txs: any[]): string {
  return txs.map((tx) => `${tx.type}/${tx.subtype} ${JSON.stringify(tx.attachment)}`).join(' | ');
}

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('create-dao: wizard issues the DAO and team token+alias pairs and the DAO appears in show-daos', async ({
  page,
  request,
  baseURL,
}) => {
  // Worst case is dominated by the broadcast-collect helper budgets: two
  // collect windows (DEFAULT_TIMEOUT_MS * 3 each) plus two confirmation windows
  // (DEFAULT_TIMEOUT_MS * 6 each) = 180s, plus login and four route
  // transitions. The 60s config default cannot cover that when iep-node's
  // one-new-alias-per-block throttle spreads the four transactions over
  // several blocks.
  test.setTimeout(DEFAULT_TIMEOUT_MS * 24);

  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const names = randomDaoNames();
  const wizard = new CreateDaoWizardPage(page);

  await wizard.goto();

  // ── step 1/4 — the DAO ────────────────────────────────────────────────────
  await expect(
    wizard.daoNext,
    'create-dao step-1 Next must stay disabled while the form is empty',
  ).toBeDisabled();

  // quantity must be > 1: createAsset() aborts with an info dialog on a
  // one-share DAO. The hidden decimals field is 1, so 100 shares → 1000 QNT.
  await wizard.fillDaoStep(names, '100', DAO_DESCRIPTION);
  await expect(
    wizard.daoNext,
    'create-dao step-1 Next did not enable after name/prefix/quantity/description were filled',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const daoTxIds = await clickAndCollectBroadcasts(
    page,
    wizard.daoNext,
    2,
    'create-dao step (issueAsset + setAlias)',
  );
  await wizard.confirmSuccessAlert('create-dao step', daoTxIds);
  await page.waitForURL(/#\/wallet\/dao\/create-dao\/create-team$/, { timeout: DEFAULT_TIMEOUT_MS });

  // ── step 2/4 — the first team ─────────────────────────────────────────────
  await wizard.expectTeamStepActive();
  await expect(
    wizard.teamStep.locator('input[name="teamWallet"]'),
    'the team-wallet field must stay hidden inside the wizard — in-wizard teams are ' +
    'anchored to the creating account, and createTeam() ignores the field on this route',
  ).toHaveCount(0);

  await wizard.fillTeamStep(names, '50', TEAM_DESCRIPTION);
  await expect(
    wizard.teamNext,
    'create-team step Next did not enable after the team form was filled',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const teamTxIds = await clickAndCollectBroadcasts(
    page,
    wizard.teamNext,
    2,
    'create-team step (issueAsset + setAlias)',
  );
  await wizard.confirmSuccessAlert('create-team step', teamTxIds);
  await page.waitForURL(/#\/wallet\/dao\/create-dao\/add-founders$/, { timeout: DEFAULT_TIMEOUT_MS });

  // ── step 3/4 — founders (collected in memory, broadcast on Finish) ────────
  await expect(
    wizard.addFounderButton,
    'add-founders step did not render after the wizard re-mounted at /create-dao/add-founders',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await wizard.addFounder(0, {
    role: names.founderRole,
    address: TEST_ACCOUNT_2_RS,
    allocation: '10',
  });
  await expect(
    wizard.foundersNext,
    'founders step Next stayed disabled with a fully filled founder row',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await wizard.foundersNext.click();
  await page.waitForURL(/#\/wallet\/dao\/create-dao\/add-team-members$/, { timeout: DEFAULT_TIMEOUT_MS });

  // ── step 4/4 — team members (form only; the Finish broadcast is its own test) ──
  await expect(
    wizard.addMemberButton,
    'add-team-members step did not render after the wizard re-mounted at /create-dao/add-team-members',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await wizard.addTeamMember(0, { role: names.memberRole, address: CASH_ACCOUNT_RS });
  await expect(
    wizard.finish,
    'Finish stayed disabled with one valid team-member row — the disabled expression is ' +
    '`membersForm.invalid || (isPending && teamMembers.length > 1)`',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // ── on-chain proof: which primitives the wizard actually used ─────────────
  const daoTxs = await awaitTransactionsConfirmed(request, apiOrigin, daoTxIds, 'create-dao step');
  const teamTxs = await awaitTransactionsConfirmed(request, apiOrigin, teamTxIds, 'create-team step');

  const [daoIssue] = only(daoTxs, ISSUE_ASSET);
  const [daoAlias] = only(daoTxs, SET_ALIAS);
  expect(
    daoIssue,
    'the create-dao step broadcast no issueAsset (type 2/subtype 0) transaction — a DAO is an ' +
    `asset plus an alias, so the DAO token is missing. Broadcast: ${describeTxs(daoTxs)}`,
  ).toBeTruthy();
  expect(
    daoAlias,
    'the create-dao step broadcast no setAlias (type 1/subtype 1) transaction — without it the ' +
    `DAO is invisible to show-daos, which lists DAOs by alias. Broadcast: ${describeTxs(daoTxs)}`,
  ).toBeTruthy();

  expect(daoIssue.attachment.name, 'DAO token was issued under an unexpected asset name').toBe(names.daoAssetName);
  expect(
    daoIssue.attachment.description,
    'the description typed into step 1 did not reach the issueAsset attachment',
  ).toBe(DAO_DESCRIPTION);
  expect(daoIssue.senderRS, 'DAO token was issued by a different account than the logged-in one').toBe(TEST_ACCOUNT_1_RS);
  expect(daoAlias.attachment.alias, 'DAO alias was registered under an unexpected name').toBe(names.daoAliasName);
  expect(
    daoAlias.attachment.uri,
    'DAO alias does not point at the creating account — the UI decodes the root account out of this URI',
  ).toBe(`acct:${TEST_ACCOUNT_1_RS}@xin`);

  const [teamIssue] = only(teamTxs, ISSUE_ASSET);
  const [teamAlias] = only(teamTxs, SET_ALIAS);
  expect(
    teamIssue,
    `the create-team step broadcast no issueAsset transaction. Broadcast: ${describeTxs(teamTxs)}`,
  ).toBeTruthy();
  expect(
    teamAlias,
    `the create-team step broadcast no setAlias transaction. Broadcast: ${describeTxs(teamTxs)}`,
  ).toBeTruthy();
  expect(
    teamIssue.attachment.name,
    'team token name is not built from the DAO *prefix* — createTeam() is passed ' +
    'DaoService.currentDAO.shortcode, not the DAO name',
  ).toBe(names.teamAssetName);
  expect(
    teamIssue.attachment.description,
    'the description typed into step 2 did not reach the team issueAsset attachment',
  ).toBe(TEAM_DESCRIPTION);
  expect(teamAlias.attachment.alias, 'team alias was registered under an unexpected name').toBe(names.teamAliasName);
  expect(
    teamAlias.attachment.uri,
    'the in-wizard team alias must resolve to the creating account — the team-wallet field is ' +
    'hidden on this route, so createAsset() falls back to the issuance senderRS',
  ).toBe(`acct:${TEST_ACCOUNT_1_RS}@xin`);

  // Asset id == issuance tx id; read the tokens back from chain state.
  const daoAsset = await api(request, apiOrigin, { requestType: 'getAsset', asset: daoIssue.transaction });
  expect(daoAsset.errorCode, `getAsset failed for the DAO token: ${JSON.stringify(daoAsset)}`).toBeUndefined();
  expect(daoAsset.name, 'on-chain DAO token name does not match').toBe(names.daoAssetName);
  expect(daoAsset.accountRS, 'the DAO token is not owned by the logged-in account').toBe(TEST_ACCOUNT_1_RS);
  expect(
    String(daoAsset.quantityQNT),
    'DAO token supply is not quantity × 10^decimals — createAsset() scales the entered share ' +
    'count by the hidden decimals field (1)',
  ).toBe('1000');
  expect(daoAsset.decimals, 'DAO token decimals do not match the hidden decimals field').toBe(1);

  const teamAsset = await api(request, apiOrigin, { requestType: 'getAsset', asset: teamIssue.transaction });
  expect(teamAsset.errorCode, `getAsset failed for the team token: ${JSON.stringify(teamAsset)}`).toBeUndefined();
  expect(teamAsset.name, 'on-chain team token name does not match').toBe(names.teamAssetName);
  expect(String(teamAsset.quantityQNT), 'team token supply does not match the entered quantity').toBe('500');
  expect(teamAsset.decimals, 'team token decimals do not match the hidden decimals field').toBe(1);

  const daoAliasOnChain = await api(request, apiOrigin, { requestType: 'getAlias', aliasName: names.daoAliasName });
  expect(daoAliasOnChain.errorCode, `getAlias failed for the DAO alias: ${JSON.stringify(daoAliasOnChain)}`).toBeUndefined();
  expect(daoAliasOnChain.accountRS, 'DAO alias belongs to the wrong account').toBe(TEST_ACCOUNT_1_RS);
  expect(daoAliasOnChain.aliasURI, 'DAO alias URI does not encode the root account').toBe(`acct:${TEST_ACCOUNT_1_RS}@xin`);

  const teamAliasOnChain = await api(request, apiOrigin, { requestType: 'getAlias', aliasName: names.teamAliasName });
  expect(teamAliasOnChain.errorCode, `getAlias failed for the team alias: ${JSON.stringify(teamAliasOnChain)}`).toBeUndefined();
  expect(teamAliasOnChain.accountRS, 'team alias belongs to the wrong account').toBe(TEST_ACCOUNT_1_RS);
  expect(teamAliasOnChain.aliasURI, 'team alias URI does not encode the team account').toBe(`acct:${TEST_ACCOUNT_1_RS}@xin`);

  // ── the DAO is discoverable in show-daos ──────────────────────────────────
  await wizard.expectDaoListed(names.daoName, TEST_ACCOUNT_1_RS);

  created = names;
});

test('approval-accounts: selecting a DAO and team loads the phasing-control form for the team account', async ({
  page,
}) => {
  expect(created, 'the create-dao test did not run, so there is no DAO to configure').toBeTruthy();
  const names = created as DaoWizardNames;

  const teamListPrefix = `DAO${names.daoPrefix}XN`;
  const memberListPrefix = `DAO${names.daoPrefix}XN${names.teamName}XR`;

  await page.goto('#/wallet/dao/approval-accounts');
  const screen = page.locator('app-approval-accounts');
  const selects = screen.locator('select[name="type"]');
  await expect(
    selects,
    'approval-accounts must render exactly the DAO select and the team select',
  ).toHaveCount(2, { timeout: DEFAULT_TIMEOUT_MS });

  const daoSelect = selects.nth(0);
  const teamSelect = selects.nth(1);

  const daoOption = daoSelect.locator(`option[value="${names.daoAliasName}"]`);
  await expect(
    daoOption,
    'the DAO created by the wizard is not offered in approval-accounts — getAccountDaos() ' +
    'filters DAO aliases down to those owned by the logged-in account',
  ).toBeAttached({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    daoOption,
    'the DAO option is not labelled with the plain DAO name — the label comes from ' +
    'getDaoNameFromDAOAlias(getDaoName(aliasName)), which must strip the DAO prefix and the ' +
    'XT shortcode off the alias',
  ).toHaveText(names.daoName);

  // setDao() derives the team list from getAliasesLike(DAO<prefix>XN).
  const teamListCall = awaitApiCall(page, 'getAliasesLike', { aliasPrefix: teamListPrefix });
  await daoSelect.selectOption(names.daoAliasName);
  const teamListBody = await (await teamListCall).json();
  expect(
    (teamListBody.aliases ?? []).map((a: any) => a.aliasName),
    `getAliasesLike(${teamListPrefix}) did not return the team registered by the wizard — the ` +
    'team list in approval-accounts is derived from the DAO prefix, not the DAO name',
  ).toContain(names.teamAliasName);

  const teamOption = teamSelect.locator(`option[value="${names.teamAliasName}"]`);
  await expect(
    teamOption,
    'the team is not offered after picking the DAO',
  ).toBeAttached({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    teamOption,
    'the team option is not labelled with the plain team name — getTeamName() must cut the ' +
    'alias down between the XN and XE markers',
  ).toHaveText(names.teamName);

  // Picking a team resolves the team alias URI back to an account and asks the
  // node for that account's phasing control plus its XR member aliases.
  const phasingCall = awaitApiCall(page, 'getPhasingOnlyControl');
  const memberListCall = awaitApiCall(page, 'getAliasesLike', { aliasPrefix: memberListPrefix });
  await teamSelect.selectOption(names.teamAliasName);

  const phasingResponse = await phasingCall;
  expect(
    queryParams(phasingResponse.url()).get('account'),
    'getPhasingOnlyControl was asked about the wrong account — setTeam() must decode the team ' +
    `alias URI acct:<RS>@xin back to ${TEST_ACCOUNT_1_RS}, the account the in-wizard team is ` +
    'anchored to',
  ).toBe(TEST_ACCOUNT_1_RS);

  const phasing = await phasingResponse.json();
  expect(
    phasing.account,
    'the team account already carries a phasing-only control on this devnet. Every later ' +
    'transaction of the shared test account would then need approval — check whether a previous ' +
    'run clicked Save in approval-accounts, and remove the control before re-running the suite',
  ).toBeUndefined();

  const memberList = await (await memberListCall).json();
  expect(
    memberList.aliases ?? [],
    `getAliasesLike(${memberListPrefix}) returned members for a team whose Finish step never ran ` +
    '— the member list must be empty until addTeamMembers() registers the XR aliases',
  ).toEqual([]);

  // controlDetected === false now (the phasing response is in), so this is the
  // quorum branch and not the "remove approval" one.
  await expect(
    screen.locator('input[name="quorum"]'),
    'the quorum field did not render for a team account without phasing control',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    screen.getByText('Minimum Approval Accounts (Quorum)').first(),
    'approval-accounts did not render the quorum branch for a team account without phasing ' +
    'control — it shows the "Team Account Control is Enabled" branch instead, or the ' +
    'account.control.* i18n keys stopped resolving to English text',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    screen.locator('datatable-body-row'),
    'the approval-account table lists team members although none are registered yet',
  ).toHaveCount(0);

  const save = screen.locator('button.btn-gradient');
  await expect(
    save,
    'the Save button is not labelled with the translated common.save-btn text',
  ).toHaveText('Save');
  await expect(
    save,
    'Save must stay disabled until more approval accounts are ticked than the quorum requires ' +
    '(validateForm(): accounts.length > quorum)',
  ).toBeDisabled();

  await screen.locator('input[name="quorum"]').fill('1');
  await expect(
    save,
    'Save enabled with a quorum of 1 and zero ticked approval accounts — validateForm() no ' +
    'longer compares accounts.length against the quorum',
  ).toBeDisabled();
});

test('create-dao: Finish registers team members as XR aliases and transfers the team and DAO tokens', async ({
  page,
  request,
  baseURL,
}) => {
  // Finish is the widest step: the whole wizard again, then a 6-broadcast
  // collect window (DEFAULT_TIMEOUT_MS * 6) and a 12× confirmation window.
  test.setTimeout(DEFAULT_TIMEOUT_MS * 30);

  const apiOrigin = apiOriginFromBaseURL(baseURL);

  // DaoService.transferTeamTokens() resolves both tokens through
  // `searchAssets`, so the whole Finish step depends on the node's full-text
  // search. While that is broken, clicking Finish throws on `response.assets[0]`
  // inside the map() and silently broadcasts nothing at all.
  const search = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'searchAssets', query: 'DAO*' },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const searchBody = await search.json();
  test.skip(
    searchBody.errorCode !== undefined,
    'node-side searchAssets is broken on this devnet ' +
    `(${searchBody.errorDescription ?? 'errorCode ' + searchBody.errorCode}); ` +
    'DaoService.transferTeamTokens() looks the team and DAO token up through searchAssets, so ' +
    'Finish cannot broadcast anything. This test goes live again once the node returns results.',
  );

  const names = randomDaoNames();
  const wizard = new CreateDaoWizardPage(page);

  await wizard.goto();
  await wizard.fillDaoStep(names, '100', DAO_DESCRIPTION);
  const daoTxIds = await clickAndCollectBroadcasts(page, wizard.daoNext, 2, 'create-dao step (issueAsset + setAlias)');
  await wizard.confirmSuccessAlert('create-dao step', daoTxIds);
  await page.waitForURL(/#\/wallet\/dao\/create-dao\/create-team$/, { timeout: DEFAULT_TIMEOUT_MS });

  await wizard.expectTeamStepActive();
  await wizard.fillTeamStep(names, '50', TEAM_DESCRIPTION);
  const teamTxIds = await clickAndCollectBroadcasts(page, wizard.teamNext, 2, 'create-team step (issueAsset + setAlias)');
  await wizard.confirmSuccessAlert('create-team step', teamTxIds);
  await page.waitForURL(/#\/wallet\/dao\/create-dao\/add-founders$/, { timeout: DEFAULT_TIMEOUT_MS });

  await wizard.addFounder(0, { role: names.founderRole, address: TEST_ACCOUNT_2_RS, allocation: '10' });
  await wizard.foundersNext.click();
  await page.waitForURL(/#\/wallet\/dao\/create-dao\/add-team-members$/, { timeout: DEFAULT_TIMEOUT_MS });

  await wizard.addTeamMember(0, { role: names.memberRole, address: CASH_ACCOUNT_RS });

  // Both tokens must be indexed before Finish — transferTeamTokens() reads them
  // back out of searchAssets rather than out of the issuances it just made.
  const daoTxs = await awaitTransactionsConfirmed(request, apiOrigin, daoTxIds, 'create-dao step');
  const teamTxs = await awaitTransactionsConfirmed(request, apiOrigin, teamTxIds, 'create-team step');
  const [daoIssue] = only(daoTxs, ISSUE_ASSET);
  const [teamIssue] = only(teamTxs, ISSUE_ASSET);
  expect(
    daoIssue,
    `create-dao broadcast no issueAsset transaction. Broadcast: ${describeTxs(daoTxs)}`,
  ).toBeTruthy();
  expect(
    teamIssue,
    `create-team broadcast no issueAsset transaction. Broadcast: ${describeTxs(teamTxs)}`,
  ).toBeTruthy();

  // One setAlias per member (2) + team-token transfer per member (2) + DAO-token
  // transfer per member, since "issue DAO tokens" defaults to on (2).
  const finishTxIds = await clickAndCollectBroadcasts(
    page,
    wizard.finish,
    6,
    'Finish (2 setAlias + 4 transferAsset)',
    DEFAULT_TIMEOUT_MS * 6,
  );
  await wizard.confirmSuccessAlert('Finish', finishTxIds, DEFAULT_TIMEOUT_MS * 6);
  await page.waitForURL(/#\/wallet\/dao\/show-daos/, { timeout: DEFAULT_TIMEOUT_MS });

  const finishTxs = await awaitTransactionsConfirmed(
    request, apiOrigin, finishTxIds, 'Finish', DEFAULT_TIMEOUT_MS * 12,
  );

  const registeredAliases = only(finishTxs, SET_ALIAS).map((tx) => tx.attachment.alias);
  expect(
    registeredAliases.sort(),
    'Finish did not register one XR alias per team member — membership is expressed purely ' +
    `as an alias whose name embeds the role and whose URI is the member account. Broadcast: ${describeTxs(finishTxs)}`,
  ).toEqual([teamMemberAliasName(names, names.founderRole), teamMemberAliasName(names, names.memberRole)].sort());

  const transfers = only(finishTxs, TRANSFER_ASSET);
  expect(
    transfers.length,
    `Finish did not transfer the team and DAO token to every member. Broadcast: ${describeTxs(finishTxs)}`,
  ).toBe(4);
  expect(
    transfers
      .filter((tx) => tx.recipientRS === TEST_ACCOUNT_2_RS)
      .map((tx) => String(tx.attachment.asset))
      .sort(),
    'the founder did not receive exactly the team token and the DAO token — the "issue DAO ' +
    'tokens" checkbox defaults to on, so each member gets both',
  ).toEqual([String(teamIssue.transaction), String(daoIssue.transaction)].sort());

  const founderAlias = await api(request, apiOrigin, {
    requestType: 'getAlias',
    aliasName: teamMemberAliasName(names, names.founderRole),
  });
  expect(founderAlias.errorCode, `getAlias failed for the founder alias: ${JSON.stringify(founderAlias)}`).toBeUndefined();
  expect(
    founderAlias.aliasURI,
    'the founder alias does not resolve to the founder account',
  ).toBe(`acct:${TEST_ACCOUNT_2_RS}@xin`);

  const founderAssets = await api(request, apiOrigin, {
    requestType: 'getAccountAssets',
    account: TEST_ACCOUNT_2_ID,
  });
  const held = (founderAssets.accountAssets ?? []).map((a: any) => a.asset);
  expect(
    held,
    'the founder holds no team token after Finish — the allocation transfer never landed',
  ).toContain(teamIssue.transaction);
});

test('approval-accounts: saving phasing control for a team account', async () => {
  test.skip(
    true,
    'Not exercised on purpose. Inside the create-dao wizard the team-wallet field is hidden, so ' +
    'the team alias points at the logged-in account itself — clicking Save would call ' +
    'setPhasingOnlyControl on TEST_ACCOUNT_1 and put every later transaction of the shared ' +
    'devnet account behind approval, breaking the rest of the suite. Covering it needs a ' +
    'dedicated throwaway account as the team wallet.',
  );
});
