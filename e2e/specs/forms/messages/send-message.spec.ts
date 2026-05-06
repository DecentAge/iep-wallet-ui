import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { SendMessagePage } from '../../../pages/send-message.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Send-message form — same template-driven Angular 6 form pattern as
 * Send-Simple but living in a different lazy-loaded module. Catches per-
 * module form-binding regressions that the Send-Simple spec can't see.
 *
 * Stops short of broadcasting an actual message — that's higher complexity
 * (encryption pipeline + recipient public key) and overlaps with the
 * already-covered send-tx flow conceptually. Form-wiring smoke is enough
 * regression cover for this round.
 */

const VALID_RECIPIENT = 'XIN-DUMM-Y123-4567-89ABC';
const VALID_MESSAGE   = 'Hello from the e2e test suite';

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('send-message: required fields + submit + toggle are present', async ({ page }) => {
  const sm = new SendMessagePage(page);
  await sm.goto();

  await expect(sm.recipient).toBeVisible();
  await expect(sm.messageBody).toBeVisible();
  await expect(sm.submit).toBeVisible();
  await expect(sm.toggleReceiverPublicKeyButton).toBeVisible();

  // Optional public-key field is hidden until its toggle is clicked.
  await expect(sm.publicKey).toBeHidden();

  // Sanity: required inputs accept content.
  await sm.recipient.fill('test-recipient');
  await expect(sm.recipient).toHaveValue('test-recipient');
});

test('send-message: submit disabled while required fields empty', async ({ page }) => {
  const sm = new SendMessagePage(page);
  await sm.goto();
  await expect(sm.submit).toBeDisabled();
});

test('send-message: submit enables once recipient + message are filled', async ({ page }) => {
  const sm = new SendMessagePage(page);
  await sm.goto();
  await sm.recipient.fill(VALID_RECIPIENT);
  await sm.messageBody.fill(VALID_MESSAGE);
  await sm.messageBody.blur();

  await expect(sm.submit).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
});

test('send-message: toggling public-key reveals the input', async ({ page }) => {
  const sm = new SendMessagePage(page);
  await sm.goto();
  await expect(sm.publicKey).toBeHidden();

  await sm.toggleReceiverPublicKey();
  await expect(sm.publicKey).toBeVisible();

  await sm.toggleReceiverPublicKey();
  await expect(sm.publicKey).toBeHidden();
});
