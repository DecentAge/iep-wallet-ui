import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';
import { prepareForVisualSnapshot, maskDynamicRegions, SNAPSHOT_OPTIONS } from '../../fixtures/visual';

/**
 * Visual + structural snapshots of the sign-up wizard.
 *
 * The wizard is one of the riskier areas for the Angular 6 → 20 migration:
 *   - it currently uses `angular-archwizard@3` (last release 2018, dead lib;
 *     scheduled for replacement)
 *   - step-2 displays a freshly generated passphrase, so the pixel snapshot
 *     must mask the `<h4 class="phrase">` element — otherwise every run diffs
 *
 * We capture step-1 (disclaimer), step-2 (with phrase masked), and step-3
 * (confirmation input). Aria snapshots are taken on each step to lock in the
 * semantic structure independent of the dead-lib's chrome.
 *
 * The spec runs in the unauthenticated visual project; sessionStorage is
 * cleared in afterEach so a completed signup doesn't leak into later tests.
 */

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* about:blank */ }
  });
});

async function gotoStep1(page: import('@playwright/test').Page): Promise<void> {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.signUpLink.click();
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-1/, { timeout: DEFAULT_TIMEOUT_MS });
}

async function clickNext(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('button.btn-gradient', { hasText: /next|continue/i }).first().click();
}

test('sign-up step-1 (disclaimer): visual snapshot', async ({ page }) => {
  await gotoStep1(page);
  await prepareForVisualSnapshot(page);

  await expect(page).toHaveScreenshot('sign-up-step-1.png', {
    ...SNAPSHOT_OPTIONS,
    fullPage: true,
    mask: maskDynamicRegions(page),
  });
});

test('sign-up step-1 (disclaimer): aria/structure snapshot', async ({ page }) => {
  await gotoStep1(page);
  await prepareForVisualSnapshot(page);
  await expect(page.locator('.card').first()).toMatchAriaSnapshot();
});

test('sign-up step-2 (passphrase): visual snapshot with phrase masked', async ({ page }) => {
  await gotoStep1(page);
  await clickNext(page);
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-2/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h4.phrase')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await prepareForVisualSnapshot(page);

  await expect(page).toHaveScreenshot('sign-up-step-2.png', {
    ...SNAPSHOT_OPTIONS,
    fullPage: true,
    // The passphrase is freshly generated each run — mask it on top of the
    // standard dynamic regions, otherwise the snapshot is non-deterministic.
    mask: [...maskDynamicRegions(page), page.locator('h4.phrase')],
  });
});

test('sign-up step-2 (passphrase): aria/structure snapshot', async ({ page }) => {
  await gotoStep1(page);
  await clickNext(page);
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-2/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h4.phrase')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await prepareForVisualSnapshot(page);
  // Aria snapshot of the card body — semantic structure, not the random phrase text.
  await expect(page.locator('.card').first()).toMatchAriaSnapshot();
});

test('sign-up step-3 (confirm): visual snapshot', async ({ page }) => {
  await gotoStep1(page);
  await clickNext(page);
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-2/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h4.phrase')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await clickNext(page);
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-3/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('input[name="passPhrase"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await prepareForVisualSnapshot(page);

  await expect(page).toHaveScreenshot('sign-up-step-3.png', {
    ...SNAPSHOT_OPTIONS,
    fullPage: true,
    mask: maskDynamicRegions(page),
  });
});

test('sign-up step-3 (confirm): aria/structure snapshot', async ({ page }) => {
  await gotoStep1(page);
  await clickNext(page);
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-2/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('h4.phrase')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await clickNext(page);
  await page.waitForURL(/#\/(wallet\/)?sign-up\/step-3/, { timeout: DEFAULT_TIMEOUT_MS });
  await expect(page.locator('input[name="passPhrase"]')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await prepareForVisualSnapshot(page);
  await expect(page.locator('.card').first()).toMatchAriaSnapshot();
});
