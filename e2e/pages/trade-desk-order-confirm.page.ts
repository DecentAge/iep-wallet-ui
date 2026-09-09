import { Page, Locator, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object for the trade desk's order confirm routes
 * (`#/wallet/currencies/trade/:id/{buy,sell}`).
 *
 * Not archwizard steps: plain pages that read the order from the DataStore,
 * sign a `currencyBuy` / `currencySell` on init and expose nothing but Finish
 * — which here is `btn-primary`, not the `btn-gradient` the wizards use.
 */
export class TradeDeskOrderConfirmPage {
  readonly page: Page;
  readonly finishButton: Locator;
  readonly showSignedTxButton: Locator;
  readonly signedTxTextarea: Locator;

  constructor(page: Page) {
    this.page = page;
    this.finishButton = page.locator('button.btn-primary:has(i.fa-check)').first();
    this.showSignedTxButton = page.locator('button.btn-raised:has(i.fa-key)').first();
    this.signedTxTextarea = page.locator('textarea[name="key"]').first();
  }

  /** Each value sits in the `<h4>` right after its `div.ucsb` label. */
  private value(label: string): Locator {
    return this.page.locator(
      `xpath=//div[contains(@class,"ucsb")][normalize-space(.)="${label}"]/following-sibling::h4[1]`,
    );
  }

  /**
   * The order the page is about to sign is only in the DataStore, so the
   * echoed values are the only chance to see a hand-off that lost or swapped
   * price and quantity before the bytes are signed.
   */
  async expectOrder(
    currencyId: string,
    currencyName: string,
    priceXin: number,
    units: number,
  ): Promise<void> {
    await expect(
      this.value('Currency Id'),
      `the order confirm page did not show currency ${currencyId} — the DataStore hand-off ` +
      'from placeOrderClick() lost the order (a missing entry redirects back to the desk)',
    ).toHaveText(currencyId, { timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      this.value('Currency'),
      `the order confirm page names a currency other than ${currencyName} — placeOrderClick() ` +
      'stashed the wrong currencyDetails',
    ).toHaveText(currencyName, { timeout: DEFAULT_TIMEOUT_MS });

    // numericalString renders two decimals, the unit sits in a <small>, and a
    // regex matcher (unlike the string form) sees the raw unnormalized text.
    await expect(
      this.value('Price'),
      `the order confirm page did not echo the ${priceXin} XIN entered on the desk — price and ` +
      'quantity may have been swapped on the way into the DataStore',
    ).toHaveText(new RegExp(`^\\s*${priceXin}\\.00\\s+XIN\\s*$`), { timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      this.value('Quantity'),
      `the order confirm page did not echo the ${units} units entered on the desk`,
    ).toHaveText(String(units), { timeout: DEFAULT_TIMEOUT_MS });
  }

  async expectSignedBytes(): Promise<void> {
    await expect(
      this.finishButton,
      'Finish never enabled on the order confirm page — the node rejected the exchange ' +
      'request or client-side signing failed',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    await this.showSignedTxButton.click();
    await expect(this.signedTxTextarea).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    const bytes = ((await this.signedTxTextarea.inputValue()) ?? '').trim();
    expect(
      /^[0-9a-fA-F]+$/.test(bytes) && bytes.length > 100,
      `the signed-transaction field held no hex blob (got "${bytes.slice(0, 60)}…")`,
    ).toBe(true);
  }
}
