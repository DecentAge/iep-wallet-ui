import { Page, Locator, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object shared by the three publish-offer wizards under the trade desk
 * (`publish-exchange-offer`, `publish-exchange-buy-offer`,
 * `publish-exchange-sell-offer`). Same shell everywhere — details step → Next
 * signs → confirm step → Finish broadcasts — only the details inputs differ.
 */
export class PublishExchangeOfferPage {
  readonly page: Page;
  readonly detailsStep: Locator;
  readonly confirmStep: Locator;
  readonly nextButton: Locator;
  readonly finishButton: Locator;
  readonly showSignedTxButton: Locator;
  readonly signedTxTextarea: Locator;

  constructor(page: Page) {
    this.page = page;
    this.detailsStep = page.locator('aw-wizard-step').first();
    this.confirmStep = page.locator('aw-wizard-step').last();
    this.nextButton = page.locator('button.btn-gradient:has(i.fa-chevron-right)').first();
    this.finishButton = page.locator('button.btn-gradient:has(i.fa-check)').first();
    this.showSignedTxButton = page.locator('button.btn-raised:has(i.fa-key)').first();
    this.signedTxTextarea = page.locator('textarea[name="key"]').first();
  }

  input(name: string): Locator {
    return this.page.locator(`input[name="${name}"]`);
  }

  async expectDetailsStep(currencyId: string, ticker: string): Promise<void> {
    await expect(
      this.detailsStep.locator('h4', { hasText: ticker }),
      `the publish-offer wizard did not show ticker ${ticker} — the DataStore hand-off ` +
      'from the trade desk lost the currency (a missing entry redirects back to the desk)',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      this.detailsStep.locator('h4', { hasText: currencyId }),
      `the publish-offer wizard did not show currency id ${currencyId}`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    await expect(
      this.nextButton,
      'Next was enabled on an empty details step — the required-field validators are gone',
    ).toBeDisabled();
  }

  /**
   * The offer lifetime the details step pre-fills (`checkControlEnabled()`:
   * the phasing height under account control, else 1440 blocks). The signed
   * `expirationHeight` is this plus the chain height, so callers need it to
   * check the sum instead of just "some number arrived".
   */
  async expectPrefilledLifetimeBlocks(): Promise<number> {
    const raw = await this.input('expirationHeight').inputValue();
    const blocks = Number(raw);
    expect(
      Number.isInteger(blocks) && blocks > 0,
      `the details step pre-filled expirationHeight="${raw}" — checkControlEnabled() no longer ` +
      'seeds an offer lifetime, so the wallet would sign an offer that expires at the chain height',
    ).toBe(true);
    return blocks;
  }

  /**
   * One Next click both advances the wizard (`awNextStep`) and calls
   * `publishExchangeOffer()`. Returns that request's form body so callers can
   * assert on what the wallet derived from the entered values.
   */
  async submitDetailsStep(): Promise<URLSearchParams> {
    const signRequest = this.page.waitForRequest(
      (request) =>
        request.url().endsWith('/api') &&
        request.method() === 'POST' &&
        (request.postData() ?? '').includes('requestType=publishExchangeOffer'),
      { timeout: DEFAULT_TIMEOUT_MS },
    );

    await expect(
      this.nextButton,
      'Next stayed disabled after the details step was filled in',
    ).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
    await this.nextButton.click();

    return new URLSearchParams((await signRequest).postData() ?? '');
  }

  /** Confirm-step values sit in the `<h4>` right after their `div.ucsb` label. */
  private confirmValue(label: string): Locator {
    return this.confirmStep.locator(
      `xpath=.//div[contains(@class,"ucsb")][normalize-space(.)="${label}"]/following-sibling::h4[1]`,
    );
  }

  /**
   * The confirm step is the last thing the user sees before signing, so every
   * value it shows must be the value that went into the transaction.
   */
  async expectConfirmValues(values: Record<string, string | number>): Promise<void> {
    for (const [label, expected] of Object.entries(values)) {
      await expect(
        this.confirmValue(label),
        `the confirm step does not show "${label}" = ${expected}. Either the step never ` +
        'rendered (archwizard navigation / DataStore hand-off) or it displays something other ' +
        'than what the wallet signed',
      ).toHaveText(String(expected), { timeout: DEFAULT_TIMEOUT_MS });
    }
  }

  /** Finish only enables once `validBytes` flips, i.e. local signing worked. */
  async expectSignedBytes(): Promise<void> {
    await expect(
      this.finishButton,
      'Finish never enabled — the node rejected the offer or client-side signing of the ' +
      'PUBLISH_EXCHANGE_OFFER attachment failed (check the wallet console for a sweetalert error)',
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
