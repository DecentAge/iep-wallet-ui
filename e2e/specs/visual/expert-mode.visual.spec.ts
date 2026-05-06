import { test, expect, Page } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';
import { prepareForVisualSnapshot, maskDynamicRegions, SNAPSHOT_OPTIONS } from '../../fixtures/visual';

/**
 * Visual + structural snapshots of the post-auth screens that are gated by
 * the Expert/Basic wallet toggle.
 *
 * The basic-mode versions of /account/send and /account/receive-tab are
 * already covered by post-auth.visual.spec.ts. Here we capture the expert
 * variants — wider tab strips that load extra child routes via router-outlet.
 *
 * Why this matters for the migration:
 *   - the `*isExpertView` directive controls which <section> renders, so any
 *     change to that directive's view-instantiation path silently shifts
 *     pixel output here even if the basic-mode goldens still match
 *   - the expert tab strips (Simple/Deferred/Reference/Secret for Send;
 *     Receive/Claim for Receive) are dense, easy to misalign
 */

const SIDEBAR_TOGGLE = '.sidebar-content li.wallet-switch a:has(i.icon-wallet)';

async function enableExpertMode(page: Page): Promise<void> {
  // The toggle starts in basic on every fresh login (in-memory only).
  await page.locator(SIDEBAR_TOGGLE).first().click();
  // Wait for the expert tab strip to materialise so subsequent navigations
  // see the right layout.
  await expect(
    page.locator(`${SIDEBAR_TOGGLE} .menu-title`).first(),
    'expert toggle did not flip — sidebar still showing basic label',
  ).toContainText(/expert/i, { timeout: DEFAULT_TIMEOUT_MS });
}

const EXPERT_VISUAL_ROUTES: ReadonlyArray<{
  hash: string;
  name: string;
  /** A locator that must be visible before we snapshot, so we don't race the route-load. */
  readyLocator: string;
  contentSelector: string;
}> = [
  {
    hash: '#/wallet/account/send',
    name: 'account-send-expert',
    readyLocator: 'ul.nav.nav-tabs.nav-fill.nav-auto',
    contentSelector: 'main, .content, .container-fluid',
  },
  {
    hash: '#/wallet/account/receive-tab',
    name: 'account-receive-expert',
    readyLocator: 'ul.nav.nav-tabs.nav-fill.nav-auto',
    contentSelector: 'main, .content, .container-fluid',
  },
];

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
  await enableExpertMode(page);
});

for (const route of EXPERT_VISUAL_ROUTES) {
  test(`${route.name}: visual snapshot`, async ({ page }) => {
    await page.goto(route.hash);
    await expect(page.locator(route.readyLocator).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    await prepareForVisualSnapshot(page);

    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      ...SNAPSHOT_OPTIONS,
      fullPage: true,
      mask: maskDynamicRegions(page),
    });
  });

  test(`${route.name}: aria/structure snapshot`, async ({ page }) => {
    await page.goto(route.hash);
    await expect(page.locator(route.readyLocator).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    await prepareForVisualSnapshot(page);
    await expect(page.locator(route.contentSelector).first()).toMatchAriaSnapshot();
  });
}
