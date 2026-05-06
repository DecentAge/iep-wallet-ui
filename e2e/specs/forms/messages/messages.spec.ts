import { test, expect } from '@playwright/test';
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
 * Messages list (`#/wallet/messages/show-messages`) — promotes the messages
 * module from smoke (post-auth-routes already mounts it) to a functional
 * regression target.
 *
 * Why bother: the messages page composes three migration-risky pieces
 * together that no other functional spec exercises in combination:
 *   - `<ngx-datatable>` (dead lib, due for replacement) with its column
 *     templates and external-paging wiring
 *   - a horizontal filter-button group, each button driven by `ngbPopover`
 *   - `i18n` translation of column headers (`'table-header.date'| translate`
 *     etc.) — bundles that don't load break the headers silently
 *
 * The test does NOT depend on the test account having actual messages —
 * an empty datatable still mounts the component, columns, and filter
 * controls. That keeps it stable across devnet resets.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('messages: page mounts with datatable, filter button group, and translated headers', async ({ page }) => {
  await page.goto('#/wallet/messages/show-messages');

  // The datatable instance is the regression target. Its mounting proves
  // the lazy-loaded module compiled and the @swimlane/ngx-datatable host
  // element rendered.
  const datatable = page.locator('ngx-datatable').first();
  await expect(
    datatable,
    'ngx-datatable did not mount on /messages/show-messages — module-load or ' +
    'datatable-compat regression after migration',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The filter row sits above the datatable: undo + N filter buttons + reload,
  // each an <a class="btn btn-sm btn-grey btn-icon">. Assert at least three
  // buttons rendered (undo + reload are always there + at least one filter).
  const filterButtons = page.locator('.btn-group.btn-group-justified.btn-group-raised a.btn.btn-icon');
  const filterCount = await filterButtons.count();
  expect(
    filterCount,
    `expected at least 3 filter-row buttons on the messages page (undo + filters + reload), got ${filterCount}`,
  ).toBeGreaterThanOrEqual(3);

  // Column headers come from the i18n bundle (`table-header.date` etc.). If
  // the bundle didn't load, the headers show the bare keys. Sanity-check the
  // first header isn't a bare key.
  const firstHeader = page.locator('ngx-datatable .datatable-header-cell-label, ngx-datatable .datatable-header-cell').first();
  await expect(firstHeader).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const headerText = ((await firstHeader.textContent()) ?? '').trim();
  expect(
    /^table-header\./.test(headerText),
    `first datatable column header looks like an untranslated i18n key ("${headerText}") — ` +
    `the @ngx-translate bundle may have failed to load on the messages module`,
  ).toBe(false);
});

test('messages: page title renders i18n-translated label', async ({ page }) => {
  await page.goto('#/wallet/messages/show-messages');

  const title = page.locator('h2.main-title').first();
  await expect(title).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  const text = ((await title.textContent()) ?? '').trim();
  expect(
    /^messages\./.test(text),
    `messages page title looks like an untranslated i18n key ("${text}")`,
  ).toBe(false);
});

test('messages: send-message wizard sends a plain on-chain message to TEST_ACCOUNT_2 and the chain records it', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/messages/send-message');

  const recipientInput = page.locator('input[name="recipientRS"]');
  const messageTextarea = page.locator('textarea[name="message"]').first();
  const nextButton = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(recipientInput, 'send-message form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton).toBeDisabled();

  await recipientInput.fill(TEST_ACCOUNT_2_RS);
  await messageTextarea.fill('e2e regression test message — send-message spec');
  await messageTextarea.blur();

  await expect(
    nextButton,
    'Next did not enable after recipient + message filled',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await nextButton.click();

  // Step 2: Finish (broadcast) button enables once the unsigned tx is signed locally.
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — sendMessage signing may have failed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // sendMessage is type=1 (Messaging), subtype=0 (ARBITRARY_MESSAGE)
  expect(tx.type, 'confirmed tx wrong type — expected Messaging (1)').toBe(1);
  expect(tx.subtype, 'confirmed tx wrong subtype — expected ARBITRARY_MESSAGE (0)').toBe(0);
  expect(tx.recipientRS, 'message recipient on chain does not match TEST_ACCOUNT_2').toBe(TEST_ACCOUNT_2_RS);
  expect(tx.senderRS, 'message sender on chain does not match TEST_ACCOUNT_1').toBe(TEST_ACCOUNT_1_RS);
});
