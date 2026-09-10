import { test, expect, AlertLog } from '../../../fixtures/test';
import { Page, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Alias mutations — the three row actions under `#/wallet/aliases/show-alias/`
 * that change an alias the account already owns: transfer, edit, delete.
 *
 * create-alias.spec.ts covers registering one and alias-trading.spec.ts covers
 * selling it. What is left is the part where a wrong subtype or a wrong
 * attachment field silently destroys property:
 *   transfer → ALIAS_SELL (6) with priceTQT 0 + recipient → Alias.changeOwner
 *   edit     → ALIAS_ASSIGNMENT (1) re-issued over the same name
 *   delete   → ALIAS_DELETE (8), the alias stops existing
 * A transfer that keeps a positive price only publishes a sell offer, an edit
 * that composes the URI wrong points the alias at the wrong resource, and each
 * form hands its subject over as queryParams from the row click — a lost param
 * renders a plausible page about the wrong alias.
 *
 * Registering the alias under test is API setup; every mutation goes through
 * the UI and is then read back from the node. Names are unique per run.
 */

const TQT_PER_XIN = 100_000_000;
const SETUP_FEE_TQT = '100000000';
const CONFIRM_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 150_000;

/** Chain rule (errorCode 4): alias names carry only digits and Latin letters. */
const uniqueTag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function getAliasBody(
  request: APIRequestContext,
  apiOrigin: string,
  aliasName: string,
): Promise<any> {
  const resp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAlias', aliasName },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  return resp.json();
}

/** Owner in RS form, or `unknown (errorCode N)` when the chain has no such alias. */
async function aliasState(
  request: APIRequestContext,
  apiOrigin: string,
  aliasName: string,
): Promise<string> {
  const body = await getAliasBody(request, apiOrigin, aliasName);
  return body.accountRS ?? `unknown (errorCode ${body.errorCode})`;
}

async function aliasUri(
  request: APIRequestContext,
  apiOrigin: string,
  aliasName: string,
): Promise<string> {
  const body = await getAliasBody(request, apiOrigin, aliasName);
  return body.aliasURI ?? `unknown (errorCode ${body.errorCode})`;
}

/** Setup only — the mutation under test is the one driven through the UI. */
async function registerAlias(
  request: APIRequestContext,
  apiOrigin: string,
  aliasName: string,
  aliasURI: string,
): Promise<void> {
  const resp = await request.post(`${apiOrigin}/api`, {
    form: {
      requestType: 'setAlias',
      aliasName,
      aliasURI,
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      feeTQT: SETUP_FEE_TQT,
      deadline: '1440',
      broadcast: 'true',
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const created = await resp.json();
  expect(
    created.transaction,
    `setAlias setup for ${aliasName} was refused: ${JSON.stringify(created)}`,
  ).toBeTruthy();

  await expect
    .poll(() => aliasState(request, apiOrigin, aliasName), {
      message: `setAlias tx ${created.transaction} never confirmed — devnet forging stalled`,
      timeout: CONFIRM_TIMEOUT_MS,
    })
    .toBe(TEST_ACCOUNT_1_RS);
}

const aliasRow = (page: Page, aliasName: string) =>
  page.locator('app-show-alias datatable-body-row').filter({ hasText: aliasName });

/** show-alias → search for the alias → the named row action on its row. */
async function openRowAction(
  page: Page,
  aliasName: string,
  icon: string,
  form: 'transfer-alias' | 'edit-alias' | 'delete-alias',
): Promise<void> {
  await page.goto('#/wallet/aliases/show-alias');

  const search = page.locator('app-show-alias input.input-search');
  await expect(search, 'show-alias did not mount its alias search field').toBeVisible({
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await search.fill(aliasName);

  const row = aliasRow(page, aliasName);
  await expect(
    row,
    `searching show-alias for ${aliasName} produced no row — the (input) handler or the ` +
      'getAliasesLike wiring behind it is broken',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

  await row.locator(`a.btn:has(i.${icon})`).click();
  await expect(
    page,
    `the ${form} action on the alias row did not open show-alias/${form}`,
  ).toHaveURL(new RegExp(`#\\/(wallet\\/)?aliases\\/show-alias\\/${form}\\?`), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
}

/** The confirm step's fee figure — the only `<h4>` carrying a `<small>` unit. */
const serviceFee = (page: Page, host: string) =>
  page.locator(`${host} h4:has(small)`).filter({ hasText: 'XIN' });

/** Read the quoted fee back as TQT. Only meaningful once signing populated `tx_fee`. */
async function readQuotedFeeTqt(page: Page, host: string): Promise<number> {
  const shown = await serviceFee(page, host).innerText();
  const xin = Number.parseFloat(shown.replace(/[^0-9.]/g, ''));
  expect(
    xin,
    `${host} quotes "${shown}" as the service fee — the confirm step shows no usable figure, so ` +
      'the user signs without knowing what the transaction costs',
  ).toBeGreaterThan(0);
  return Math.round(xin * TQT_PER_XIN);
}

async function expectSuccessAndReturn(page: Page, alerts: AlertLog, what: string): Promise<void> {
  await expect
    .poll(() => alerts.last()?.kind, {
      message: `the wallet raised no success dialog after broadcasting the ${what}`,
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe('success');

  await expect(
    page,
    `the wallet did not return to the alias list after the ${what} was broadcast`,
  ).toHaveURL(/#\/(wallet\/)?aliases\/show-alias(?!\/)/, { timeout: DEFAULT_TIMEOUT_MS });
}

test.describe('aliases: mutations', () => {
  test.beforeEach(async ({ page }) => {
    const welcome = new WelcomePage(page);
    const dashboard = new DashboardPage(page);
    await welcome.goto();
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await dashboard.expectVisible();
  });

  test('alias-mutations: transfer-alias moves ownership to the named recipient', async ({
    page,
    request,
    baseURL,
    infoAlerts,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const aliasName = `e2emvt${uniqueTag()}`;
    const aliasURI = `acct:${TEST_ACCOUNT_1_RS}@xin`;

    await registerAlias(request, apiOrigin, aliasName, aliasURI);
    await openRowAction(page, aliasName, 'fa-user', 'transfer-alias');

    const host = 'app-transfer-alias';
    const details = page.locator(`${host} h6`);
    await expect(
      details.first(),
      'transfer-alias shows the wrong alias — the alias never reached it through the row click ' +
        'queryParams, so the transfer would give away a different name',
    ).toHaveText(aliasName);
    await expect(details.nth(1), 'transfer-alias shows the wrong URI for the alias').toHaveText(
      aliasURI,
    );

    const next = page.locator(`${host} button.btn-primary:has(i.fa-chevron-right)`);
    await expect(
      next,
      'Next is enabled on an empty transfer form — the recipient field lost its `required` ' +
        'validator, and a transfer without a recipient is refused by the chain',
    ).toBeDisabled();

    const recipient = page.locator(`${host} input[name="recipientRS"]`);
    await recipient.fill(TEST_ACCOUNT_2_RS);
    await recipient.blur();
    await expect(next, 'Next did not enable after a valid recipient was entered').toBeEnabled({
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await next.click();

    await expect(
      page.locator(`${host} h4`).filter({ hasText: TEST_ACCOUNT_2_RS }),
      'the confirm step does not name the recipient the form was filled with — the user would ' +
        'sign away the alias without seeing where it goes',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    const finish = page.locator(`${host} button.btn-primary:has(i.fa-check)`);
    await expect(
      finish,
      'Finish stayed disabled — transferAlias() got no signable unsigned bytes back, so the ' +
        'chain rejected the ALIAS_SELL or the local signing step failed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      serviceFee(page, host),
      'transfer-alias quotes a fee other than the 1.00 XIN the form hardcodes',
    ).toContainText('1.00');
    const quotedFeeTqt = await readQuotedFeeTqt(page, host);

    const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finish);
    expect(tx.subtype, 'a transfer must ride on ALIAS_SELL (subtype 6)').toBe(6);
    expect(
      Number(tx.attachment?.priceTQT),
      `a transfer must carry priceTQT 0, not ${tx.attachment?.priceTQT} — any positive price ` +
        'only publishes a sell offer and leaves the alias with the sender',
    ).toBe(0);
    expect(
      tx.recipientRS,
      'the transfer names the wrong new owner — the alias went to an account the user never typed',
    ).toBe(TEST_ACCOUNT_2_RS);
    expect(
      String(tx.feeTQT),
      `the transfer cost ${tx.feeTQT} TQT although the confirm step quoted ${quotedFeeTqt} TQT — ` +
        'the fee the user approved is not the fee the chain took',
    ).toBe(String(quotedFeeTqt));

    await expectSuccessAndReturn(page, infoAlerts, 'transfer');

    await expect
      .poll(() => aliasState(request, apiOrigin, aliasName), {
        message:
          `${aliasName} did not change hands — the transfer confirmed but getAlias still reports ` +
          'the old owner',
        timeout: CONFIRM_TIMEOUT_MS,
      })
      .toBe(TEST_ACCOUNT_2_RS);
  });

  test('alias-mutations: edit-alias rewrites the URI on chain and keeps the owner', async ({
    page,
    request,
    baseURL,
    infoAlerts,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const tag = uniqueTag();
    const aliasName = `e2emve${tag}`;
    const originalURI = `acct:${TEST_ACCOUNT_1_RS}@xin`;
    const newBody = `e2e${tag}.example.com`;
    const newURI = `url:${newBody}@xin`;

    await registerAlias(request, apiOrigin, aliasName, originalURI);
    await openRowAction(page, aliasName, 'fa-pencil-square-o', 'edit-alias');

    const host = 'app-edit-alias';
    const details = page.locator(`${host} h6`);
    await expect(
      details.first(),
      'edit-alias shows the wrong alias — the alias never reached it through the row click ' +
        'queryParams, so the edit would re-point a different name',
    ).toHaveText(aliasName);
    await expect(
      details.nth(1),
      'edit-alias does not show the URI the alias currently carries, so the user edits blind',
    ).toHaveText(originalURI);

    const next = page.locator(`${host} button.btn-primary:has(i.fa-chevron-right)`);
    const prefix = page.locator(`${host} select[name="type"]`);
    const uriInput = page.locator(`${host} input[name="aliaseURI"]`);

    await uriInput.fill('');
    await uriInput.blur();
    await expect(
      next,
      'Next is enabled with an empty URI field — the required validator is gone and the alias ' +
        'would be re-issued pointing at nothing',
    ).toBeDisabled();

    await prefix.selectOption('url:');
    await expect(
      uriInput,
      'the URI placeholder did not follow the prefix dropdown — the (change) handler ' +
        'changePlaceholder() no longer fires',
    ).toHaveAttribute('placeholder', 'http://');

    await uriInput.fill(newBody);
    await uriInput.blur();
    await expect(next, 'Next did not enable after a new URI was entered').toBeEnabled({
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await next.click();

    await expect(
      page.locator(`${host} h4`).filter({ hasText: newBody }),
      'the confirm step does not show the URI that was typed — the user signs a value they ' +
        'never saw',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    const finish = page.locator(`${host} button.btn-primary:has(i.fa-check)`);
    await expect(
      finish,
      'Finish stayed disabled — editAlias() got no signable unsigned bytes back, so the chain ' +
        'rejected the ALIAS_ASSIGNMENT or the local signing step failed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    // No 1.00 pin here: ALIAS_ASSIGNMENT carries a size-based minimum fee, which the node
    // raises the form's hardcoded 1 XIN to (Fee.SizeBasedFee + Constants.correctInvalidFees).
    const quotedFeeTqt = await readQuotedFeeTqt(page, host);

    const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finish);
    expect(tx.subtype, 'an edit must ride on ALIAS_ASSIGNMENT (subtype 1)').toBe(1);
    expect(
      tx.attachment?.alias,
      'the edit re-issued a different alias name than the one the row action opened',
    ).toBe(aliasName);
    expect(
      tx.attachment?.uri,
      `the wallet composed the URI as ${tx.attachment?.uri} instead of ${newURI} — ` +
        'formFinalAlias() lost the prefix or the @xin suffix, so the alias points elsewhere',
    ).toBe(newURI);
    expect(
      String(tx.feeTQT),
      `the edit cost ${tx.feeTQT} TQT although the confirm step quoted ${quotedFeeTqt} TQT — ` +
        'the fee the user approved is not the fee the chain took',
    ).toBe(String(quotedFeeTqt));

    await expectSuccessAndReturn(page, infoAlerts, 'edit');

    await expect
      .poll(() => aliasUri(request, apiOrigin, aliasName), {
        message: `${aliasName} still resolves to its old URI — the edit confirmed but the chain ` +
          'kept the previous mapping',
        timeout: CONFIRM_TIMEOUT_MS,
      })
      .toBe(newURI);
    expect(
      await aliasState(request, apiOrigin, aliasName),
      'editing the URI moved the alias to a different account — an edit must not change ownership',
    ).toBe(TEST_ACCOUNT_1_RS);
  });

  test('alias-mutations: delete-alias removes the alias from the chain', async ({
    page,
    request,
    baseURL,
    infoAlerts,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const aliasName = `e2emvd${uniqueTag()}`;
    const aliasURI = `acct:${TEST_ACCOUNT_1_RS}@xin`;

    await registerAlias(request, apiOrigin, aliasName, aliasURI);
    await openRowAction(page, aliasName, 'fa-times', 'delete-alias');

    const host = 'app-delete-alias';
    const details = page.locator(`${host} h6`);
    await expect(
      details.first(),
      'delete-alias shows the wrong alias — the alias never reached it through the row click ' +
        'queryParams, so confirming here would destroy a different name',
    ).toHaveText(aliasName);
    await expect(details.nth(1), 'delete-alias shows the wrong URI for the alias').toHaveText(
      aliasURI,
    );

    const next = page.locator(`${host} button.btn-primary:has(i.fa-chevron-right)`);
    await expect(
      next,
      'the delete step takes no input, so its Next must be usable straight away',
    ).toBeEnabled();
    await next.click();

    await expect(
      page.locator(`${host} h4`).filter({ hasText: aliasName }),
      'the confirm step does not name the alias about to be destroyed',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    const finish = page.locator(`${host} button.btn-primary:has(i.fa-check)`);
    await expect(
      finish,
      'Finish stayed disabled — deleteAlias() got no signable unsigned bytes back, so the chain ' +
        'rejected the ALIAS_DELETE or the local signing step failed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      serviceFee(page, host),
      'delete-alias quotes a fee other than the 1.00 XIN the form hardcodes',
    ).toContainText('1.00');
    const quotedFeeTqt = await readQuotedFeeTqt(page, host);

    const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finish);
    expect(tx.subtype, 'a deletion must ride on ALIAS_DELETE (subtype 8)').toBe(8);
    expect(
      tx.attachment?.alias,
      'the deletion names a different alias than the one the row action opened',
    ).toBe(aliasName);
    expect(
      String(tx.feeTQT),
      `the deletion cost ${tx.feeTQT} TQT although the confirm step quoted ${quotedFeeTqt} TQT — ` +
        'the fee the user approved is not the fee the chain took',
    ).toBe(String(quotedFeeTqt));

    await expectSuccessAndReturn(page, infoAlerts, 'deletion');

    await expect
      .poll(() => aliasState(request, apiOrigin, aliasName), {
        message:
          `${aliasName} is still registered after the deletion confirmed — the name stays taken ` +
          'and nobody can re-register it',
        timeout: CONFIRM_TIMEOUT_MS,
      })
      .toBe('unknown (errorCode 5)');
  });

  test(
    'alias-mutations: edit-alias prefills the alias it edits — edit-alias.component.ts:63-66 pins ' +
      'aliase.prefix to the "acct:" default and never copies params.aliasURI into aliase.uri, so a ' +
      'url: alias opens with an empty URI field and the Account prefix preselected; a user who ' +
      'retypes only the hostname re-issues the alias as acct:<hostname>@xin',
    async ({ page, request, baseURL }) => {
      test.setTimeout(TEST_TIMEOUT_MS);
      const apiOrigin = apiOriginFromBaseURL(baseURL);
      const tag = uniqueTag();
      const aliasName = `e2emvp${tag}`;
      const uriBody = `e2e${tag}.example.com`;

      await registerAlias(request, apiOrigin, aliasName, `url:${uriBody}@xin`);
      await openRowAction(page, aliasName, 'fa-pencil-square-o', 'edit-alias');

      const host = 'app-edit-alias';
      await expect(
        page.locator(`${host} select[name="type"]`),
        'edit-alias preselects a prefix other than the one the alias actually uses',
      ).toHaveValue('url:');
      await expect(
        page.locator(`${host} input[name="aliaseURI"]`),
        'edit-alias does not prefill the URI field with the value the alias currently carries',
      ).toHaveValue(uriBody);
    },
  );
});
