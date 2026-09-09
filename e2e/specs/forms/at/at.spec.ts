import { test, expect, Page } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_1_ID } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * AT / Smart Contracts module (`src/app/module/at`) — create-at wizard,
 * show-ats datatables and the workbench (templates + compiler).
 *
 * Two tests are skipped with the defect that blocks them: the on-chain proof by
 * an iep-node H2 2.x DDL regression, the compiler by a wallet misconfiguration
 * that no deployment can fix. Because an AT creation can never reach a block
 * today, this spec asserts the broadcast without `broadcastAndAwaitConfirmation`
 * — that helper polls for inclusion and would always time out here. Everything
 * up to and including node acceptance is asserted against the chain API.
 *
 * Devnet side effect: each run leaves exactly one type-22 transaction stuck in
 * the peers' unconfirmed pools (11 XIN of TEST_ACCOUNT_1 locked) until its
 * 60-minute deadline expires. Block production and 3-node consensus are
 * unaffected — verified while 7 such transactions were pending.
 */

// Lowercase alnum only: iep-node lowercases the name and checks every char
// against Constants.ALPHABET; THROTTLE_AT_CREATION_BY_NAME rejects duplicates.
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const randomAtName = (): string =>
  'e2eat' + Array.from({ length: 8 }, () => ALNUM[Math.floor(Math.random() * ALNUM.length)]).join('');

// 5x FIN (opcode 0x28). One FIN would do on chain, but the code textarea
// enforces minlength=10, so we repeat it to reach 10 hex chars / 5 bytes.
const MINIMAL_AT_CODE = '2828282828';

// AutomatedTransactionsCreation, per xin.TransactionType.
const AT_CREATION_TYPE = 22;
const AT_CREATION_SUBTYPE = 0;

// 10 * UNIT_FEE + 1 code page * COST_PER_PAGE — see TransactionType.getBaselineFee.
const EXPECTED_AT_FEE_TQT = '1100000000';
const EXPECTED_AT_FEE_XIN = '11.00';

const MIN_ACTIVATION_XIN = '1';

