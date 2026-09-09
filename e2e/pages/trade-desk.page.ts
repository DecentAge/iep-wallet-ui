import { Page, Locator, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object for the Monetary System trade desk
 * (`#/wallet/currencies/trade/:currencyId`).
 *
 * Everything below the desk is only reachable *through* it: each handler
 * stashes its payload in the static `DataStoreService` before navigating, and
 * the target component bounces back here when that entry is missing.
 */
export class TradeDeskPage {
  readonly page: Page;
  readonly title: Locator;
  readonly createExchangeOfferButton: Locator;
  readonly createBuyOnlyButton: Locator;
  readonly createSellOnlyButton: Locator;
  readonly askForm: Locator;
  readonly askPrice: Locator;
  readonly askQuantity: Locator;
  readonly askTotal: Locator;
  readonly sellButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.locator('h2.main-title');
    // "Create Exchange Offer" is rendered once per panel.
    this.createExchangeOfferButton = page
      .getByRole('button', { name: /Create Exchange Offer/i })
      .first();
    this.createBuyOnlyButton = page.getByRole('button', { name: /Create Buy Only/i });
    this.createSellOnlyButton = page.getByRole('button', { name: /Create Sell Only/i });
    // Both order forms use name="price"/"quantity", so scope by the submit.
    this.askForm = page.locator('form.inner-form:has(button.btn-red)');
    this.askPrice = this.askForm.locator('input[name="price"]');
    this.askQuantity = this.askForm.locator('input[name="quantity"]');
    this.askTotal = this.askForm.locator('input[name="totalPrice"]');
    this.sellButton = this.askForm.locator('button.btn-red');
  }

  async goto(currencyId: string): Promise<void> {
    await this.page.goto(`#/wallet/currencies/trade/${currencyId}`);
    await expect(
      this.page.locator('h4 a.hyperlink', { hasText: currencyId }),
      `trade desk did not render currency ${currencyId} — check the trade/:id route and getCurrency`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }

  /**
   * Waiting for `getBlockchainStatus` matters: the publish wizard adds the
   * chain height it fetches in `ngOnInit` to the entered expiration height, so
   * clicking Next too early posts `expirationHeight=NaN`.
   */
  private async openPublish(button: Locator): Promise<void> {
    await expect(button).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
    const heightLoaded = this.page.waitForResponse(
      (response) => response.url().includes('requestType=getBlockchainStatus'),
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    await button.click();
    await heightLoaded;
  }

  async openPublishExchangeOffer(): Promise<void> {
    await this.openPublish(this.createExchangeOfferButton);
  }

  async openPublishBuyOnlyOffer(): Promise<void> {
    await this.openPublish(this.createBuyOnlyButton);
  }

  async openPublishSellOnlyOffer(): Promise<void> {
    await this.openPublish(this.createSellOnlyButton);
  }

  /** Fills the ask order form and hands off to the `trade/:id/sell` route. */
  async placeSellOrder(priceXin: number, units: number): Promise<void> {
    await expect(
      this.askPrice,
      'ask order form did not render on the trade desk',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    await this.askPrice.fill(String(priceXin));
    await this.askQuantity.fill(String(units));
    await this.askQuantity.blur();

    // numericalString renders two decimals ("6" → "6.00").
    await expect(
      this.askTotal,
      'the ask form total did not track price × quantity — sellFormOnChange() binding broken',
    ).toHaveValue(new RegExp(`^${priceXin * units}(\\.0+)?$`), { timeout: DEFAULT_TIMEOUT_MS });

    // `[disabled]="f2.invalid && !enableSell"` — the `&&` is a wallet bug (see
    // spec header); it is also why Sell is clickable on a currency with an
    // empty buy book, which is what lets this flow be tested at all.
    await expect(
      this.sellButton,
      'Sell stayed disabled although price and quantity are filled — the f2 ngForm validators ' +
      'changed, or the disabled binding was tightened to `f2.invalid || !enableSell`',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

    await this.sellButton.click();
  }
}
