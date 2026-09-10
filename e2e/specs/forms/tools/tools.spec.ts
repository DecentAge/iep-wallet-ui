import { test, expect, APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
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
 * Tools module. Two route namespaces are involved, which is easy to get wrong:
 *   - `#/wallet/tool/*`  → src/app/module/tools-pages (calculate-hash,
 *     validate-signature, broadcast-transaction, transaction-types, …)
 *   - `#/wallet/tools/*` → src/app/module/extensions (chain-viewer, …)
 */

const FEE_TQT = '100000000';   // 1 XIN, the standard fee

/** Mirrors src/app/pipes/amount-tqt.pipe.ts so table cells can be compared. */
function formatTqt(valueTqt: string | number): string {
  return (Number(valueTqt) / 100_000_000).toLocaleString('en-US', { minimumFractionDigits: 2 });
}

function nonce(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 1.000–9.999 XIN. Small enough to be irrelevant next to TEST_ACCOUNT_1's 100M
 * balance, randomised so repeat runs on the same chain can never re-sign
 * byte-identical transactions, and exactly 3 decimals so the rendered
 * `amountTqt` cell is unambiguous.
 */
function randomAmountTqt(): number {
  return (1_000 + Math.floor(Math.random() * 9_000)) * 100_000;
}

async function chainHeight(request: APIRequestContext, apiOrigin: string): Promise<number> {
  const resp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getBlockchainStatus' },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(resp.ok(), `getBlockchainStatus HTTP ${resp.status()}`).toBe(true);
  const status = await resp.json();
  return Number(status.numberOfBlocks) - 1;
}

/** Poll getTransaction until the tx is in a block. Devnet forges every 1-5s. */
async function awaitConfirmation(request: APIRequestContext, apiOrigin: string, txId: string): Promise<any> {
  let last: any = null;
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${apiOrigin}/api`, {
          params: { requestType: 'getTransaction', transaction: txId },
          timeout: DEFAULT_TIMEOUT_MS,
        });
        if (!resp.ok()) return false;
        last = await resp.json();
        return Boolean(last.block);
      },
      {
        timeout: 3 * DEFAULT_TIMEOUT_MS,
        message: `tx ${txId} never made it into a block — forging may have stalled on devnet`,
      },
    )
    .toBe(true);
  return last;
}

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('tools/calculate-hash: SHA-256 of the entered text matches node:crypto', async ({ page }) => {
  await page.goto('#/wallet/tool/calculate-hash');

  const input = page.locator('app-calculate-hash input[name="input"]');
  const output = page.locator('app-calculate-hash textarea[name="output"]');
  const calculate = page.locator('app-calculate-hash span.btn-gradient');

  await expect(input, 'calculate-hash form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    calculate,
    'Calculate button is not marked disabled on an empty form — the `required` validator on ' +
    'input[name="input"] or the [ngClass] binding to f.invalid has regressed',
  ).toHaveClass(/disabled/);
  // Precondition, not a result: proves the hash asserted below was computed by
  // this click rather than left over in the textarea.
  await expect(output, 'the hash output was already populated on a freshly mounted form').toHaveValue('');

  // Randomised so a cached/hard-coded answer cannot pass.
  const secret = `iep-e2e calculate-hash ${nonce()}`;
  const expected = createHash('sha256').update(secret, 'utf8').digest('hex');

  await input.fill(secret);
  await input.blur();
  await expect(calculate, 'Calculate button stayed disabled after the text input was filled').not.toHaveClass(/disabled/);

  await calculate.click();

  await expect(
    output,
    `SHA-256 output does not match node:crypto for "${secret}". Either the wallet sent a ` +
    `different hashAlgorithm than 2 (SHA256) / dropped secretIsText=true, or the text was ` +
    `mangled on the way to the node. Cross-check with:\n` +
    `  curl -G 'http://node-1/api' --data-urlencode 'requestType=hash' ` +
    `--data-urlencode 'hashAlgorithm=2' --data-urlencode 'secretIsText=true' ` +
    `--data-urlencode 'secret=${secret}'`,
  ).toHaveValue(expected, { timeout: DEFAULT_TIMEOUT_MS });
});

test('tools/validate-signature: decodes a real token and rejects a tampered message', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  // The node signs `website` with the account key; the wallet's "Signature
  // Input" field is exactly that `website` string (decodeToken(token, website)).
  const signedMessage = `iep-e2e-token-${nonce()}`;
  const tokenResp = await request.post(`${apiOrigin}/api`, {
    form: {
      requestType: 'generateToken',
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      website: signedMessage,
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(tokenResp.ok(), `generateToken HTTP ${tokenResp.status()}`).toBe(true);
  const tokenBody = await tokenResp.json();
  expect(tokenBody.token, `generateToken returned no token: ${JSON.stringify(tokenBody)}`).toBeTruthy();

  await page.goto('#/wallet/tool/validate-signature');

  const tokenField = page.locator('app-validate-signature textarea[name="token"]');
  const messageField = page.locator('app-validate-signature input[name="message"]');
  const validateButton = page.locator('app-validate-signature button.btn-border');
  const accountButton = page.locator('app-validate-signature button.btn-gradient');
  const validIcon = page.locator('app-validate-signature .input-group-text i.fa-check.text-success');

  await expect(tokenField, 'validate-signature form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  // The untouched label is 'Account'; asserting it here is what makes the
  // TEST_ACCOUNT_1_RS assertion below proof of a real decode.
  await expect(accountButton, 'the account label did not start in its untouched state').toHaveText('Account');

  await tokenField.fill(tokenBody.token);
  await messageField.fill(signedMessage);
  await validateButton.click();

  await expect(
    accountButton,
    `decodeToken did not resolve the token back to the signing account ${TEST_ACCOUNT_1_RS}. ` +
    `The wallet may be posting the message as the wrong parameter (it must go out as ` +
    `\`website\`), or the token was truncated by the textarea.`,
  ).toHaveText(TEST_ACCOUNT_1_RS, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    validIcon,
    'the green validity tick (txIsValid pipe on `valid === true`) never appeared for a genuine token',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Same token, different message. The node still answers 200 with the signing
  // accountRS but `valid:false`; the wallet must not present that as an
  // identity. The red cross is also the pipe's default state, so the account
  // label is what distinguishes "rejected" from "untouched".
  await messageField.fill(`${signedMessage}-tampered`);
  await validateButton.click();

  await expect(
    accountButton,
    'a token validated against a tampered message still resolved to an account — ' +
    'signature validation is not being enforced in the UI',
  ).toHaveText('Invalid Account', { timeout: DEFAULT_TIMEOUT_MS });
  await expect(validIcon, 'the green validity tick stayed visible after the message was tampered with').toHaveCount(0);
});

test('tools/broadcast-transaction: relays API-signed bytes and the payment lands on chain', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  // Sign server-side without broadcasting; the UI tool is the only thing that
  // may put these bytes on the wire.
  const amountTqt = randomAmountTqt();
  const signResp = await request.post(`${apiOrigin}/api`, {
    form: {
      requestType: 'sendMoney',
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      recipient: TEST_ACCOUNT_2_RS,
      amountTQT: String(amountTqt),
      feeTQT: FEE_TQT,
      deadline: '60',
      broadcast: 'false',
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(signResp.ok(), `sendMoney (broadcast=false) HTTP ${signResp.status()}`).toBe(true);
  const signed = await signResp.json();
  expect(signed.broadcasted, `sendMoney was supposed to only sign, but reported broadcasted=${signed.broadcasted}`).toBe(false);
  expect(signed.transactionBytes, `sendMoney returned no transactionBytes: ${JSON.stringify(signed)}`).toBeTruthy();

  const expectedTxId: string = signed.transaction;

  // Not yet on the wire.
  const preResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getTransaction', transaction: expectedTxId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const pre = await preResp.json();
  expect(
    pre.errorCode,
    `tx ${expectedTxId} was already known to the node before the UI broadcast it — ` +
    `the test cannot prove the UI did anything`,
  ).toBeDefined();

  await page.goto('#/wallet/tool/broadcast-transaction');

  const bytesField = page.locator('app-broadcast-transaction textarea[name="bytes"]');
  const broadcastButton = page.locator('app-broadcast-transaction button.btn-gradient');
  const resultTick = page.locator('app-broadcast-transaction i.fa-check');
  const resultTxId = page.locator('app-broadcast-transaction h6').last();

  await expect(bytesField, 'broadcast-transaction form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    resultTick,
    'the "Broadcasted" result row was already rendered before anything was sent — ' +
    'the *ngIf on `showTransaction` no longer gates it, so its later appearance would prove nothing',
  ).toHaveCount(0);

  await bytesField.fill(signed.transactionBytes);

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, broadcastButton);

  expect(
    txId,
    'the node accepted the broadcast but returned a different transaction id than the one ' +
    'produced when signing — the textarea contents were altered before being posted',
  ).toBe(expectedTxId);

  await expect(
    resultTxId,
    `the broadcast succeeded but the result panel does not show tx ${expectedTxId} — ` +
    '`transaction` is not bound to the broadcastTransaction response',
  ).toHaveText(expectedTxId, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    resultTick,
    'the "Broadcasted" confirmation tick did not render after a successful broadcast',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  expect(tx.senderRS, 'on-chain sender does not match the signing account').toBe(TEST_ACCOUNT_1_RS);
  expect(tx.recipientRS, 'on-chain recipient does not match the signed recipient').toBe(TEST_ACCOUNT_2_RS);
  expect(Number(tx.amountTQT), 'on-chain amount does not match the signed amount').toBe(amountTqt);
});

test('tools/transaction-types: renders all 11 type groups with their mapped icons', async ({ page }) => {
  await page.goto('#/wallet/tool/transaction-types');

  const entries = page.locator('app-transaction-types .apps-wrapper');
  await expect(entries.first(), 'transaction-types page did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    entries,
    'the transaction-type list lost or gained entries — src/app/module/tools-pages/' +
    'transaction-types/transaction-types.component.html hard-codes 11 of them',
  ).toHaveCount(11);

  const labels = (await entries.locator('.list-description').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
  expect(
    labels,
    'the type labels are not the en.json `tool-pages.transaction-types.*` strings — either the ' +
    'translate pipe did not resolve (labels would still read "tool-pages.…") or the list changed',
  ).toEqual([
    'Ordinary Payment',
    'Encrypted Message',
    'Alias Assigment, Alias Sell, Alias Buy, Alias Delete',
    'Poll Creation, Vote Casting',
    'Account Info, Effective Balance Lease, Account Control, Account Property, Account Property delete',
    'Asset Issuance, Asset Transfer, Ask Order Placement, Bid Order Placement, Ask Order Cancellation, Bid Order Cancellation, Dividend Payment, Asset Delete',
    'Currency Issuance, Reserve Increase, Reserve Claim, Currency Transfer, Publish Exchange Offer, Exchange Buy, Exchange Sell, Currency Deletion',
    'Shuffling Create, Shuffling Cancel, Shuffling Verify',
    'Create Subscriptions, Cancel Subscription, Subscription Payment',
    'Escrow Creation, Escrow Sign, Escrow Results',
    'AT (Automated Transactions), Create AT, AT Payment',
  ]);

  // The icon class is the visible proof `transactionIconSubType` still maps each pair.
  const iconClasses = await entries.locator('.list-icon i').evaluateAll(els =>
    els.map(el => (el.getAttribute('class') ?? '').split(/\s+/).find(c => c.startsWith('fa-')) ?? ''),
  );
  expect(
    iconClasses,
    'transactionIconSubType no longer maps the hard-coded type/subtype pairs to their icons ' +
    '(an unmapped pair makes the pipe return undefined, so the <i> disappears entirely)',
  ).toEqual([
    'fa-usd',           // 0/0 Ordinary Payment
    'fa-envelope-o',    // 1/0 Encrypted Message
    'fa-share-alt',     // 1/1 Alias Assignment
    'fa-signal',        // 1/2 Poll Creation
    'fa-credit-card',   // 1/5 Account Info
    'fa-bar-chart',     // 2/0 Asset Issuance
    'fa-random',        // 5/0 Currency Issuance
    'fa-user-secret',   // 7/0 Shuffling Creation
    'fa-hourglass',     // 21/3 Subscription Creation
    'fa-handshake-o',   // 21/0 Escrow Creation
    'fa-cogs',          // 22/0 AT Creation
  ]);
});

test('tools/chain-viewer: Recent Blocks shows the live chain tip and the rows match getBlock', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const heightBefore = await chainHeight(request, apiOrigin);

  await page.goto('#/wallet/tools/chain-viewer');
  await expect(page, 'chain-viewer did not redirect to its default blocks tab').toHaveURL(
    /#\/wallet\/tools\/chain-viewer\/blocks$/,
    { timeout: DEFAULT_TIMEOUT_MS },
  );

  const heightLinks = page.locator('app-blocks a.btn.btn-primary');
  await expect(
    heightLinks.first(),
    'Recent Blocks stayed empty — ExtensionsService.getBlocks() returned nothing, or the ' +
    'ngx-datatable rows binding broke',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const heightTexts = (await heightLinks.allTextContents()).map(t => t.trim());
  const heightAfter = await chainHeight(request, apiOrigin);

  expect(heightTexts, 'Recent Blocks did not render a full page.size=10 batch of blocks').toHaveLength(10);
  expect(
    heightTexts.filter(t => !/^\d+$/.test(t)),
    'the "Details" column rendered non-numeric text where a block height belongs — ' +
    'the column is bound to something other than `height`',
  ).toEqual([]);

  const heights = heightTexts.map(Number);
  expect(
    heights,
    `the listed heights are not a contiguous descending run (got ${heights.join(', ')}) — ` +
    'the table is not paging the canonical chain',
  ).toEqual(heights.map((_, i) => heights[0] - i));

  // The component fetches after `heightBefore` was read and the rows were on
  // screen before `heightAfter`; ±1 absorbs a single-block reorg on devnet.
  expect(
    heights[0],
    `the top row is height ${heights[0]} while the chain moved from ${heightBefore} to ` +
    `${heightAfter} during this test — Recent Blocks is showing stale or fabricated data`,
  ).toBeGreaterThanOrEqual(heightBefore - 1);
  expect(heights[0], `top row height ${heights[0]} is ahead of the chain tip ${heightAfter}`).toBeLessThanOrEqual(
    heightAfter + 1,
  );

  // Row content must be the real block, not just a plausible number.
  const topRow = page.locator('app-blocks datatable-body-row').first();
  const blockResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getBlock', height: String(heights[0]) },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(blockResp.ok(), `getBlock HTTP ${blockResp.status()}`).toBe(true);
  const block = await blockResp.json();
  expect(block.errorCode, `getBlock(height=${heights[0]}) failed: ${JSON.stringify(block)}`).toBeUndefined();

  await expect(
    topRow,
    `the top row does not carry the block id ${block.block} that the chain reports for height ` +
    `${heights[0]} — the "Id" column is bound to the wrong property`,
  ).toContainText(String(block.block));
  await expect(
    topRow.locator('a.hyperlink'),
    `the top row's generator does not match ${block.generatorRS} reported for height ${heights[0]}`,
  ).toHaveText(block.generatorRS);
});

test('tools/chain-viewer: the Recent Blocks Reload button refetches and re-renders', async ({ page }) => {
  await page.goto('#/wallet/tools/chain-viewer/blocks');

  const heightLinks = page.locator('app-blocks a.btn.btn-primary');
  await expect(
    heightLinks.first(),
    'Recent Blocks stayed empty before the reload could be exercised',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Armed only now: the component fetches from its constructor, and that first
  // request has already landed (the rows above are on screen). Anything caught
  // from here on was therefore caused by the click.
  const refetch = page.waitForResponse(r => r.url().includes('requestType=getBlocks'), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await page.locator('#recentBlocks .card-header a.btn-grey').click();

  const body = await (await refetch).json();
  expect(
    body.blocks?.length,
    `the Reload click refetched getBlocks but the node returned no blocks: ${JSON.stringify(body)}`,
  ).toBeGreaterThan(0);
  const refetchedTop = String(body.blocks[0].height);

  await expect
    .poll(async () => (await heightLinks.first().textContent())?.trim(), {
      timeout: DEFAULT_TIMEOUT_MS,
      message:
        `the Reload click refetched getBlocks (top height ${refetchedTop}) but the table never ` +
        `re-rendered with it — setPage() no longer assigns the response to \`rows\``,
    })
    .toBe(refetchedTop);
});

test('tools/chain-viewer: Recent Transactions mirrors getTransactions and shows a payment from this run', async ({ page, request, baseURL }) => {
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  const amountTqt = randomAmountTqt();
  const sendResp = await request.post(`${apiOrigin}/api`, {
    form: {
      requestType: 'sendMoney',
      secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      recipient: TEST_ACCOUNT_2_RS,
      amountTQT: String(amountTqt),
      feeTQT: FEE_TQT,
      deadline: '60',
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(sendResp.ok(), `sendMoney HTTP ${sendResp.status()}`).toBe(true);
  const sent = await sendResp.json();
  expect(sent.broadcasted, `sendMoney did not broadcast: ${JSON.stringify(sent)}`).toBe(true);
  await awaitConfirmation(request, apiOrigin, sent.transaction);

  await page.goto('#/wallet/tools/chain-viewer/transactions');

  const rows = page.locator('app-transactions datatable-body-row');
  await expect(
    rows.first(),
    'Recent Transactions stayed empty — ExtensionsService.getTransactions() returned nothing, ' +
    'or the ngx-datatable rows binding broke',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(
    rows,
    'Recent Transactions did not render a full page.size=10 batch (getTransactions with ' +
    'firstIndex=0&lastIndex=9 returns 10 chain-wide on a seeded devnet)',
  ).toHaveCount(10);

  // Resolve columns by their header label rather than by position, so a
  // reordered column produces a named failure instead of silently comparing
  // the wrong cell.
  const headers = (await page.locator('app-transactions datatable-header-cell').allTextContents()).map(t =>
    t.replace(/\s+/g, ' ').trim(),
  );
  const columnIndex = (name: string): number => {
    const i = headers.indexOf(name);
    expect(
      i,
      `Recent Transactions has no "${name}" column — headers are [${headers.join(' | ')}]. ` +
      'A renamed or dropped ngx-datatable-column breaks every consumer of this table.',
    ).toBeGreaterThanOrEqual(0);
    return i;
  };
  const idx = {
    amount: columnIndex('Amount'),
    sender: columnIndex('Sender'),
    recipient: columnIndex('Recipient'),
  };

  // Read the rendered rows first, then ask the node — so the API window is a
  // superset of whatever the component fetched.
  const rendered = await rows.evaluateAll(
    (rowEls, cols) =>
      rowEls.map(row => {
        const cells = Array.from(row.querySelectorAll('datatable-body-cell'));
        const cell = (i: number) => (cells[i]?.textContent ?? '').replace(/\s+/g, ' ').trim();
        return { amount: cell(cols.amount), sender: cell(cols.sender), recipient: cell(cols.recipient) };
      }),
    idx,
  );

  const apiResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getTransactions', firstIndex: '0', lastIndex: '29' },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(apiResp.ok(), `getTransactions HTTP ${apiResp.status()}`).toBe(true);
  const apiBody = await apiResp.json();
  const apiKeys = new Set<string>(
    (apiBody.transactions ?? []).map(
      (t: any) => `${t.senderRS ?? ''}|${t.recipientRS ?? ''}|${formatTqt(t.amountTQT)}`,
    ),
  );

  const unmatched = rendered.filter(r => !apiKeys.has(`${r.sender}|${r.recipient}|${r.amount}`));
  expect(
    unmatched,
    `Recent Transactions rendered rows the chain does not know about: ` +
    `${JSON.stringify(unmatched)}. Either the sender/recipient/amount columns are bound to the ` +
    `wrong properties, or the amountTqt pipe no longer divides by 1e8.`,
  ).toEqual([]);

  const ourKey = `${TEST_ACCOUNT_1_RS}|${TEST_ACCOUNT_2_RS}|${formatTqt(amountTqt)}`;
  expect(
    rendered.map(r => `${r.sender}|${r.recipient}|${r.amount}`),
    `the payment of ${formatTqt(amountTqt)} XIN broadcast and confirmed by this test is not on ` +
    `page 1 of Recent Transactions (tx ${sent.transaction}) — the table is not showing the ` +
    `newest confirmed transactions first`,
  ).toContain(ourKey);
});

test('tools/chain-viewer: the Recent Transactions Reload button refetches the list', async ({ page }) => {
  await page.goto('#/wallet/tools/chain-viewer/transactions');
  await expect(page.locator('app-transactions datatable-body-row').first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  const refetch = page.waitForRequest(r => r.url().includes('requestType=getTransactions'), {
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await page.locator('#recentTransactions .card-header a.btn-grey').click();
  await refetch;
});
