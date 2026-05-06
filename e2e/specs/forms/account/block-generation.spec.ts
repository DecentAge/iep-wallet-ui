import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Block Generation page (`#/wallet/account/block-generation`).
 *
 * Provides UI controls to start/stop forging and query forging status from
 * the local iep-node. All three action buttons are gated by two conditions:
 *   1. `isLocal` must be true — derived from NodeService.isLocalNode() which
 *      returns true when NETWORK_ENVIRONMENT=devnet (always the case on devnet).
 *   2. `secretPhrase !== ''` — plain ngModel binding, no Angular validator.
 *
 * The page also shows two status indicators:
 *   - "Local Node Available" (isLocal pipe renders a coloured badge)
 *   - "Status" (the generationStatus field, filled after runBlockGeneration(0))
 *
 * What this catches:
 *   - BlockGenerationComponent mounting and `isLocal` resolved on init
 *   - `[disabled]="!isLocal || secretPhrase === ''"` gating on all 3 buttons
 *   - Secret phrase ngModel binding accepts user input
 *
 * Migration risks:
 *   - NodeService.isLocalNode() relies on AppConstants.DEFAULT_OPTIONS.NETWORK_ENVIRONMENT
 *     being populated before the component reads it — an async config load
 *     regression could leave isLocal=false on devnet
 *   - The `isEnabled` pipe used for the local-node badge — a broken pipe
 *     renders `[object Object]` or throws and crashes the component
 */

const ROUTE = '#/wallet/account/block-generation';

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await new DashboardPage(page).expectVisible();
});

test('block-generation: title and secret-phrase input render', async ({ page }) => {
  await page.goto(ROUTE);

  await expect(
    page.locator('h2.main-title'),
    'Block Generation page title did not render',
  ).toContainText('Block Generation', { timeout: DEFAULT_TIMEOUT_MS });

  await expect(
    page.locator('input[name="secretPhrase"]'),
    'Secret phrase input did not mount — BlockGenerationComponent broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('block-generation: all three action buttons are present', async ({ page }) => {
  await page.goto(ROUTE);

  await expect(
    page.locator('input[name="secretPhrase"]'),
    'Component did not mount',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Status (fa-plug), Stop (fa-stop), Start (fa-play) buttons — always rendered
  // regardless of isLocal or passphrase state.
  for (const icon of ['fa-plug', 'fa-stop', 'fa-play']) {
    await expect(
      page.locator(`button:has(i.${icon})`).first(),
      `Button with icon "${icon}" not found — block-generation.component.html may have been modified`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }
});

test('block-generation: action buttons disabled with empty passphrase, enabled after filling', async ({ page }) => {
  await page.goto(ROUTE);

  const secretInput = page.locator('input[name="secretPhrase"]');
  await expect(secretInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // With empty passphrase all 3 buttons must be disabled (secretPhrase === '' gate).
  // On devnet isLocal=true so only the passphrase gate applies.
  for (const icon of ['fa-plug', 'fa-stop', 'fa-play']) {
    await expect(
      page.locator(`button:has(i.${icon})`).first(),
      `Button "${icon}" must be disabled when secretPhrase is empty`,
    ).toBeDisabled();
  }

  // Fill the passphrase — the disabled gate lifts.
  await secretInput.fill(TEST_ACCOUNT_1_PASSPHRASE);

  for (const icon of ['fa-plug', 'fa-stop', 'fa-play']) {
    await expect(
      page.locator(`button:has(i.${icon})`).first(),
      `Button "${icon}" must enable after filling the secret phrase — ` +
      `[disabled]="!isLocal || secretPhrase === ''" gate broken, or isLocal=false on devnet`,
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  }
});
