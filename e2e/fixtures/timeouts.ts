/**
 * Default timeout for per-action waits across the e2e suite.
 *
 * Used by `toBeVisible`, `waitForURL`, `waitForLoadState`, `Invoke-RestMethod`
 * equivalents, etc. Single source of truth so tuning is one edit.
 *
 * The overall per-test budget (`testTimeout` in playwright.config.ts) is
 * intentionally separate — it must accommodate login + navigation + the
 * action under test, so it's set higher than DEFAULT_TIMEOUT_MS.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;