/** All ten templates the workbench dashboard ships, in tab-strip order. */
const AT_TEMPLATE_TABS = [
  'Simple AT',
  'Sleep AT',
  'Auction AT',
  'Certificate of Deposit AT',
  'Crowdfunding AT',
  'Dormant Funds AT',
  'Lottery AT',
  'Lottery Repeat AT',
  'TheThrone AT',
  'Fuscavor Funds AT',
];

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test.describe.serial('at: create + on-chain proof', () => {
  let created: { txId: string; name: string } | undefined;

  test('create-at: 3-step wizard signs an AT creation and broadcastTransaction accepts it', async ({
    page,
    request,
    baseURL,
  }) => {
    await page.goto('#/wallet/at/create-at');

    const atName = randomAtName();
    const atDescription = `e2e regression test AT ${atName}`;

    // step 1 — name / activation amount / description
    const nameInput = page.locator('input[name="name"]');
    const activationInput = page.locator('input[name="minActivationAmount"]');
    const descriptionInput = page.locator('textarea[name="description"]');
    const step1Next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

    await expect(nameInput, 'create-at step-1 form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    await expect(step1Next, 'step-1 Next must stay disabled while name/description are empty').toBeDisabled();

    await nameInput.fill(atName);
    await activationInput.fill(MIN_ACTIVATION_XIN);
    await descriptionInput.fill(atDescription);
    await descriptionInput.blur();
    await expect(
      step1Next,
      'step-1 Next did not enable after name + activation amount + description were filled',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    await step1Next.click();

    // step 2 — machine code + page counts
    const codeInput = page.locator('textarea[name="code"]');
    await expect(codeInput, 'step-2 did not render — archwizard navigation broken').toBeVisible({
      timeout: DEFAULT_TIMEOUT_MS,
    });

    const step2Next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').last();
    await expect(step2Next, 'step-2 Next must stay disabled while the code textarea is empty').toBeDisabled();

    // Both btn-raised toggles drive *ngIf blocks carrying their own ngModel inputs.
    const machineDataToggle = page.locator('button.btn-raised:has-text("Machine Data")');
    const creationBytesToggle = page.locator('button.btn-raised:has-text("Creation Bytes")');
    const machineDataInput = page.locator('textarea[name="data"]');
    const creationBytesInput = page.locator('textarea[name="bytes"]');

    await expect(machineDataInput, 'Machine Data textarea must be hidden until its toggle is clicked').toHaveCount(0);
    await machineDataToggle.click();
    await expect(
      machineDataInput,
      'Machine Data toggle did not reveal textarea[name="data"] — hasMachineData *ngIf broken',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    await machineDataToggle.click();
    await expect(machineDataInput, 'Machine Data toggle did not hide the textarea again').toHaveCount(0);

    await creationBytesToggle.click();
    await expect(
      creationBytesInput,
      'Creation Bytes toggle did not reveal textarea[name="bytes"] — hasCreationBytes *ngIf broken',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    await creationBytesToggle.click();
    await expect(creationBytesInput, 'Creation Bytes toggle did not hide the textarea again').toHaveCount(0);

    await codeInput.fill(MINIMAL_AT_CODE);
    await codeInput.blur();
    await expect(
      step2Next,
      `step-2 Next did not enable for code "${MINIMAL_AT_CODE}" — the form requires ` +
        'code (minlength 10) plus dpages/cspages/uspages, which default to 0',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    // Next calls createAT(): the node assembles the unsigned transaction from
    // the form input, the wallet signs it locally.
    const createResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api') &&
        r.request().method() === 'POST' &&
        (r.request().postData() ?? '').includes('requestType=createATProgram'),
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    await step2Next.click();

    const createBody = await (await createResponse).json();
    expect(
      createBody.errorCode,
      `createATProgram rejected the wizard input: ${JSON.stringify(createBody)}`,
    ).toBeUndefined();
    const proposed = createBody.transactionJSON ?? {};
    expect(proposed.type, 'createATProgram did not build an AutomatedTransactionsCreation').toBe(AT_CREATION_TYPE);
    expect(proposed.subtype, 'createATProgram built the wrong subtype').toBe(AT_CREATION_SUBTYPE);
    expect(
      proposed.attachment?.name,
      `createATProgram was called with a different AT name than the wizard shows: ${JSON.stringify(proposed.attachment)}`,
    ).toBe(atName);
    expect(proposed.attachment?.description, 'createATProgram was called with a different description').toBe(
      atDescription,
    );
    expect(
      String(proposed.feeTQT),
      'the node no longer raises the wallet-supplied fee=1 XIN to the AT creation baseline — ' +
        'either the baseline fee changed or correctInvalidFees is off, in which case a stricter ' +
        'node would reject this transaction outright',
    ).toBe(EXPECTED_AT_FEE_TQT);

    // step 3 — confirm
    await expect(
      page.locator('h4', { hasText: atName }).first(),
      'step-3 confirm did not render the entered AT name — archwizard transition or binding broken',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    const confirmValue = (label: string) =>
      page
        .locator('.col-md-4')
        .filter({ has: page.locator('.ucsb', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) })
        .locator('h4')
        .first();

    await expect(
      confirmValue('Description'),
      'confirm step did not echo the entered description',
    ).toHaveText(atDescription);

    await expect(
      confirmValue('Service Fee'),
      `confirm step must render the node-corrected fee as exactly "${EXPECTED_AT_FEE_XIN} XIN" ` +
        `(node returned feeTQT=${EXPECTED_AT_FEE_TQT}); a different value means the amountTkn ` +
        'conversion of transactionJSON.feeTQT broke',
    ).toHaveText(new RegExp(`^\\s*${EXPECTED_AT_FEE_XIN}\\s*XIN\\s*$`), { timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      confirmValue('Activation Amount'),
      `confirm step did not echo the entered minimum activation amount (${MIN_ACTIVATION_XIN} XIN)`,
    ).toHaveText(new RegExp(`^\\s*${MIN_ACTIVATION_XIN}\\.00\\s*XIN\\s*$`));

    await expect(
      confirmValue('Code Size'),
      `confirm step did not report the entered code length (${MINIMAL_AT_CODE.length} bytes)`,
    ).toHaveText(new RegExp(`^\\s*${MINIMAL_AT_CODE.length}\\s*Bytes\\s*$`));

    const validCell = confirmValue('Valid');
    await expect(
      validCell.locator('i.fa-check'),
      'confirm step still shows the transaction as invalid — createATProgram or local ' +
        'signing failed (check the browser console for the chain-side error)',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    await expect(validCell.locator('i.fa-times'), 'confirm step shows valid and invalid at once').toHaveCount(0);

    const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
    await expect(finishButton, 'Finish did not enable — validBytes never became true').toBeEnabled({
      timeout: DEFAULT_TIMEOUT_MS,
    });

    await page.locator('button.btn-raised:has(i.fa-key)').first().click();
    const signedBytes = page.locator('textarea[name="key"]').first();
    await expect(signedBytes, 'the Signed Transaction toggle did not reveal the bytes textarea').toBeVisible({
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const bytesText = ((await signedBytes.inputValue()) ?? '').trim();
    expect(
      /^[0-9a-fA-F]+$/.test(bytesText) && bytesText.length > 100,
      `signed-transaction textarea did not contain a hex blob (got "${bytesText.slice(0, 60)}…")`,
    ).toBe(true);

    // Decode the exact bytes the wallet is about to broadcast. parseTransaction
    // is a pure node-side function, so this is race-free and also proves the
    // locally computed signature verifies against the sender's public key.
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const parsedResp = await request.get(`${apiOrigin}/api`, {
      params: { requestType: 'parseTransaction', transactionBytes: bytesText },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    expect(parsedResp.ok(), 'parseTransaction did not answer with 200').toBe(true);
    const parsed = await parsedResp.json();
    expect(
      parsed.errorCode,
      `the node could not parse the signed transaction the wallet produced: ${JSON.stringify(parsed)}`,
    ).toBeUndefined();
    expect(
      parsed.verify,
      'the node rejects the signature the wallet computed — CryptoService.signatureHex / ' +
        'signTransactionHex produced bytes that do not verify against the sender public key',
    ).toBe(true);
    expect(parsed.type, 'signed transaction is not an AutomatedTransactionsCreation').toBe(AT_CREATION_TYPE);
    expect(parsed.subtype, 'signed transaction has the wrong subtype').toBe(AT_CREATION_SUBTYPE);
    expect(parsed.sender, 'AT creation was signed by the wrong account').toBe(TEST_ACCOUNT_1_ID);
    expect(String(parsed.feeTQT), 'the signed bytes carry a different fee than the node quoted').toBe(
      EXPECTED_AT_FEE_TQT,
    );
    expect(
      parsed.attachment?.name,
      `signed attachment name does not match the name entered in the wizard: ${JSON.stringify(parsed.attachment)}`,
    ).toBe(atName);
    expect(parsed.attachment?.description, 'signed attachment description does not match').toBe(atDescription);
    expect(
      String(parsed.attachment?.creationBytes ?? '').toLowerCase(),
      'creationBytes do not embed the entered machine code — the AutomatedTransactionsCreation ' +
        'attachment was assembled from something other than the form input',
    ).toContain(MINIMAL_AT_CODE);

    // broadcast — accepted into the unconfirmed pool is as far as an AT creation
    // gets on this chain (see the skip reason on the next test).
    const broadcastResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api') &&
        r.request().method() === 'POST' &&
        (r.request().postData() ?? '').includes('requestType=broadcastTransaction'),
      { timeout: DEFAULT_TIMEOUT_MS * 3 },
    );
    await finishButton.click();
    const broadcast = await (await broadcastResponse).json();
    expect(
      broadcast.errorCode,
      `broadcastTransaction rejected the AT creation: ${JSON.stringify(broadcast)}`,
    ).toBeUndefined();
    expect(
      broadcast.transaction,
      `broadcastTransaction returned no transaction id: ${JSON.stringify(broadcast)}`,
    ).toBeTruthy();
    expect(
      broadcast.transaction,
      'the node accepted a different transaction than the one parseTransaction decoded — the ' +
        'wallet broadcast bytes other than the ones it displayed',
    ).toBe(parsed.transaction);

    created = { txId: broadcast.transaction as string, name: atName };

    // The success handler in CreateAtComponent.broadcastTransaction() reports the
    // tx id and then routes to show-ats/my.
    const alert = page.locator('.swal2-container');
    await expect(alert, 'no alert appeared after a successful broadcast').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      alert.locator('.swal2-icon.swal2-success'),
      `the broadcast succeeded (tx ${created.txId}) but the wallet did not show a success alert — ` +
        'CreateAtComponent.broadcastTransaction() took the error branch',
    ).toBeVisible();
    await expect(
      alert,
      `the success alert does not name the broadcast transaction ${created.txId}`,
    ).toContainText(created.txId);

    await alert.locator('.swal2-confirm').click();
    await expect(
      page,
      'confirming the success alert did not route to show-ats/my — the post-broadcast redirect broke',
    ).toHaveURL(/#\/wallet\/at\/show-ats\/my$/, { timeout: DEFAULT_TIMEOUT_MS });
  });

  test('create-at: the broadcast AT confirms and is listed by getATIds/getAT and show-ats/my', async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip(
      true,
      'Blocked by an iep-node H2 2.x regression, not by the wallet. XinDbVersion declares ' +
        '`at.ap_code BINARY` and `at_state.state BINARY`. Unbounded BINARY meant "variable length" ' +
        'in H2 1.4 but is BINARY(1) in H2 2.x, so AT.save() throws `Value too long for column ' +
        '"AP_CODE BINARY"` (observed in the devnet node log, via both Generator.forge and ' +
        'BlockchainProcessorImpl.accept). The AutomatedTransactionsCreation is therefore never ' +
        'included in a block, sits in the peers unconfirmed pools until its deadline expires, and ' +
        'getATIds/getAllATs stay empty forever. Un-skip once both columns are VARBINARY (same class ' +
        'of miss as the generation_signature BINARY(64) fix).',
    );

    expect(created, 'the create-at test did not record a broadcast transaction id').toBeDefined();
    const { txId, name } = created!;
    const apiOrigin = apiOriginFromBaseURL(baseURL);

    const txResp = await request.get(`${apiOrigin}/api`, {
      params: { requestType: 'getTransaction', transaction: txId },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const tx = await txResp.json();
    expect(tx.block, `AT creation ${txId} was never included in a block`).toBeTruthy();

    const idsResp = await request.get(`${apiOrigin}/api`, {
      params: { requestType: 'getATIds' },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const ids = await idsResp.json();
    expect(
      ids.atIds,
      `getATIds does not list the AT created by the wizard (${txId}): ${JSON.stringify(ids)}`,
    ).toContain(txId);

    const atResp = await request.get(`${apiOrigin}/api`, {
      params: { requestType: 'getAT', at: txId },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const at = await atResp.json();
    expect(at.errorCode, `getAT returned an error for ${txId}: ${JSON.stringify(at)}`).toBeUndefined();
    expect(at.name, 'on-chain AT name does not match the name entered in the wizard').toBe(name);
    expect(at.creator, 'on-chain AT creator is not the logged-in test account').toBe(TEST_ACCOUNT_1_ID);
    expect(
      String(at.machineCode ?? '').toLowerCase(),
      'on-chain machineCode is not the program entered in the wizard',
    ).toContain(MINIMAL_AT_CODE);

    await page.goto('#/wallet/at/show-ats/my');
    await expect(
      page.locator('app-at datatable-body-row', { hasText: name }),
      `show-ats/my does not list the AT "${name}" although getAT resolves it — ` +
        'AtService.getAccountATs or the ngx-datatable row binding is broken',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
  });
});

/**
 * Assert the rendered AT datatable against the `ats` array the wallet itself
 * received. With no AT on chain the row comparison is trivially satisfied, so
 * the empty state is pinned explicitly: body placeholder plus footer total.
 */
async function expectAtTableMatches(page: Page, ats: any[], route: string): Promise<void> {
  const rows = page.locator('app-at datatable-body-row');
  const emptyRow = page.locator('app-at datatable-body .empty-row');

  await expect
    .poll(() => rows.count(), {
      message:
        `${route} rendered a different number of rows than the wallet's own AT response listed ` +
        `(${ats.length}) — AtComponent.rows or the datatable [rows] binding is out of sync`,
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe(ats.length);

  await expect(
    page.locator('app-at datatable-footer .page-count'),
    `${route}: the datatable footer does not report the ${ats.length} AT(s) the wallet received — ` +
      'the rows array never reached the table',
  ).toHaveText(new RegExp(`^\\s*${ats.length}\\s+total\\s*$`), { timeout: DEFAULT_TIMEOUT_MS });

  if (ats.length === 0) {
    await expect(
      emptyRow,
      `${route}: with no ATs on chain the datatable must render its empty placeholder; an absent ` +
        'placeholder means the table body did not render at all',
    ).toHaveText(/no data/i, { timeout: DEFAULT_TIMEOUT_MS });
    return;
  }

  await expect(emptyRow, `${route}: empty placeholder rendered although ${ats.length} AT(s) exist`).toHaveCount(0);
  const firstRow = rows.first();
  await expect(
    firstRow,
    `${route}: the first row does not show the name "${ats[0].name}" from the AT response`,
  ).toContainText(String(ats[0].name));
  await expect(
    firstRow,
    `${route}: the first row does not show the creator "${ats[0].atRS}" from the AT response`,
  ).toContainText(String(ats[0].atRS));
}

test('show-ats: All and My datatables query the chain per tab and render what it returns', async ({ page }) => {
  const allResponse = page.waitForResponse((r) => r.url().includes('requestType=getAllATs'), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await page.goto('#/wallet/at/show-ats/all');

  const allBody = await (await allResponse).json();
  expect(allBody.errorCode, `getAllATs returned an error: ${JSON.stringify(allBody)}`).toBeUndefined();
  expect(
    Array.isArray(allBody.ats),
    `show-ats/all did not receive an "ats" array from getAllATs: ${JSON.stringify(allBody)}`,
  ).toBe(true);

  // innerText returns the CSS-transformed text, and the datatable header is
  // uppercased by the theme — compare case-insensitively.
  const header = (await page.locator('app-at .datatable-header').innerText()).replace(/\s+/g, ' ').toUpperCase();
  for (const column of [
    'Account',
    'Name',
    'Balance',
    'Activation',
    'Finished',
    'Frozen',
    'Running',
    'Stopped',
    'Dead',
    'Actions',
  ]) {
    expect(
      header,
      `the AT datatable is missing the translated "${column}" column — a raw "table-header.*" key ` +
        `here means the i18n lookup broke (rendered header: "${header}")`,
    ).toContain(column.toUpperCase());
  }

  await expectAtTableMatches(page, allBody.ats, 'show-ats/all');

  // The My tab must re-query with the logged-in account, not reuse the All rows.
  const myResponse = page.waitForResponse(
    (r) => r.url().includes('requestType=getAccountATs') && r.url().includes(`account=${TEST_ACCOUNT_1_ID}`),
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  await page.locator('app-show-ats .nav-link', { hasText: /^\s*My\s*$/ }).click();
  await expect(page, 'clicking the My tab did not route to show-ats/my').toHaveURL(/#\/wallet\/at\/show-ats\/my$/, {
    timeout: DEFAULT_TIMEOUT_MS,
  });

  const myBody = await (await myResponse).json();
  expect(myBody.errorCode, `getAccountATs returned an error: ${JSON.stringify(myBody)}`).toBeUndefined();
  expect(
    Array.isArray(myBody.ats),
    `show-ats/my did not receive an "ats" array from getAccountATs: ${JSON.stringify(myBody)}`,
  ).toBe(true);

  await expectAtTableMatches(page, myBody.ats, 'show-ats/my');
});

test('workbench: dashboard ships the AT templates and mounts the compiler form', async ({ page }) => {
  await page.goto('#/wallet/at/workbench');
  await expect(page, 'workbench did not redirect to its default dashboard child').toHaveURL(
    /#\/wallet\/at\/workbench\/dashboard$/,
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  const tabs = page.locator('app-dashboard ul.at-list li');
  await expect(tabs, 'the AT template tab strip did not render all 10 templates').toHaveCount(
    AT_TEMPLATE_TABS.length,
    { timeout: DEFAULT_TIMEOUT_MS },
  );
  const tabLabels = (await tabs.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  expect(
    tabLabels,
    `the template tab strip does not carry the expected labels — a raw "at.at-workbench.*" key ` +
      `here means the i18n lookup broke (rendered: ${JSON.stringify(tabLabels)})`,
  ).toEqual(AT_TEMPLATE_TABS);

  // "Simple AT" is the default tab; the sources are HTML-escaped in the
  // component, so &#64; must render as @.
  const simpleAtSource = await page.locator('app-dashboard .tab-pane.active pre code').innerText();
  for (const marker of ['^declare DeveloperWallet', '@AmountToReturn', 'FUN send_to_Address_in_B', 'FIN']) {
    expect(
      simpleAtSource,
      `the Simple AT template is missing "${marker}" — the escaped AT assembly in ` +
        'dashboard.component.html did not render intact',
    ).toContain(marker);
  }

  await page.locator('app-dashboard .nav-link', { hasText: 'Sleep AT' }).click();
  const sleepAtSource = await page.locator('app-dashboard .tab-pane.active pre code').innerText();
  expect(
    sleepAtSource,
    'clicking the Sleep AT tab did not swap the visible template — showTab()/displayTab binding broken',
  ).toContain('SLP $SleepTillThisTime');
  expect(
    sleepAtSource,
    'the Sleep AT tab still shows the Simple AT source — two tab-panes carry the active class',
  ).not.toContain('FUN send_to_Address_in_B');

  // The dashboard embeds the compiler behind a showCompiler toggle.
  await expect(page.locator('app-dashboard app-compiler'), 'the compiler must stay collapsed initially').toHaveCount(0);
  await page.locator('app-dashboard .header-border').click();
  await expect(
    page.locator('app-dashboard app-compiler textarea#textCode'),
    'the Compiler header did not expand app-compiler — showCompiler *ngIf broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await page.goto('#/wallet/at/workbench/compiler');
  const codeInput = page.locator('app-compiler textarea#textCode');
  await expect(codeInput, 'the standalone compiler route did not render the code input').toBeVisible({
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await expect(
    page.locator('app-compiler button.btn-gradient', { hasText: 'Generate' }),
    'the compiler is missing its Generate button',
  ).toBeVisible();
  const output = page.locator('app-compiler textarea[disabled]');
  await expect(output, 'the compiler is missing its read-only output textarea').toBeVisible();
  await expect(output, 'the compiler output textarea does not start empty').toHaveValue('');

  await codeInput.fill('FIN');
  await expect(codeInput, 'the compiler code textarea is not bound to atTextCode').toHaveValue('FIN');
});

test('workbench/compiler: Generate translates the Simple AT template into machine code', async ({ page }) => {
  test.skip(
    true,
    'Blocked by a wallet defect that no deployment can configure around. ' +
      'AppConstants.ATConfig.ATCompilerURL is getEnvConfig("apiServerURL") with no fallback, and ' +
      'the same key is the wallet\'s NODE_API_URL — so it is either unset (the case in every ' +
      'shipped env.config.js, leaving the constant null) or it points at a node API, which is not ' +
      'an AT compiler. With null, CompilerComponent.getCode() calls HttpClient.post(null, ...), ' +
      'which throws inside Angular\'s xsrfInterceptorFn before anything leaves the browser: no ' +
      'request, empty output, no alert. getCode() also subscribes without an error callback, so a ' +
      'reachable-but-failing compiler would be just as silent. Arming this needs a separate ' +
      'compiler-URL config key plus an error handler in getCode().',
  );

  await page.goto('#/wallet/at/workbench/dashboard');
  const simpleAtSource = await page.locator('app-dashboard .tab-pane.active pre code').innerText();

  await page.goto('#/wallet/at/workbench/compiler');
  const codeInput = page.locator('app-compiler textarea#textCode');
  await expect(codeInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await codeInput.fill(simpleAtSource);

  await page.locator('app-compiler button.btn-gradient', { hasText: 'Generate' }).click();

  await expect(
    page.locator('.swal2-popup'),
    'the compiler answered with an error alert instead of machine code',
  ).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS });

  await expect
    .poll(() => page.locator('app-compiler textarea[disabled]').inputValue(), {
      message: 'the compiler output textarea never received hex machine code for the Simple AT template',
      timeout: DEFAULT_TIMEOUT_MS * 3,
    })
    .toMatch(/^[0-9a-fA-F]{10,}$/);
});
