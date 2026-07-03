import { Page, Locator, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object for the Receive view at #/wallet/account/receive-tab/receive.
 *
 * Layout:
 *   - <qrcode [qrdata]="accountRs" ...>       ← the QR code element from the
 *                                                angularx-qrcode dep. Renders
 *                                                a <canvas> (older versions)
 *                                                or <img>/<svg> (newer ones)
 *                                                inside the <qrcode> tag.
 *   - <input readonly [ngModel]="receiveAddress" ...>  ← shows the address as
 *                                                text. Same value as accountRs.
 *   - <a (click)="copyText(...)">             ← copy button
 *
 * Migration regression risks this exercises:
 *   - account derivation (passphrase → keypair → accountRS)
 *   - Reed-Solomon encoding of the address
 *   - the angularx-qrcode dependency (1.1.7 — abandoned, must be replaced or
 *     re-validated post-migration)
 */
export class ReceivePage {
  readonly page: Page;
  readonly qrCodeElement: Locator;
  readonly addressInput: Locator;
  readonly copyButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // The component tag itself is the most stable selector regardless of
    // how angularx-qrcode renders internally (canvas vs svg vs img).
    this.qrCodeElement = page.locator('qrcode');
    this.addressInput  = page.locator('input.readonly-note');
    this.copyButton    = page.locator('a:has(i.icon-copy)').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('#/wallet/account/receive-tab/receive');
    await expect(this.qrCodeElement).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }
}
