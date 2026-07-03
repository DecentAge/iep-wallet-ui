import { test, expect } from '@playwright/test';
import { WelcomePage } from '../../../pages/welcome.page';
import { DashboardPage } from '../../../pages/dashboard.page';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../../fixtures/timeouts';

/**
 * ng-bootstrap `[ngbPopover]` trigger contract — pins the wallet's specific
 * use of the popover directive so the planned **@ng-bootstrap/ng-bootstrap
 * 1.x → 19** upgrade can't silently break it.
 *
 * The wallet uses `ngbPopover` everywhere as inline tooltips on
 * question-mark icons, filter buttons, table action buttons, etc. — they
 * always carry `triggers="mouseenter:mouseleave"` and `container="body"`
 * (so the popover renders as a sibling of <body>, not a descendant of the
 * trigger).
 *
 * What this test catches that smoke / visual specs don't:
 *   - `ngb-popover-window` is the host element the directive injects
 *     when the popover is shown — its presence is a black-box check that
 *     the directive booted and rendered something
 *   - hover-trigger semantics still work (v19 may default to a different
 *     trigger keyword)
 *   - the i18n-translated content actually reaches the popover
 *
 * The Send (simple) form's recipient-label question-mark is the cleanest
 * trigger — it's always rendered, has no data dependencies, and the
 * surrounding form is already test-validated.
 */

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('ngb-popover: hovering a question-mark icon on Send opens a popover with translated content', async ({ page }) => {
  await page.goto('#/wallet/account/send/simple');

  // The question-mark is the first <i.fa-question-circle-o> on the page —
  // sits inside the recipient field's <label>.
  const trigger = page.locator('i.fa-question-circle-o').first();
  await expect(trigger).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // Pre-condition: no popover window mounted yet.
  await expect(
    page.locator('ngb-popover-window'),
    'a popover was already mounted before any hover — test starting state is wrong',
  ).toHaveCount(0);

  // Hover the trigger. ngbPopover with triggers="mouseenter:mouseleave"
  // mounts ngb-popover-window into <body> on mouseenter.
  await trigger.hover();

  const popover = page.locator('ngb-popover-window');
  await expect(
    popover,
    'no ngb-popover-window mounted after hover — `triggers="mouseenter:mouseleave"` ' +
    'may not be honoured under ng-bootstrap v19, or `container="body"` regressed',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

  // The content should be the translated string, not a bare i18n key.
  const popoverText = ((await popover.textContent()) ?? '').trim();
  expect(
    popoverText.length,
    'popover mounted but rendered no text',
  ).toBeGreaterThan(0);
  expect(
    /^account\.send-xin\./.test(popoverText),
    `popover content looks like an untranslated i18n key ("${popoverText}") — ` +
    `the translate pipe inside the popover may have stopped working`,
  ).toBe(false);

  // Mouse-leave should dismiss it. The simplest way to leave is to move
  // focus to a different, non-overlapping element.
  await page.locator('h2.main-title').first().hover();
  await expect(
    popover,
    'popover did not dismiss on mouseleave — leave-trigger semantics may have changed',
  ).toBeHidden({ timeout: DEFAULT_TIMEOUT_MS });
});
