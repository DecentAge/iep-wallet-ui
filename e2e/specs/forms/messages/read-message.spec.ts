import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_PASSPHRASE,
  TEST_ACCOUNT_2_RS,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Read-message details (`#/wallet/messages/show-messages/read-message-details`).
 *
 * messages.spec.ts stops at "the chain accepted the transaction". This spec
 * closes the loop that actually matters to a user: the wallet always encrypts
 * the body (SendMessageComponent calls cryptoService.encryptMessage
 * unconditionally), so the plaintext only exists again if the detail view
 * decrypts it locally. That is one curve25519 shared-secret + AES round trip
 * per direction — the sender branch keys off the *recipient* public key, the
 * recipient branch off the *sender* public key (read-message.component.ts:66),
 * and neither branch reports failure: a broken decrypt renders the literal
 * string "Non readable message string." and looks like an empty message.
 *
 * The detail view is not addressable by URL — it reads the clicked row out of
 * DataStoreService — so both tests go through the datatable, which also covers
 * the row-action wiring in messages.component.html.
 */

/** Text on the read-message view, in template order (read-message.component.html). */
const H4_SENDER = 2;
const H4_RECIPIENT = 3;
const H4_MESSAGE = 4;

const uniqueMarker = () =>
  `e2e read-message ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Drives the send-message wizard and returns the confirmed transaction. */
async function sendEncryptedMessage(
  page: Page,
  request: APIRequestContext,
  apiOrigin: string,
  marker: string,
): Promise<{ txId: string; tx: any }> {
  await page.goto('#/wallet/messages/send-message');

  const recipient = page.locator('input[name="recipientRS"]');
  const body = page.locator('textarea[name="message"]').first();
  await expect(recipient, 'send-message form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await recipient.fill(TEST_ACCOUNT_2_RS);
  await body.fill(marker);
  await body.blur();

  const next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await expect(next, 'Next did not enable after recipient + message were filled').toBeEnabled({
    timeout: DEFAULT_TIMEOUT_MS,
  });
  await next.click();

  const finish = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finish,
    'Finish did not enable — encrypting + signing the message failed before broadcast',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const result = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finish);

  // The success sweetalert is body-level, so it survives router navigation and
  // would swallow the next click on the datatable.
  const swalOk = page.locator('.swal2-confirm');
  await expect(swalOk, 'broadcast success alert did not appear').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await swalOk.click();
  await expect(page.locator('.swal2-container')).toBeHidden({ timeout: DEFAULT_TIMEOUT_MS });

  return result;
}

/** Opens the newest message row and returns the read-message `h4` locator. */
async function openNewestMessage(page: Page) {
  await page.goto('#/wallet/messages/show-messages');
  const rows = page.locator('datatable-body-row');
  await expect(rows.first(), 'messages datatable rendered no rows').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // getBlockchainTransactions answers newest-first, so the message just
  // broadcast is row 0. Check the account pair before clicking, so a surprise
  // row fails here instead of inside the decryption assertion.
  const newest = rows.first();
  await expect(
    newest,
    'the newest message row is not the TEST_ACCOUNT_1 → TEST_ACCOUNT_2 message this test just sent',
  ).toContainText(TEST_ACCOUNT_2_RS);

  await newest.locator('a:has(i.fa-envelope-open-o)').click();
  await page.waitForURL(/read-message-details/, { timeout: DEFAULT_TIMEOUT_MS });

  const fields = page.locator('app-read-message h4');
  await expect(
    fields.first(),
    'read-message view did not mount — DataStoreService lost the clicked row and the component navigated back',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  return fields;
}

test.describe('messages: read-message details', () => {
  test.beforeEach(async ({ page }) => {
    const welcome = new WelcomePage(page);
    const dashboard = new DashboardPage(page);
    await welcome.goto();
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await dashboard.expectVisible();
  });

  test('read-message-details: the sender decrypts its own encrypted message back to the plaintext it sent', async ({ page, request, baseURL }) => {
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const marker = uniqueMarker();

    const { txId, tx } = await sendEncryptedMessage(page, request, apiOrigin, marker);

    // On-chain proof that the body really is ciphertext: the plaintext must not
    // be recoverable from the attachment the chain stored.
    const encrypted = tx?.attachment?.encryptedMessage;
    expect(
      encrypted?.data,
      `tx ${txId} carries no encryptedMessage attachment — the wallet sent the message in the clear: ` +
      `${JSON.stringify(tx?.attachment)}`,
    ).toMatch(/^[0-9a-f]+$/i);
    expect(
      Buffer.from(encrypted.data, 'hex').toString('latin1').includes(marker),
      'the plaintext is readable inside the stored attachment — encryptMessage() did not encrypt',
    ).toBe(false);

    const fields = await openNewestMessage(page);

    await expect(
      fields.nth(H4_SENDER),
      'read-message shows the wrong sender — params bound from the datatable row are misaligned',
    ).toHaveText(TEST_ACCOUNT_1_RS);
    await expect(
      fields.nth(H4_RECIPIENT),
      'read-message shows the wrong recipient',
    ).toHaveText(TEST_ACCOUNT_2_RS);

    // `params.type | transactionType` emits an icon via [innerHTML]; a broken
    // pipe or sanitizer leaves the field blank.
    await expect(
      page.locator('app-read-message h4 i.fa-envelope'),
      'the message-type icon is missing — the transactionType pipe returned nothing for a Messaging tx',
    ).toBeVisible();

    await expect(
      fields.nth(H4_MESSAGE),
      'the detail view did not decrypt the message back to the text that was sent. ' +
      '"Non readable message string." means decryptMessage() returned a non-string; ' +
      '"Sorry, an error has occurred" means the attachment shape changed',
    ).toHaveText(marker, { timeout: DEFAULT_TIMEOUT_MS });
  });

  test('read-message-details: the recipient decrypts the same message using the sender public key', async ({ page, request, baseURL, browser }) => {
    const apiOrigin = apiOriginFromBaseURL(baseURL);
    const marker = uniqueMarker();

    await sendEncryptedMessage(page, request, apiOrigin, marker);

    // A second, independent session: read-message takes its other branch when
    // the logged-in account is not the sender.
    const context = await browser.newContext({ baseURL });
    try {
      const recipientPage = await context.newPage();
      const welcome = new WelcomePage(recipientPage);
      await welcome.goto();
      await welcome.login(TEST_ACCOUNT_2_PASSPHRASE);
      await new DashboardPage(recipientPage).expectVisible();

      const fields = await openNewestMessage(recipientPage);

      await expect(
        fields.nth(H4_SENDER),
        'the recipient sees the wrong sender on the message it received',
      ).toHaveText(TEST_ACCOUNT_1_RS);
      await expect(
        fields.nth(H4_MESSAGE),
        'the recipient could not decrypt the message — the sender-public-key branch of ' +
        'read-message.component.ts readMessage() is broken while the sender branch works',
      ).toHaveText(marker, { timeout: DEFAULT_TIMEOUT_MS });
    } finally {
      await context.close();
    }
  });
});
