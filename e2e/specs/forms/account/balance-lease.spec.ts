import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_RS,
  TEST_ACCOUNT_2_RS,
  TEST_ACCOUNT_2_ID,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Balance Lease wizard (`#/wallet/account/balance-lease`) — leases the
 * lessor's effective forging weight to a lessee for a fixed number of blocks.
 * Token ownership stays with the lessor; the lessee gains forging weight only
 * after `Constants.LEASING_DELAY = 1440` blocks have elapsed.
 *
 * Why this needs TEST_ACCOUNT_2:
 *   - The lessor (TEST_ACCOUNT_1) signs the leaseBalance tx — that's the
 *     wallet's logged-in account.
 *   - The lessee must be a separate account whose state we can verify
 *     independently. Cash isn't suitable: it's a genesis recipient that's
 *     already a forger, so its "lessor" list would be cluttered with the
 *     bootstrap accounts. TEST_ACCOUNT_2 is a clean non-genesis non-forger
 *     account funded by docker_init_devnet.sh purely for two-account flows
 *     like this one.
 *
 * Migration risks this catches:
 *   - 2-step archwizard with `recipientRS` + `period` (minValue=1440,
 *     maxValue=65535) validators
 *   - the LEASE_BALANCE subtype attachment (period encoded as uint16 little-endian)
 *   - getAndVerifyAccount() lookup of recipient public key before sign-time
 *
 * Drives the wizard through Finish + broadcast + confirmation, then verifies
 * via the chain that the leaseBalance tx is included with the correct
 * recipient and period in its attachment. Idempotent across reruns: the
 * chain replaces any in-flight "next lease" for the same lessor, so the
 * test broadcasts a fresh tx every time.
 */

const PERIOD_BLOCKS = '1440';   // chain minimum (Constants.LEASING_DELAY)
const ROUTE = '#/wallet/account/balance-lease';

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('balance-lease: 2-step wizard broadcasts leaseBalance and the chain records the lease', async ({ page, request, baseURL }) => {
  await page.goto(ROUTE);

  const recipientInput = page.locator('input[name="recipientRS"]');
  const periodInput    = page.locator('input[name="period"]');
  const nextButton     = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(recipientInput, 'balance-lease form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(nextButton, 'Next must be disabled while form is empty').toBeDisabled();

  await recipientInput.fill(TEST_ACCOUNT_2_RS);
  await periodInput.fill(PERIOD_BLOCKS);
  await periodInput.blur();

  await expect(
    nextButton,
    'Next did not enable after recipient + period filled — minValue=1440 / maxValue=65535 ' +
    'validator may have regressed',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await nextButton.click();    // calls getAndVerifyAccount() + signs LEASE_BALANCE attachment

  // Step 2 confirm renders the recipient RS in <h4>.
  await expect(
    page.locator('h4', { hasText: TEST_ACCOUNT_2_RS }).first(),
    'step-2 confirm did not render the recipient — archwizard transition or binding broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish button only enables when validBytes becomes true.
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — LEASE_BALANCE signing failed (recipient pubkey lookup?)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Click Finish → wallet POSTs broadcastTransaction → poll until confirmed.
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  // Chain-side assertion: the confirmed transaction must be type=4 (account
  // control) subtype=0 (LEASE_BALANCE) with period + lessee matching what we
  // entered. (subtype encoding: see iep-node TransactionType.AccountControl.EFFECTIVE_BALANCE_LEASING)
  expect(tx.type, 'confirmed tx wrong type — expected AccountControl (4)').toBe(4);
  expect(tx.subtype, 'confirmed tx wrong subtype — expected LEASE_BALANCE (0)').toBe(0);
  expect(tx.recipientRS, 'leaseBalance recipient on chain does not match').toBe(TEST_ACCOUNT_2_RS);
  expect(tx.senderRS, 'leaseBalance sender mismatch').toBe(TEST_ACCOUNT_1_RS);
  expect(
    Number(tx.attachment?.period ?? 0),
    `leaseBalance period on chain does not match (got ${tx.attachment?.period}, expected ${PERIOD_BLOCKS})`,
  ).toBe(Number(PERIOD_BLOCKS));

  // Lessor-side: getAccount on the lessor must show a "next" lease pointing
  // at TEST_ACCOUNT_2. Lease takes effect after LEASING_DELAY blocks, so
  // the *current* lease may still be empty — but the next-block fields
  // (currentLesseeRS / nextLesseeRS) update immediately.
  const lessorResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getAccount', account: TEST_ACCOUNT_1_RS },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const lessor = await lessorResp.json();
  const lesseeId = lessor.nextLessee ?? lessor.currentLessee;
  const lesseeRS = lessor.nextLesseeRS ?? lessor.currentLesseeRS;
  expect(
    lesseeId === TEST_ACCOUNT_2_ID || lesseeRS === TEST_ACCOUNT_2_RS,
    `lessor's getAccount did not record TEST_ACCOUNT_2 as the (next|current) lessee after tx ${txId} — ` +
    `nextLessee=${lessor.nextLessee} currentLessee=${lessor.currentLessee}`,
  ).toBe(true);
});

test('balance-lease: period below 1440 keeps Next disabled', async ({ page }) => {
  await page.goto(ROUTE);

  await page.locator('input[name="recipientRS"]').fill(TEST_ACCOUNT_2_RS);
  // 1439 violates `minValue="1440"` (Constants.LEASING_DELAY chain-side floor).
  await page.locator('input[name="period"]').fill('1439');
  await page.locator('input[name="period"]').blur();

  const nextButton = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await expect(
    nextButton,
    'Next must stay disabled — period below 1440 should fail the minValue validator',
  ).toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS });
});

test('balance-lease: period above 65535 keeps Next disabled', async ({ page }) => {
  await page.goto(ROUTE);

  await page.locator('input[name="recipientRS"]').fill(TEST_ACCOUNT_2_RS);
  // 65536 violates `maxValue="65535"` (uint16 ceiling on chain-side period field).
  await page.locator('input[name="period"]').fill('65536');
  await page.locator('input[name="period"]').blur();

  const nextButton = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
  await expect(
    nextButton,
    'Next must stay disabled — period above 65535 should fail the maxValue validator',
  ).toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS });
});
