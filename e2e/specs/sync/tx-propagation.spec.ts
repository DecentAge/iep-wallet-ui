import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { WelcomePage } from '../../pages/welcome.page';
import { DashboardPage } from '../../pages/dashboard.page';
import { SendSimplePage } from '../../pages/send-simple.page';
import { TEST_ACCOUNT_1_PASSPHRASE, TEST_ACCOUNT_2_RS } from '../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';
import { broadcastAndAwaitConfirmation, apiOriginFromBaseURL } from '../../helpers/broadcast-confirm';

/**
 * Cross-node propagation: a change made through the wallet (which only ever
 * talks to node-1) must reach the other two nodes.
 *
 * Every other spec asserts against node-1 alone and would pass on a one-node
 * stack. This one is the reason the devnet runs three nodes: it pins that a
 * transaction broadcast on node-1 is gossiped, included in a block, and that
 * node-2 and node-3 end up with the same block and the same account state.
 */
const NODE_HOSTS = (process.env.DEVNET_NODE_HOSTS ?? 'node-1,node-2,node-3')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const SEND_AMOUNT_XIN = '1';
const AMOUNT_TQT = 100_000_000n;
const PROPAGATION_TIMEOUT_MS = 60_000;

function apiUrl(baseURL: string | undefined, host: string): string {
  const origin = new URL(baseURL ?? 'http://node-1');
  return `${origin.protocol}//${host}${origin.port ? `:${origin.port}` : ''}/api`;
}

async function getTransactionOn(
  request: APIRequestContext,
  baseURL: string | undefined,
  host: string,
  txId: string,
): Promise<any | null> {
  const response = await request.get(apiUrl(baseURL, host), {
    params: { requestType: 'getTransaction', transaction: txId },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  if (!response.ok()) return null;
  const body = await response.json();
  return body.errorCode === undefined && body.block ? body : null;
}

async function getBalanceTQT(
  request: APIRequestContext,
  baseURL: string | undefined,
  host: string,
  accountRS: string,
): Promise<bigint> {
  const response = await request.get(apiUrl(baseURL, host), {
    params: { requestType: 'getAccount', account: accountRS },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  if (!response.ok()) return -1n;
  const body = await response.json();
  return body.errorCode === undefined ? BigInt(body.balanceTQT ?? '0') : -1n;
}

test.skip(process.env.SKIP_QUORUM_CHECK === '1', 'SKIP_QUORUM_CHECK=1 set; single-node run by design');

test.beforeEach(async ({ page }) => {
  const welcome = new WelcomePage(page);
  const dashboard = new DashboardPage(page);
  await welcome.goto();
  await welcome.login(TEST_ACCOUNT_1_PASSPHRASE);
  await dashboard.expectVisible();
});

test('propagation: a wallet transaction on node-1 confirms in the same block on every node', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000);

  const send = new SendSimplePage(page);
  const apiOrigin = apiOriginFromBaseURL(baseURL);

  // One reading from node-1: a per-node "before" would be stale on a node that
  // happens to lag a block, and the expectation could then never be met.
  const balanceBefore = await getBalanceTQT(request, baseURL, NODE_HOSTS[0], TEST_ACCOUNT_2_RS);

  await send.goto();
  await send.recipient.fill(TEST_ACCOUNT_2_RS);
  await send.amount.fill(SEND_AMOUNT_XIN);
  await expect(send.submit).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
  await send.submit.click();
  await expect(send.broadcast).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });

  const { txId, tx } = await broadcastAndAwaitConfirmation(page, request, apiOrigin, send.broadcast, {
    confirmTimeoutMs: PROPAGATION_TIMEOUT_MS,
  });
  const blockOnNode1 = tx.block;

  for (const host of NODE_HOSTS.slice(1)) {
    await expect
      .poll(async () => (await getTransactionOn(request, baseURL, host, txId))?.block ?? 'not-found', {
        timeout: PROPAGATION_TIMEOUT_MS,
        message:
          `tx ${txId} never reached ${host}. node-1 has it in block ${blockOnNode1}. ` +
          `Either the peer mesh is broken (see the quorum sanity spec) or ${host} is on a fork.`,
      })
      .toBe(blockOnNode1);
  }

  // Same block is not the same state: assert the recipient's balance moved by
  // the sent amount on every node.
  for (const host of NODE_HOSTS) {
    await expect
      .poll(async () => (await getBalanceTQT(request, baseURL, host, TEST_ACCOUNT_2_RS)).toString(), {
        timeout: PROPAGATION_TIMEOUT_MS,
        message: `${host} did not apply the balance change for ${TEST_ACCOUNT_2_RS}`,
      })
      .toBe((balanceBefore + AMOUNT_TQT).toString());
  }
});

test('propagation: every node reports the same tip after the transaction', async ({ request, baseURL }) => {
  test.setTimeout(120_000);

  await expect
    .poll(
      async () => {
        const tips = await Promise.all(
          NODE_HOSTS.map(async (host) => {
            const response = await request.get(apiUrl(baseURL, host), {
              params: { requestType: 'getBlockchainStatus' },
              timeout: DEFAULT_TIMEOUT_MS,
            });
            if (!response.ok()) return `${host}=unreachable`;
            const status = await response.json();
            return `${host}=${status.cumulativeDifficulty}`;
          }),
        );
        return new Set(tips.map((t) => t.split('=')[1])).size === 1 ? 'aligned' : tips.join('  ');
      },
      {
        timeout: PROPAGATION_TIMEOUT_MS,
        message: 'nodes drifted apart after the wallet transaction — check forging and the peer mesh',
      },
    )
    .toBe('aligned');
});
