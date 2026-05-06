import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../../helpers/broadcast-confirm';

/**
 * Create Poll wizard (`#/wallet/voting/create-poll`) — the only wallet form
 * with a **dynamically-grown array of inputs** (poll options added one at a
 * time via `addNewOption()`). That pattern is unique to this form and
 * exercises NgForm's `controls['options' + i]` lookup, which is the kind of
 * dynamic-form code most prone to silent regression under Angular major
 * upgrades.
 *
 * Other migration risks this catches:
 *   - 3-step archwizard with TWO `#fN="ngForm"` validation contexts plus a
 *     custom `isSecondStepValid` derived flag that gates which Next button
 *     renders (with vs without `awNextStep`)
 *   - the POLL_CREATION subtype attachment encoding inside signTransactionHex
 *   - sweetalert2 InfoAlertBox triggered when entering step 2 with no options
 *     yet — a cross-cutting check we already pin in sweetalert-modal.spec.ts
 *     but here we exercise dismissing it as part of a real flow
 *
 * Drives the wizard through Finish + broadcast on devnet, then confirms via
 * `getPoll` that the poll was registered. Idempotent across reruns by virtue
 * of the timestamped poll name (poll names don't have a chain-uniqueness
 * constraint, but the test verifies the specific tx it broadcast).
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('create-poll: 3-step wizard broadcasts createPoll and getPoll returns the new poll', async ({ page, request, baseURL }) => {
  await page.goto('#/wallet/voting/create-poll');

  // Step 1 — voting model defaults to "Account" (value=0); we leave it as-is
  // since that doesn't reveal extra fields. Just fill name + description.
  const pollName        = page.locator('input[name="pollName"]');
  const pollDescription = page.locator('textarea[name="pollDescription"]');
  const step1Next       = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();

  await expect(pollName, 'create-poll step-1 form did not mount').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(step1Next).toBeDisabled();

  await pollName.fill(`E2E Poll ${Date.now().toString(36).slice(-4)}`);
  await pollDescription.fill('e2e regression test poll — do not broadcast');
  await pollDescription.blur();
  await expect(step1Next).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await step1Next.click();

  // Step 2 — the poll-options form with the dynamic-array pattern.
  // Defaults: minOptions=1, maxOptions=1, duration=1440. We leave them at
  // defaults and add exactly ONE option so `pollOptions.length === maxOptions`
  // — otherwise validateStepTwo() re-pops the InfoAlertBox every time it
  // runs (which is on every input change), and each pop intercepts clicks.
  const minOptions = page.locator('input[name="minOptions"]');
  const addOptionBtn = page.locator('button.btn-success:has(i.fa-plus)').first();

  await expect(minOptions, 'step-2 did not render — archwizard transition broken').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(addOptionBtn).toBeVisible();

  // Add one option via the dynamic adder.
  await addOptionBtn.click();
  await expect(
    page.locator('input#options0'),
    'option input did not appear after addNewOption() — *ngFor over pollOptions array may have broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  await page.locator('input#options0').fill('Yes');
  await page.locator('input#options0').blur();

  // Step 2 has TWO Next buttons: one with `awNextStep` (rendered when
  // `isSecondStepValid===true`), one without (when false). The first click
  // triggers createPoll() which validates + signs; once isSecondStepValid
  // flips true the button with awNextStep renders — click it to advance.
  const step2Next = page.locator('button.btn-gradient:has(i.fa-chevron-right)').last();
  await expect(
    step2Next,
    'step-2 Next button did not enable — `isSecondStepValid` derived from validateStepTwo() ' +
    'may have regressed (min/max bounds, options count, or option text validity)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  await step2Next.click();    // calls createPoll() which validates + signs

  // After signing succeeds, isSecondStepValid=true renders the awNextStep button.
  // Click it to advance the wizard to step 3.
  const step2Advance = page.locator('button.btn-gradient:has(i.fa-chevron-right)').last();
  await expect(step2Advance).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await step2Advance.click();

  // Step 3 — confirm step renders the entered poll name in <h4>.
  const enteredName = (await pollName.inputValue()).trim();
  await expect(
    page.locator('h4', { hasText: enteredName }).first(),
    'step-3 confirm did not render the entered poll name — archwizard transition or binding broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Finish button only enables when validBytes becomes true (createPoll's
  // backend call returned unsigned bytes that signed locally).
  const finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
  await expect(
    finishButton,
    'Finish button did not enable — POLL_CREATION signing failed (check console for chain-side rejection)',
  ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  // Click Finish → wallet POSTs broadcastTransaction → poll until confirmed.
  // The createPoll tx id IS the poll id (queryable via getPoll).
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const { txId } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, finishButton);

  const pollResp = await request.get(`${apiOrigin}/api`, {
    params: { requestType: 'getPoll', poll: txId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(pollResp.ok()).toBe(true);
  const poll = await pollResp.json();
  expect(
    poll.errorCode,
    `getPoll returned an error after broadcast (tx/poll ${txId}): ${JSON.stringify(poll)}`,
  ).toBeUndefined();
  expect(poll.name, 'on-chain poll name does not match the entered name').toBe(enteredName);
  expect(Array.isArray(poll.options), 'on-chain poll has no options array').toBe(true);
  expect((poll.options ?? []).length, 'on-chain poll did not record any options').toBeGreaterThan(0);
});
