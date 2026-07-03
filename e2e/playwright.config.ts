import { defineConfig, devices } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from './fixtures/timeouts';

/**
 * Playwright e2e config for iep-wallet-ui.
 *
 * The wallet is a hash-routed Angular SPA; it loads at `index.html` and routes
 * are accessed via `#/<path>`. Default target is the iep-docker-dev devnet
 * (Traefik fronting the wallet at http://node-1/wallet/), override with
 * BASE_URL=http://localhost:4200 etc. for a local `ng serve`.
 *
 * Ports map to whatever your devnet exposes; this config does NOT start the
 * stack itself — bring it up beforehand with `iep-docker-dev/run-devnet.sh`.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,            // wallet keeps state in sessionStorage; serialise to avoid cross-test bleed
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                      // same reason as fullyParallel:false
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Per-test budget: login + navigation + checks; keep generous.
  timeout: 60_000,
  expect: {
    // Per-assertion timeout (toBeVisible, toHaveURL, etc.) — central knob.
    timeout: DEFAULT_TIMEOUT_MS,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  use: {
    // No `index.html` suffix: the SPA's `<base href="/wallet/">` + Angular
    // hash routing settle the URL to `http://node-1/wallet/#/...` after the
    // first navigation. Keeping baseURL on the same path means later
    // `page.goto('#/...')` calls only mutate the hash → no full reload, no
    // singleton-service state loss (e.g. LoginService.isExpertWallet).
    baseURL: process.env.BASE_URL ?? 'http://node-1/wallet/',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Zurich',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Disable animations app-wide so visual regressions are stable.
    launchOptions: {},
  },

  projects: [
    // Sanity: pre-flight checks that fail fast with a clear message when the
    // chain isn't seeded the way our tests assume. Runs first; everything
    // else is irrelevant if these fail.
    {
      name: 'sanity',
      testMatch: /specs\/sanity\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Pre-auth specs: welcome / sign-up / login / logout (logout starts
    // logged in but ends logged out, so it provides its own login). Run
    // without any storage state.
    //   matches: specs/auth/*.spec.ts
    //            specs/smoke/pre-auth.spec.ts
    //            specs/smoke/sign-up.spec.ts
    {
      name: 'unauthenticated',
      testMatch: /specs\/(auth\/.*|smoke\/(pre-auth|sign-up))\.spec\.ts$/,
      dependencies: ['sanity'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Post-auth specs: a beforeEach in each spec file logs in via the welcome
    // form. We do NOT pre-populate storageState because the wallet stores its
    // unlocked state in sessionStorage (which Playwright's storageState file
    // doesn't preserve), and sniffing the exact key shape is brittle.
    //   matches: specs/forms/*.spec.ts
    //            specs/smoke/post-auth-*.spec.ts
    //            specs/smoke/sidebar-*.spec.ts
    {
      name: 'authenticated',
      testMatch: /specs\/(forms\/.*|smoke\/(post-auth.*|sidebar.*))\.spec\.ts$/,
      dependencies: ['sanity'],
      use: { ...devices['Desktop Chrome'] },
    },
    // Visual regression — the migration safety net. Goldens captured against
    // the current Angular 6 build, re-run after the Angular 20 migration to
    // surface visual drift. Fails any test where a screenshot differs by
    // more than maxDiffPixelRatio (1% by default).
    //
    // Opt-in only: the project list excludes these unless RUN_VISUAL=1.
    // Until baselines are committed, an unconditional run produces a wall of
    // "snapshot doesn't exist" failures that drown out the real signals.
    // Capture / re-run with: `RUN_VISUAL=1 npm run snapshot`
    //                        `RUN_VISUAL=1 npm test`
    ...(process.env.RUN_VISUAL === '1' ? [
      {
        name: 'visual-pre-auth',
        testMatch: /specs\/visual\/(welcome|sign-up)\..*\.spec\.ts/,
        dependencies: ['sanity'],
        use: { ...devices['Desktop Chrome'] },
      },
      {
        name: 'visual-post-auth',
        testMatch: /specs\/visual\/(post-auth|expert-mode)\..*\.spec\.ts/,
        dependencies: ['sanity'],
        use: { ...devices['Desktop Chrome'] },
      },
    ] : []),
  ],
});
