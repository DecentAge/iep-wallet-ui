import { Page, Locator, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object for the Send-Message form at #/wallet/messages/send-message.
 *
 * Same template-driven Angular 6 form pattern as Send-Simple, different
 * module — covers per-module form regressions that send.spec.ts can't see.
 *
 * Layout:
 *   - input[name="recipientRS"]   always visible — XIN account ID (required)
 *   - select[name="prunable"]     always visible — message type
 *   - textarea[name="message"]    always visible — message body (required)
 *   - input[name="pubkey"]        *ngIf="hasReceiverPublicKey" — toggled
 *   - submit button (Next)        always visible, [disabled]="f.invalid",
 *                                 calls getAndVerifyAccount(sendMessageForm)
 */
export class SendMessagePage {
  readonly page: Page;
  readonly recipient: Locator;
  readonly messageBody: Locator;
  readonly publicKey: Locator;
  readonly toggleReceiverPublicKeyButton: Locator;
  /** "Next" — same wizard pattern as Send-Simple (advances + auto-signs). */
  readonly submit: Locator;

  constructor(page: Page) {
    this.page = page;
    this.recipient   = page.locator('input[name="recipientRS"]');
    this.messageBody = page.locator('textarea[name="message"]');
    this.publicKey   = page.locator('input[name="pubkey"]');
    this.toggleReceiverPublicKeyButton = page
      .locator('app-send-message button:has-text("public key")')
      .first();
    // The "Next" button calls getAndVerifyAccount(sendMessageForm) and
    // advances the angular-archwizard. Class is btn-gradient inside the
    // form-actions row; targeting the right-floated gradient button.
    this.submit = page.locator('app-send-message button.btn-gradient.float-right').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('#/wallet/messages/send-message');
    await expect(this.recipient).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }

  async toggleReceiverPublicKey(): Promise<void> {
    await this.toggleReceiverPublicKeyButton.click();
  }
}
