import { Page, APIRequestContext, Locator, expect, test } from '@playwright/test';

const DEFAULT_BROADCAST_TIMEOUT_MS = 30_000;
const DEFAULT_CONFIRM_TIMEOUT_MS = 30_000;

/** Off-page wait: `page.waitForTimeout` is a server-side page action, so a poll
 *  loop built on it writes one trace entry with a DOM snapshot per iteration. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Click the wizard's Finish button, capture the broadcastTransaction tx id from
 * the network response, then poll getTransaction until the tx is included in
 * a block. Returns the confirmed tx body for chain-state assertions.
 *
 * The wallet's commonService.broadcastTransaction (common.service.ts:35-43)
 * goes through HttpProviderService.post (http-provider.service.ts:50), which
 * serializes the params via HttpParams → application/x-www-form-urlencoded
 * `requestType=broadcastTransaction&transactionBytes=...`. We match by URL
 * (.../api), method POST, and a postData substring of `requestType=broadcastTransaction`.
 *
 * Why network-capture instead of reading the wallet's success sweetalert:
 *   - the alert message is localized + concatenated ("...transaction <id>")
 *     so parsing it is fragile;
 *   - the alert appears on the next macrotask after the response arrives,
 *     so we'd be racing the alert anyway;
 *   - the network response is the canonical source of the tx id.
 */
export async function broadcastAndAwaitConfirmation(
  page: Page,
  request: APIRequestContext,
  apiOrigin: string,
  finish: Locator,
  opts: { broadcastTimeoutMs?: number; confirmTimeoutMs?: number } = {},
): Promise<{ txId: string; tx: any }> {
  const broadcastResp = page.waitForResponse(
    (r) => {
      if (!r.url().endsWith('/api')) return false;
      if (r.request().method() !== 'POST') return false;
      const body = r.request().postData() ?? '';
      return body.includes('requestType=broadcastTransaction');
    },
    { timeout: opts.broadcastTimeoutMs ?? DEFAULT_BROADCAST_TIMEOUT_MS },
  );

  await finish.click();
  const resp = await broadcastResp;
  const json = await resp.json();
  expect(
    json.errorCode,
    `broadcastTransaction returned errorCode ${json.errorCode} ` +
    `(${json.errorDescription ?? 'no description'}) — full response: ${JSON.stringify(json)}`,
  ).toBeUndefined();
  expect(
    json.transaction,
    `broadcastTransaction did not return a transaction id — response: ${JSON.stringify(json)}`,
  ).toBeTruthy();

  const txId = json.transaction as string;
  const confirmTimeoutMs = opts.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;

  // One collapsed step instead of ~60 getTransaction entries in the trace.
  return test.step(`await confirmation of tx ${txId}`, async () => {
    const deadline = Date.now() + confirmTimeoutMs;
    while (Date.now() < deadline) {
      const txResp = await request.get(`${apiOrigin}/api`, {
        params: { requestType: 'getTransaction', transaction: txId },
        timeout: 5_000,
      });
      if (txResp.ok()) {
        const tx = await txResp.json();
        if (tx.block && typeof tx.confirmations === 'number') {
          return { txId, tx };
        }
      }
      await sleep(500);
    }
    throw new Error(
      `tx ${txId} did not confirm within ${confirmTimeoutMs}ms — forging may have stalled on devnet`,
    );
  });
}

/**
 * Convenience: derive the API origin from playwright's `baseURL`. Falls back
 * to http://node-1 (the dev compose default).
 */
export function apiOriginFromBaseURL(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'http://node-1').origin;
}
