import { test, expect, Page } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Expert/Basic wallet toggle — exercises one of the higher-risk pieces of the
 * Angular 6 → 20 migration:
 *
 *   - the custom structural directive `*isExpertView` (in
 *     `custom-directive/is-expert-view.directive.ts`) — structural directive
 *     APIs around EmbeddedViewRef have shifted across Angular majors
 *   - the manual watchList push/notify pattern in LoginService
 *     (a hand-rolled subscription mechanism that pre-dates Angular Signals
 *     and pre-dates the project's RxJS adoption)
 *   - conditional template rendering across the sidebar + Send + Receive
 *
 * The toggle is in-memory only (`LoginService.isExpertWallet = false`); not
 * persisted to session/localStorage. Test 4 pins that behaviour.
 */

const SIDEBAR_TOGGLE = '.sidebar-content li.wallet-switch a:has(i.icon-wallet)';

async function clickExpertToggle(page: Page): Promise<void> {
  await page.locator(SIDEBAR_TOGGLE).first().click();
  // The watchList notify is synchronous, but Angular's change detection still
  // needs to flush. A short settle window keeps the test stable without
  // hard-coding an arbitrary timeout into the assertion phase.
  await page.waitForTimeout(150);
}

async function readToggleLabel(page: Page): Promise<string> {
  return ((await page.locator(`${SIDEBAR_TOGGLE} .menu-title`).first().textContent()) ?? '').trim();
}

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('expert toggle: reveals the Account → Advanced submenu in the sidebar', async ({ page }) => {
  // Default mode is basic. The "Advanced" submenu group is gated by
  // `*isExpertView="true"` — the directive removes the entire <ng-container>
  // content from the DOM, so the menu-title span never renders.
  const advancedTitle = page.locator('.sidebar-content .menu-title', { hasText: /^Advanced$/i });
  await expect(
    advancedTitle,
    'in basic mode, the "Advanced" sidebar submenu should not be in the DOM',
  ).toHaveCount(0);

  // Flip the toggle. The watchList in LoginService notifies every component
  // bound through *isExpertView — the Advanced ng-container should re-render.
  await clickExpertToggle(page);

  await expect(
    advancedTitle,
    'after switching to expert, the "Advanced" sidebar submenu should appear — ' +
    'isExpertView directive or LoginService.watchList notify is broken',
  ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });
});

test('expert toggle: swaps the Send page between basic and expert layouts', async ({ page }) => {
  await page.goto('#/wallet/account/send');

  // The expert layout wraps the Send form in a tab strip (Simple / Deferred /
  // Reference / Secret). The basic layout has no tab strip and renders
  // <app-send-simple> directly. So the tab strip's presence is the
  // unambiguous "expert" signal — note that <app-send-simple> itself is
  // present in BOTH modes (in expert it loads as the default child route).
  const expertTabs = page.locator('ul.nav.nav-tabs.nav-fill.nav-auto');

  await expect(page.locator('app-send-simple').first(), 'Send form should render').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(expertTabs, 'expert Send tab strip should be absent in basic mode').toHaveCount(0);

  await clickExpertToggle(page);

  // After flipping, the basic <section *isExpertView="false"> is removed and
  // the expert <section *isExpertView="true"> with its tab strip is instantiated.
  await expect(
    expertTabs.first(),
    'expert Send tab strip should appear after toggle — isExpertView directive ' +
    'or LoginService.watchList notify is broken',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('expert toggle: swaps the Receive page between basic and expert layouts', async ({ page }) => {
  await page.goto('#/wallet/account/receive-tab');

  // Same shape as Send: expert wraps Receive in a Receive/Claim tab strip;
  // basic renders <app-receive> directly with no tab strip.
  const expertTabs = page.locator('ul.nav.nav-tabs.nav-fill.nav-auto');

  await expect(page.locator('app-receive').first(), 'Receive view should render').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  await expect(expertTabs, 'expert Receive tab strip should be absent in basic mode').toHaveCount(0);

  await clickExpertToggle(page);

  await expect(
    expertTabs.first(),
    'expert Receive tab strip should appear after toggle',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
});

test('expert toggle: setting is in-memory only (resets to basic on reload)', async ({ page }) => {
  // Pre-condition: the toggle starts in basic mode after fresh login.
  const initialLabel = await readToggleLabel(page);
  expect(initialLabel, `unexpected initial toggle label "${initialLabel}" — expected basic mode`)
    .toMatch(/basic/i);

  // Flip to expert and confirm the label flipped.
  await clickExpertToggle(page);
  const afterToggleLabel = await readToggleLabel(page);
  expect(afterToggleLabel, `toggle did not switch to expert (label still "${afterToggleLabel}")`)
    .toMatch(/expert/i);

  // Reload. The wallet's AuthGuard may bounce us back to /welcome when
  // sessionStorage was wiped on reload — handle the same way bookmarks.spec.ts
  // does so the assertion below is meaningful.
  await page.reload();
  if (/welcome/.test(page.url())) {
    const welcome = new WelcomePage(page);
    const dashboard = new DashboardPage(page);
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await dashboard.expectVisible();
  }

  const reloadedLabel = await readToggleLabel(page);
  expect(
    reloadedLabel,
    `expert mode unexpectedly persisted across reload (label = "${reloadedLabel}"). ` +
    `LoginService.isExpertWallet should be in-memory only — if persistence ` +
    `was added intentionally, update this test to match the new contract`,
  ).toMatch(/basic/i);
});
