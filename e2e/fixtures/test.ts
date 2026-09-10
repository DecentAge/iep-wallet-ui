import { test as base, expect } from '@playwright/test';

/**
 * Auto-dismissal for the wallet's informational sweetalert2 dialogs.
 *
 * The wallet pops a single-button alert after most write operations. Nothing
 * closes it, so it stays on screen for every following step: sweetalert2 puts a
 * backdrop over the page that swallows pointer events, which turns a later click
 * into a click on the overlay, and it obscures every DOM snapshot in the trace.
 *
 * `page.addLocatorHandler` is Playwright's mechanism for exactly this — it runs
 * the handler when an action would be blocked by the dialog and then retries the
 * action. Registered here as an auto-fixture, so every spec gets it without
 * importing anything but `test`.
 *
 * Two rules keep the convenience from hiding failures:
 *   - Only single-button dialogs are dismissed. Anything with a cancel button is
 *     a decision, not a notification (the logout confirm), and specs assert on it.
 *   - An error dialog is recorded and fails the test in teardown. Clicking a real
 *     wallet error away silently would turn a broken flow into a green run.
 *
 * Specs that assert on the dialog itself opt out per file:
 *     test.use({ autoDismissAlerts: false });
 */

export type InfoAlert = {
  /** Dialog headline, e.g. "Success". */
  title: string;
  /** Body text below the headline. */
  text: string;
  /** `success` | `info` | `warning` | `error` | '' when the dialog has no icon. */
  kind: string;
};

export type AlertLog = {
  /** Every auto-dismissed dialog, in the order it appeared. */
  messages: InfoAlert[];
  /** The most recent dialog, or undefined when none appeared yet. */
  last(): InfoAlert | undefined;
};

/**
 * Single-button dialogs only — a visible cancel button means the user has to
 * decide. Visibility, not presence: sweetalert2 renders the cancel button into
 * every dialog and hides it with display:none when it is not used, so matching on
 * existence alone excludes every informational dialog and the handler never runs.
 */
const INFO_DIALOG = '.swal2-container:has(.swal2-confirm:visible):not(:has(.swal2-cancel:visible))';

const KINDS = ['success', 'error', 'warning', 'info', 'question'] as const;

export const test = base.extend<{
  /** Set to false in a spec that asserts on dialogs itself. */
  autoDismissAlerts: boolean;
  infoAlerts: AlertLog;
}>({
  autoDismissAlerts: [true, { option: true }],

  infoAlerts: [
    async ({ page, autoDismissAlerts }, use) => {
      const messages: InfoAlert[] = [];

      let watcher: NodeJS.Timeout | undefined;
      if (autoDismissAlerts) {
        // A poll, not page.addLocatorHandler: the handler API only runs while an
        // action is already in flight and its click contends with that action's
        // lock on the page, which deadlocks here. Dismissing straight in the DOM
        // sidesteps the actionability machinery and also works during plain waits.
        watcher = setInterval(() => {
          page
            .evaluate(() => {
              const shown = (el: Element | null) =>
                !!el && getComputedStyle(el as HTMLElement).display !== 'none' && !!(el as HTMLElement).offsetParent;

              const box = document.querySelector('.swal2-container');
              if (!box) return null;
              const confirm = box.querySelector('.swal2-confirm') as HTMLElement | null;
              // A visible cancel button means the dialog asks for a decision.
              if (!shown(confirm) || shown(box.querySelector('.swal2-cancel'))) return null;

              const text = (sel: string) => (box.querySelector(sel)?.textContent ?? '').trim();
              // Every icon variant is in the DOM; only one is shown. Picking the
              // first would label a success dialog "error" and fail the test.
              const iconClass =
                Array.from(box.querySelectorAll('.swal2-icon')).find((i) => shown(i))?.className ?? '';
              confirm!.click();
              return { title: text('.swal2-title'), body: text('.swal2-html-container'), iconClass };
            })
            .then((found) => {
              if (!found) return;
              messages.push({
                title: found.title,
                text: found.body,
                kind: KINDS.find((k) => found.iconClass.includes(`swal2-${k}`)) ?? '',
              });
            })
            .catch(() => undefined); // page busy or navigating — try again next tick
        }, 200);
      }

      await use({ messages, last: () => messages[messages.length - 1] });

      if (watcher) clearInterval(watcher);

      const errors = messages.filter((m) => m.kind === 'error');
      if (errors.length > 0) {
        throw new Error(
          `the wallet raised ${errors.length} error dialog(s) during this test:\n` +
            errors.map((e) => `  · ${e.title}: ${e.text}`).join('\n') +
            '\nThe dialogs were dismissed so the run could continue, but an error alert means ' +
            'the flow under test did not do what the assertions claim it did.',
        );
      }
    },
    { auto: true },
  ],
});

export { expect };
