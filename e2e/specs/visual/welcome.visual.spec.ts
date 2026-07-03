import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { prepareForVisualSnapshot, maskDynamicRegions, SNAPSHOT_OPTIONS } from '../../fixtures/visual';

/**
 * Visual + structural snapshots of the unauthenticated screens.
 *
 * Run as the `unauthenticated` Playwright project so no login fixture fires.
 * Goldens are written under e2e/specs/visual/welcome.visual.spec.ts-snapshots/
 * (Playwright's default location, kept next to the spec for easy review).
 */

test('welcome: empty form looks correct', async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await prepareForVisualSnapshot(page);

  await expect(page).toHaveScreenshot('welcome-empty.png', {
    ...SNAPSHOT_OPTIONS,
    fullPage: true,
    mask: maskDynamicRegions(page),
  });
});

test('welcome: with passphrase entered', async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.passphraseInput.fill('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen');
  await prepareForVisualSnapshot(page);

  await expect(page).toHaveScreenshot('welcome-filled.png', {
    ...SNAPSHOT_OPTIONS,
    fullPage: true,
    mask: maskDynamicRegions(page),
  });
});

test('welcome: insecure passphrase warning visible', async ({ page }) => {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.passphraseInput.fill('shortbogus');
  await welcome.passphraseInput.blur();
  await prepareForVisualSnapshot(page);

  await expect(page).toHaveScreenshot('welcome-insecure-warning.png', {
    ...SNAPSHOT_OPTIONS,
    fullPage: true,
    mask: maskDynamicRegions(page),
  });
});

test('welcome: aria/structure snapshot', async ({ page }) => {
  // Structural assertion that catches DOM/semantic drift even if pixels match.
  // Useful for catching e.g. an Angular 20 component output that wraps the
  // form in an extra <div> or removes an aria-label.
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await prepareForVisualSnapshot(page);

  // Limit the snapshot to the login card region so language-pack churn at the
  // page-level doesn't make this spec brittle.
  await expect(page.locator('form')).toMatchAriaSnapshot();
});
