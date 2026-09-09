import { APIRequestContext } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/** 1 XIN expressed in quants — the unit behind every `*TQT` chain field. */
export const TQT_PER_XIN = 100_000_000;

/** `CurrencyType.EXCHANGEABLE` — the only flag a trade-desk offer needs. */
const CURRENCY_TYPE_EXCHANGEABLE = 1;

export interface ExchangeableCurrency {
  currencyId: string;
  code: string;
  name: string;
  decimals: number;
  supply: number;
}

/** Chain rule: 3-6 UPPERCASE Latin letters, no digits, unique on the chain. */
export function randomCurrencyCode(length = 5): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length }, () => upper[Math.floor(Math.random() * upper.length)]).join('');
}

/**
 * Issues a fresh EXCHANGEABLE currency through the node API and waits until it
 * is in a block. Fixture setup only — the issuance *wizard* is covered by
 * `issue-currency.spec.ts`.
 *
 * Every caller needs its own currency: the chain keeps at most one exchange
 * offer per account per currency, so a shared one would mean later offers
 * silently replacing earlier ones.
 *
 * `secretPhrase` is sent to the node so it signs server-side — acceptable for
 * devnet fixtures only; the wallet itself always signs in the browser.
 * `decimals` defaults to 0 so `rateTQT == rate * 1e8` and `supply == units`.
 */
export async function issueExchangeableCurrency(
  request: APIRequestContext,
  apiOrigin: string,
  passphrase: string,
  options: { supply?: number; decimals?: number } = {},
): Promise<ExchangeableCurrency> {
  const decimals = options.decimals ?? 0;
  const supply = options.supply ?? 1000;
  const code = randomCurrencyCode();
  const name = `E2E${code}`;

  const issueResp = await request.post(`${apiOrigin}/api`, {
    form: {
      requestType: 'issueCurrency',
      secretPhrase: passphrase,
      name,
      code,
      description: 'e2e currency-exchange fixture - devnet only',
      type: String(CURRENCY_TYPE_EXCHANGEABLE),
      decimals: String(decimals),
      initialSupply: String(supply),
      maxSupply: String(supply),
      feeTQT: String(TQT_PER_XIN),
      deadline: '1440',
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  const issued = await issueResp.json();
  if (!issued.transaction || issued.broadcasted !== true) {
    throw new Error(
      `issueCurrency fixture for code ${code} was rejected by the node: ${JSON.stringify(issued)}`,
    );
  }
  const currencyId: string = issued.transaction;

  const deadline = Date.now() + 6 * DEFAULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const resp = await request.get(`${apiOrigin}/api`, {
      params: { requestType: 'getCurrency', currency: currencyId },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const body = await resp.json();
    if (!body.errorCode) {
      return { currencyId, code, name, decimals, supply };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `issueCurrency fixture ${code} (${currencyId}) was broadcast but never made it into a block ` +
    `within ${6 * DEFAULT_TIMEOUT_MS}ms — devnet forging stalled?`,
  );
}
