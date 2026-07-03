import { Page, expect, Locator } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from './timeouts';

/**
 * Helpers for stable visual + structural snapshots.
 *
 * The migration regression strategy is: capture goldens against the current
 * Angular 6 build NOW, commit them to git, then re-run after the Angular 20
 * migration. Any visual drift (font shift, padding change, color difference)
 * shows up as a failed `toHaveScreenshot`; any DOM/semantic drift (extra
 * wrapper div, missing aria attribute) shows up as a failed
 * `toMatchAriaSnapshot`.
 *
 * For the comparison to be meaningful the inputs must be deterministic.
 * `prepareForVisualSnapshot` does the work to make that true: disables
 * animations app-wide, waits for fonts + images, lets the network settle.
 *
 * Dynamic regions (current time, account balance, last block height) are
 * masked at the call site via the `mask` parameter on `toHaveScreenshot` —
 * see `MASK_DYNAMIC_REGIONS` below.
 */

/**
 * Inject a stylesheet that flattens animation/transition timings and
 * waits for the document to be visually quiescent.
 */
export async function prepareForVisualSnapshot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
    `,
  });

  // Wait for fonts to load — text rendering shifts otherwise.
  await page.evaluate(() => (document as any).fonts?.ready);

  // Wait for any inflight images to finish (logos, icons) so reflow is done.
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs
        .filter(img => !img.complete)
        .map(img => new Promise<void>(resolve => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })),
    );
  });

  // Let network requests settle (best-effort; snapshots shouldn't depend on
  // long-tail polling, but a quick pause avoids flakes from in-flight icons).
  await page.waitForLoadState('networkidle', { timeout: DEFAULT_TIMEOUT_MS }).catch(() => undefined);
}

/**
 * CSS selectors for things that change between runs and would otherwise
 * cause every visual snapshot to fail. Used as `mask: MASK_DYNAMIC_REGIONS(page)`
 * on `expect(page).toHaveScreenshot(...)`.
 *
 * The wallet renders these in many places — over-masking is fine because
 * goldens then become "everything stable except these". Add to this list as
 * new dynamic UI lands.
 */
export function maskDynamicRegions(page: Page): Locator[] {
  return [
    // Footer timestamp (e.g. "Last Update: ...")
    page.locator('text=/Last Update/i'),
    // Account balance figures shown across the chrome
    page.locator('[data-testid="balance"], .balance, .account-balance'),
    // Block height / sync status indicators
    page.locator('[data-testid="block-height"], .block-height, .sync-status'),
    // Any element marked as time-varying
    page.locator('[data-snapshot-mask]'),
  ];
}

/** Default options for `toHaveScreenshot` calls — call as ...spreadable. */
export const SNAPSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.01,
  animations: 'disabled' as const,
  caret: 'hide' as const,
  scale: 'css' as const,
};
