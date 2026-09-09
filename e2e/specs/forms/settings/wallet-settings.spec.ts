import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import {
  TEST_ACCOUNT_1_PASSPHRASE,
  TEST_ACCOUNT_1_PUBLIC_KEY,
} from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * Wallet settings (`#/wallet/wallet-settings/*`) — the two user-facing knobs
 * that change how the rest of the wallet renders:
 *
 *   1. SWApps settings (`/swapps`) — per-account feature switches kept in
 *      localStorage. Toggling one must re-render every `*isAppEnabled` view
 *      through SwappService.applyChanges() (a hand-rolled ViewContainerRef
 *      watch list, i.e. exactly the kind of code an Angular major upgrade
 *      breaks silently: no error, the menu entry just never appears).
 *   2. Language (welcome-page picker) — ngx-translate `use()` plus the
 *      sessionStorage round-trip that has to survive login and reach
 *      lazy-loaded feature modules.
 *
 * Both tests reload the page once, because a hash-route change never rebuilds
 * the Angular app: only a real reload re-runs SwappService.loadSWApps() and
 * AppComponent.setLanguage(), which are the functions that read the stored
 * setting back. Without the reload the "it persists" half is untested.
 *
 * Every assertion looks at translated *content*, never at i18n keys, so a
 * bundle that fails to load fails the test instead of passing on key text.
 *
 * Neither test writes to the chain, so both are freely repeatable, and the
 * state they do touch (localStorage / sessionStorage) dies with the per-test
 * browser context.
 *
 * Node selection (`/options`) is the third knob; it is skipped below with the
 * two wallet bugs that make it untestable today.
 *
 * Language coverage note: only Polish is asserted. `src/assets/i18n/de.json`
 * has zero strings of its own — all 1242 keys it shares with `en.json` hold
 * the identical English text (and 573 en keys are missing entirely), so
 * picking German cannot change a single visible string.
 */

