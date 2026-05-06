import { Browser, expect } from '@playwright/test';
import { WelcomePage } from '../pages/welcome.page';
import { DashboardPage } from '../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from './broadcast-confirm';

export interface CampaignInfo {
  txId: string;
  code: string;
  name: string;
}

/**
 * Creates a test crowdfunding campaign via the create-campaign wizard UI.
 *
 * Sender: TEST_ACCOUNT_1. Code and name are randomised per call using 4
 * random uppercase letters to avoid duplicate-code rejections from
 * issueCurrency across test runs.
 *
 * Parameters:
 *   - name:               "Camp<4letters>"  (8 chars, within 3-10 limit)
 *   - code:               "CF<4letters>"    (6 chars, within 3-6 limit)
 *   - description:        "Automated test campaign description"
 *   - initialSupply:      0
 *   - reserveSupply:      100
 *   - minReservePerUnit:  1 XIN
 *   - issuanceHeight:     1440 blocks (default)
 *
 * Broadcasts and polls until confirmed, then returns the campaign info for
 * chain-state assertions.
 *
 * Runs in an isolated browser context so it does not interfere with the
 * test-level page fixture.
 *
 * Migration risks:
 *   - create-campaign wizard uses awNextStep simultaneously with
 *     (click)="createCampaign()" on step 2 — if the nested Observable is
 *     swallowed, validBytes never becomes true and Finish never enables
 *   - getBlockChainStatus() is called on step 1 Next click; if currentHeight
 *     is undefined, issuanceHeight becomes NaN and the API call fails
 */
export async function createTestCampaign(
  browser: Browser,
  baseURL: string | undefined,
): Promise<CampaignInfo> {
  const apiOrigin = apiOriginFromBaseURL(baseURL);
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const suffix = Array.from(
    { length: 4 },
    () => letters[Math.floor(Math.random() * 26)],
  ).join('');
  const code = 'CF' + suffix;   // 6 uppercase letters — within the 3-6 limit
  const name = 'Camp' + suffix; // 8 letters — within the 3-10 limit

  try {
    const welcome = new WelcomePage(page);
    await welcome.goto();
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await new DashboardPage(page).expectVisible();

    await page.goto('#/wallet/crowdfunding/create-campaign');

    // Step 1: basic details
    const nameInput = page.locator('input[name="name"]');
    await expect(nameInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    await nameInput.fill(name);
    await page.locator('input[name="code"]').fill(code);
    await page.locator('textarea[name="desc"]').fill('Automated test campaign description');

    // Step 1 Next also triggers getBlockChainStatus() so step 2 gets currentHeight
    const nextStep1 = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
    await expect(nextStep1).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    await nextStep1.click();

    // Wait for step 2 content to be visible before interacting
    const reserveSupplyInput = page.locator('input[name="reserveSupply"]');
    await expect(reserveSupplyInput).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    // Step 2: supply parameters (issuanceHeight defaults to 1440 — leave as-is)
    await page.locator('input[name="initialSupply"]').fill('0');
    await reserveSupplyInput.fill('100');
    await page.locator('input[name="minReservePerUnitTQT"]').fill('1');

    // Step 2 Next simultaneously calls createCampaign() and transitions to step 3.
    // nth(1) because the DOM has both step 1 and step 2 Next buttons at all times.
    const nextStep2 = page.locator('button.btn-gradient:has(i.fa-chevron-right)').nth(1);
    await expect(nextStep2).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    await nextStep2.click();

    // Finish enables once createCampaign() resolves and signs locally (validBytes = true)
    const finishButton = page.locator('button:has(i.fa-check)').first();
    await expect(finishButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    const { txId } = await broadcastAndAwaitConfirmation(
      page, page.request, apiOrigin, finishButton,
    );
    return { txId, code, name };
  } finally {
    await context.close();
  }
}
