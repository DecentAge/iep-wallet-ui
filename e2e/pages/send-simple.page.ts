import { Page, Locator, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object for the Send (simple) form at #/wallet/account/send/simple.
 *
 * Form layout (template-driven Angular 6 forms):
 *   - input[name="recipientRS"]   always visible — XIN account ID (required)
 *   - input[name="amount"]        always visible — XIN amount (required, minValue)
 *   - input[name="message"]       *ngIf="hasPrivateMessage"  — toggled by `togglePrivateMessage()`
 *   - input[name="publickey"]     *ngIf="hasReceiverPublicKey" — toggled by `toggleReceiverPublicKey()`
 *   - submit button (Next)        always visible, [disabled]="f.invalid";
 *                                 lives inside `.fright` and uses class `btn-gradient`
 *                                 (NOT to be confused with the optional-field toggle
 *                                  buttons which use `btn-success`/`btn-raised`).
 *
 * Validation errors render as siblings: `div.input-error` shown when the
 * field is `(dirty || touched)` AND `invalid`.
 */
export class SendSimplePage {
  readonly page: Page;
  readonly form: Locator;
  readonly recipient: Locator;
  readonly amount: Locator;
  readonly message: Locator;
  readonly publicKey: Locator;
  /** "Next" — step 1 → step 2; disabled while form is invalid. Also kicks
   *  off client-side signing of the transaction. */
  readonly submit: Locator;
  /** "Broadcast" — step 2; only enabled once `validBytes` becomes true,
   *  which happens after the asynchronous signing completes. */
  readonly broadcast: Locator;
  /** Step-2 "Back" button — `awPreviousStep`. */
  readonly back: Locator;
  /** Wizard step containers (the second one is the Confirm/broadcast step). */
  readonly wizardSteps: Locator;
  /** Toggle that reveals/hides the optional message field. */
  readonly togglePrivateMessageButton: Locator;
  /** Toggle that reveals/hides the optional recipient-public-key field. */
  readonly toggleReceiverPublicKeyButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.form       = page.locator('app-send-simple form');
    this.recipient  = page.locator('input[name="recipientRS"]');
    this.amount     = page.locator('input[name="amount"]');
    this.message    = page.locator('input[name="message"]');
    this.publicKey  = page.locator('input[name="publickey"]');
    this.submit     = page.locator('app-send-simple .fright button.btn-gradient');
    // Broadcast/Finish (step 2) — labelled via i18n key 'common.finish-btn'
    // ("Finish" in English). Selector targets the locale-independent
    // fa-check icon on a btn-gradient inside the wizard.
    this.broadcast  = page.locator('app-send-simple button.btn-gradient:has(i.fa-check)');
    // Previous (step 2) — fa-chevron-left icon.
    this.back       = page.locator('app-send-simple button.btn-gradient:has(i.fa-chevron-left)');
    this.wizardSteps = page.locator('app-send-simple aw-wizard-step');
    this.togglePrivateMessageButton    = page.locator('app-send-simple button:has-text("private")').first();
    this.toggleReceiverPublicKeyButton = page.locator('app-send-simple button:has-text("public key")').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('#/wallet/account/send/simple');
    await expect(this.recipient).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }

  async togglePrivateMessage(): Promise<void> {
    await this.togglePrivateMessageButton.click();
  }

  async toggleReceiverPublicKey(): Promise<void> {
    await this.toggleReceiverPublicKeyButton.click();
  }

  /** Returns the inline error <div> for a given input name (`recipientRS` etc.). */
  errorFor(inputName: string): Locator {
    return this.page.locator(
      `input[name="${inputName}"] ~ * .input-error, ` +
      `input[name="${inputName}"] + .input-error`,
    );
  }
}