test.describe('wallet-settings: SWApps switches', () => {
  test.beforeEach(async ({ page }) => {
    const welcome = new WelcomePage(page);
    const dashboard = new DashboardPage(page);
    await welcome.goto();
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await dashboard.expectVisible();
  });

  test('wallet-settings: enabling the Subscriptions SWApp adds its sidebar entry, survives a reload, and disabling removes both', async ({ page }) => {
    await page.goto('#/wallet/wallet-settings/swapps');

    const title = page.locator('h2.main-title').first();
    await expect(
      title,
      'SWApps settings page did not render its translated title — either the SwappsModule route ' +
      'regressed or swapps.setting.title fell through to the raw key',
    ).toHaveText('SWApps Settings', { timeout: DEFAULT_TIMEOUT_MS });

    // One tile per entry in SwappService.loadSWApps()'s default list.
    const switches = page.locator('app-wallet-settings input[type="checkbox"]');
    await expect(
      switches,
      'expected 11 SWApp switches (Assets…DAOs) — SwappService.getAllSwapps() returned a different list',
    ).toHaveCount(11);

    const subscriptionsLabel = page.locator('label[for="Subscriptions"] .custom-control-label');
    await expect(
      subscriptionsLabel,
      'Subscriptions tile label is missing or shows the raw i18n key ' +
      '(swapps.setting.swappsList.Subscriptions.name) — the translate bundle did not load',
    ).toHaveText('Subscriptions', { timeout: DEFAULT_TIMEOUT_MS });

    // SWApps has no `appName`, so its own sidebar entry is unconditional.
    // Pinning it first keeps the "Subscriptions is absent" check below from
    // passing merely because the sidebar rendered nothing at all.
    const sidebarSwapps = page
      .locator('.sidebar-content span.menu-title')
      .filter({ hasText: /^SWApps$/ });
    await expect(
      sidebarSwapps,
      'the sidebar did not render its always-on SWApps entry — the menu is empty or untranslated, ' +
      'so no conclusion can be drawn from a missing Subscriptions entry',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    const sidebarSubscriptions = page
      .locator('.sidebar-content span.menu-title')
      .filter({ hasText: /^Subscriptions$/ });
    await expect(
      sidebarSubscriptions,
      'Subscriptions is disabled by default, so its sidebar entry must not be rendered yet',
    ).toHaveCount(0);

    const readStoredSwapps = async () =>
      JSON.parse(
        (await page.evaluate((pk) => localStorage.getItem(`swapps_array_${pk}`), TEST_ACCOUNT_1_PUBLIC_KEY)) ?? '[]',
      ) as Array<{ name: string; isEnabled: boolean }>;

    // Bootstrap's custom-control input has offsetWidth/Height 0, so Playwright's
    // .check() fails actionability; the native click still fires `change`.
    const subscriptionsSwitch = page.locator('#Subscriptions');
    await subscriptionsSwitch.evaluate((el: HTMLInputElement) => el.click());
    await expect(subscriptionsSwitch, 'Subscriptions switch did not toggle on').toBeChecked();

    await expect(
      sidebarSubscriptions,
      'enabling the Subscriptions SWApp did not add its sidebar entry — ' +
      'SwappService.applyChanges() no longer re-renders the *isAppEnabled views',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    const enabled = await readStoredSwapps();
    expect(
      enabled.find((a) => a.name === 'Subscriptions')?.isEnabled,
      `localStorage swapps_array_${TEST_ACCOUNT_1_PUBLIC_KEY} did not record Subscriptions as enabled ` +
      `(got ${JSON.stringify(enabled.find((a) => a.name === 'Subscriptions'))}) — ` +
      'setSwappSetting() writes the wrong array or the wrong key',
    ).toBe(true);

    // Full reload: rebuilds the injector, so SwappService.loadSWApps() has to
    // read the switch back out of localStorage. The login survives because
    // AuthGuard authenticates off sessionStorage, which a reload keeps.
    await page.reload();
    await expect(
      title,
      'after a full reload the SWApps settings page did not come back — if the URL is #/welcome the ' +
      'reload dropped the session (AuthService.isAuthenticated), otherwise the route itself broke',
    ).toHaveText('SWApps Settings', { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      subscriptionsSwitch,
      'after a reload the Subscriptions switch is off again — SwappService.loadSWApps() did not read ' +
      `swapps_array_${TEST_ACCOUNT_1_PUBLIC_KEY} back out of localStorage (it re-seeded the defaults)`,
    ).toBeChecked({ timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      sidebarSubscriptions,
      'after a reload the Subscriptions sidebar entry is gone — the restored setting never reached ' +
      'the *isAppEnabled directive during bootstrap',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    await subscriptionsSwitch.evaluate((el: HTMLInputElement) => el.click());
    await expect(subscriptionsSwitch, 'Subscriptions switch did not toggle back off').not.toBeChecked();

    await expect(
      sidebarSubscriptions,
      'disabling the Subscriptions SWApp left its sidebar entry behind — ' +
      'applyChanges() clears the view container only on enable',
    ).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS });

    const disabled = await readStoredSwapps();
    expect(
      disabled.find((a) => a.name === 'Subscriptions')?.isEnabled,
      'localStorage still records Subscriptions as enabled after switching it off',
    ).toBe(false);
  });
});

test.describe('wallet-settings: language switch', () => {
  // No shared login hook here: the only language picker in the wallet sits on
  // the welcome form, and the AuthGuard bounces /welcome back to /dashboard
  // once a session exists — so the language has to be picked before login.
  test('language: choosing Polish on the welcome page renders the wallet in Polish through login, lazy modules and a reload', async ({ page }) => {
    const welcome = new WelcomePage(page);
    const dashboard = new DashboardPage(page);
    await welcome.goto();

    const welcomeTitle = page.locator('.welcome-text h5').first();
    await expect(
      welcomeTitle,
      'welcome page did not render the English title — default language (en) never applied',
    ).toHaveText('Welcome to Infinity Economics', { timeout: DEFAULT_TIMEOUT_MS });

    await page.locator('select[name="language"]').selectOption({ label: 'Polish' });

    await expect(
      welcomeTitle,
      'welcome title did not switch to Polish — TranslateService.use() no longer re-renders ' +
      'bound text (check changeLanguage() and the pl.json bundle request)',
    ).toHaveText('Witaj w Infinity Economics', { timeout: DEFAULT_TIMEOUT_MS });
    await expect(
      welcome.submitButton,
      'login button label stayed English after switching to Polish',
    ).toHaveText(/Moje konto/, { timeout: DEFAULT_TIMEOUT_MS });

    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await dashboard.expectVisible();

    await expect(
      page.locator('h2.main-title').first(),
      'dashboard title is not Polish after login — TranslateService.use("pl") did not survive the ' +
      'route change from #/welcome into the authenticated layout',
    ).toHaveText('Pulpit', { timeout: DEFAULT_TIMEOUT_MS });

    // A lazy-loaded feature module: its own template strings and the shared
    // table-header bundle both have to come back translated.
    await page.goto('#/wallet/messages/show-messages');
    await expect(
      page.locator('h2.main-title').first(),
      'messages page title is not Polish — a lazily loaded module fell back to English or to the raw key',
    ).toHaveText('Wiadomości', { timeout: DEFAULT_TIMEOUT_MS });

    const headerCells = page.locator('.datatable-header-cell-label');
    await expect(
      headerCells.filter({ hasText: /^Odbiorca$/ }),
      'the messages datatable has no "Odbiorca" (Recipient) column header — the shared table-header.* ' +
      'keys resolved against the English bundle or against no bundle at all',
    ).toHaveCount(1, { timeout: DEFAULT_TIMEOUT_MS });

    const cleaned = (await headerCells.allTextContents()).map((h) => h.trim()).filter((h) => h.length > 0);
    expect(
      cleaned.filter((h) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)),
      `some datatable headers rendered as bare i18n keys instead of translated text (got ${JSON.stringify(cleaned)})`,
    ).toEqual([]);

    // Full reload: the only path that re-runs AppComponent.setLanguage(). Up to
    // here the app has simply kept the TranslateService instance alive.
    await page.reload();
    await expect(
      page.locator('h2.main-title').first(),
      'after a full reload the wallet came back in English — AppComponent.setLanguage() did not read ' +
      'sessionStorage["selected_language"] on bootstrap (or changeLanguage() never wrote it)',
    ).toHaveText('Wiadomości', { timeout: DEFAULT_TIMEOUT_MS });

    const rawLanguage = await page.evaluate(() => sessionStorage.getItem('selected_language'));
    expect(
      rawLanguage === null ? null : JSON.parse(rawLanguage),
      `sessionStorage["selected_language"] is ${JSON.stringify(rawLanguage)} instead of the picked "pl" — ` +
      'the language choice is not persisted, so a reload would silently fall back to English',
    ).toBe('pl');
  });
});

test.describe('wallet-settings: node selection', () => {
  test('options: MANUAL connection mode enables the node URL field and Save keeps the chosen node', async ({ page }) => {
    test.skip(
      true,
      'two wallet bugs make node selection unreachable. (1) #/wallet/wallet-settings/options throws ' +
      '"NullInjectorError: No provider for ChangeDetectorRef" while constructing NgbAccordionItem and the ' +
      'router falls back to the dashboard (already recorded as fixme in specs/smoke/post-auth-routes.spec.ts); ' +
      'navigating there also wedges the page so every later Playwright call hangs. (2) even once the route ' +
      'renders, options.component.html:37 iterates `optionsForm.CONNECTION_MODES`, which does not exist — the ' +
      'CONNECTION_MODES array lives on the component (options.component.ts:18), not on optionsForm — so the ' +
      'connection-mode <select> renders zero <option> elements and no node can be picked. The steps below are ' +
      'the intended coverage.',
    );

    const welcome = new WelcomePage(page);
    await welcome.goto();
    await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
    await new DashboardPage(page).expectVisible();

    await page.goto('#/wallet/wallet-settings/options');

    const mode = page.locator('#connectionMode');
    const nodeUrl = page.locator('#connectToNode');
    await expect(
      mode.locator('option'),
      'connection-mode select must offer AUTO / LOCALHOST / MANUAL',
    ).toHaveCount(3, { timeout: DEFAULT_TIMEOUT_MS });
    await expect(nodeUrl, 'node URL must stay disabled while the mode is not MANUAL').toBeDisabled();

    await mode.selectOption('MANUAL');
    await expect(nodeUrl, 'MANUAL mode must enable the node URL input').toBeEnabled();

    const manualNode = new URL(page.url()).origin;
    await nodeUrl.fill(manualNode);
    await page.locator('.btn-create').first().click();

    await expect(
      page.locator('.connected-url-value code'),
      'the saved node was not adopted as the connected URL',
    ).toHaveText(manualNode, { timeout: DEFAULT_TIMEOUT_MS });

    const stored = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('options'))) ?? '[]',
    ) as Array<{ optionName: string; value: string }>;
    expect(
      stored.find((o) => o.optionName === 'NODE_API_URL')?.value,
      'the chosen node was not persisted to the options store',
    ).toBe(manualNode);
  });
});
