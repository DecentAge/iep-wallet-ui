import { APIRequestContext, Locator, Page, Response, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Multi-broadcast variant of `broadcast-confirm.ts`.
 *
 * `broadcastAndAwaitConfirmation` covers one click → one broadcast. Some flows
 * chain several signed transactions behind a single button: the DAO wizard
 * broadcasts issueAsset *and* setAlias per step, and one setAlias plus up to
 * two transferAsset per team member on Finish. The listener therefore has to be
 * attached before the click and stay attached across all of them.
 *
 * Matching is identical to broadcast-confirm.ts: POST to `.../api` whose
 * form-urlencoded body carries `requestType=broadcastTransaction`.
 */

const POLL_INTERVAL_MS = 250;

function isBroadcast(resp: Response): boolean {
  if (!resp.url().endsWith('/api')) return false;
  const req = resp.request();
  if (req.method() !== 'POST') return false;
  return (req.postData() ?? '').includes('requestType=broadcastTransaction');
}

/**
 * Click `trigger` and return the tx ids of the next `expected`
 * broadcastTransaction calls, failing with the node's own error text if any of
 * them is rejected.
 */
export async function clickAndCollectBroadcasts(
  page: Page,
  trigger: Locator,
  expected: number,
  what: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS * 3,
): Promise<string[]> {
  const txIds: string[] = [];
  const failures: string[] = [];
  const bodies: Array<Promise<void>> = [];

  const onResponse = (resp: Response) => {
    if (!isBroadcast(resp)) return;
    bodies.push(
      resp.json().then(
        (json: any) => {
          if (json?.errorCode !== undefined) {
            failures.push(
              `errorCode ${json.errorCode} (${json.errorDescription ?? 'no description'})`,
            );
          } else if (json?.transaction) {
            txIds.push(String(json.transaction));
          } else {
            failures.push(`no transaction id in response: ${JSON.stringify(json)}`);
          }
        },
        (err) => {
          failures.push(`unreadable broadcastTransaction response: ${err}`);
        },
      ),
    );
  };

  page.on('response', onResponse);
  try {
    await trigger.click();

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await Promise.all(bodies.slice());
      if (failures.length > 0 || txIds.length >= expected) break;
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
    await Promise.all(bodies.slice());

    expect(
      failures,
      `${what}: the node rejected a broadcastTransaction — ${failures.join(' | ')}`,
    ).toEqual([]);
    expect(
      txIds.length,
      `${what}: expected ${expected} broadcastTransaction call(s) within ${timeoutMs}ms but saw ` +
      `${txIds.length} (${txIds.join(', ') || 'none'}). The wallet stopped signing partway through ` +
      'the flow — check the browser console for a swallowed error in the nested subscribe chain.',
    ).toBe(expected);

    return txIds;
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Poll `getTransaction` until every id is in a block. Returns the confirmed
 * transaction bodies in the order the ids were given, for attachment assertions.
 */
export async function awaitTransactionsConfirmed(
  request: APIRequestContext,
  apiOrigin: string,
  txIds: string[],
  what: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS * 6,
): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  const confirmed: any[] = [];

  for (const txId of txIds) {
    let tx: any = null;
    while (Date.now() < deadline) {
      const resp = await request.get(`${apiOrigin}/api`, {
        params: { requestType: 'getTransaction', transaction: txId },
        timeout: DEFAULT_TIMEOUT_MS,
      });
      if (resp.ok()) {
        const body = await resp.json();
        if (body.block && typeof body.confirmations === 'number') {
          tx = body;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!tx) {
      throw new Error(
        `${what}: tx ${txId} was broadcast but never landed in a block within ${timeoutMs}ms. ` +
        'Either devnet forging stalled, or block assembly dropped it — note that iep-node ' +
        'throttles alias assignments to one *new* alias per block (Constants.THROTTLE_ALIAS_ASSIGNMENT), ' +
        'so a flow registering several aliases at once needs several blocks.',
      );
    }
    confirmed.push(tx);
  }
  return confirmed;
}
