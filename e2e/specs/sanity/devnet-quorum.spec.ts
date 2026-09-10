import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';

/**
 * Pre-flight: the devnet must run as a three-node mesh in sync.
 *
 * The wallet only ever talks to node-1, so the UI specs pass just as happily
 * against a single node — a broken quorum stays invisible until a spec that
 * depends on confirmation behaviour flakes. This is the port of
 * `iep-docker-dev/sanity-check-devnet.sh` into the sanity project.
 *
 * Set SKIP_QUORUM_CHECK=1 when deliberately running against a single node.
 */
const NODE_HOSTS = (process.env.DEVNET_NODE_HOSTS ?? 'node-1,node-2,node-3')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const MIN_CONNECTED_PEERS = 2;
const SYNC_TIMEOUT_MS = 30_000;
const MESH_TIMEOUT_MS = 60_000;

function apiUrl(baseURL: string | undefined, host: string): string {
  const origin = new URL(baseURL ?? 'http://node-1');
  return `${origin.protocol}//${host}${origin.port ? `:${origin.port}` : ''}/api`;
}

async function blockchainStatus(request: APIRequestContext, baseURL: string | undefined, host: string) {
  const response = await request.get(apiUrl(baseURL, host), {
    params: { requestType: 'getBlockchainStatus' },
    timeout: DEFAULT_TIMEOUT_MS,
  });
  expect(response.ok(), `${host}: getBlockchainStatus HTTP ${response.status()}`).toBe(true);
  return response.json();
}

test.describe('devnet quorum', () => {
  test.skip(process.env.SKIP_QUORUM_CHECK === '1', 'SKIP_QUORUM_CHECK=1 set; single-node run by design');

  test(`all ${NODE_HOSTS.length} nodes answer and converge on the same tip`, async ({ request, baseURL }) => {
    expect(NODE_HOSTS.length, 'devnet needs three nodes for quorum').toBeGreaterThanOrEqual(3);

    // Nodes can be a block apart while one propagates — poll instead of one-shot.
    await expect
      .poll(
        async () => {
          const tips = await Promise.all(
            NODE_HOSTS.map(async (host) => {
              const status = await blockchainStatus(request, baseURL, host);
              return `${host}=${status.cumulativeDifficulty}@${status.lastBlock}`;
            }),
          );
          const values = tips.map((t) => t.split('=')[1]);
          return new Set(values).size === 1 ? 'aligned' : tips.join('  ');
        },
        {
          timeout: SYNC_TIMEOUT_MS,
          message:
            'nodes did not converge on one tip. Check `iep-docker-dev/sanity-check-devnet.sh` and ' +
            '`docker compose logs node-2 node-3` — a node that never syncs usually means a peer ' +
            'blacklist (version string too long) or an incompatible genesis/base-target.',
        },
      )
      .toBe('aligned');
  });

  test(`each node has at least ${MIN_CONNECTED_PEERS} connected peers`, async ({ request, baseURL }) => {
    // A node that (re)joined seconds ago needs a moment to re-dial its peers,
    // so poll rather than judging the mesh on one sample.
    await expect
      .poll(
        async () => {
          const states = await Promise.all(
            NODE_HOSTS.map(async (host) => {
              const response = await request.get(apiUrl(baseURL, host), {
                params: { requestType: 'getPeers', state: 'CONNECTED' },
                timeout: DEFAULT_TIMEOUT_MS,
              });
              const peers: string[] = response.ok() ? (await response.json()).peers ?? [] : [];
              return { host, peers };
            }),
          );
          const incomplete = states.filter((s) => s.peers.length < MIN_CONNECTED_PEERS);
          return incomplete.length === 0
            ? 'complete'
            : incomplete.map((s) => `${s.host}=${s.peers.length}`).join('  ');
        },
        {
          timeout: MESH_TIMEOUT_MS,
          message:
            `every node needs ≥${MIN_CONNECTED_PEERS} connected peers, otherwise forged blocks may not ` +
            `reach the whole mesh. Check \`docker compose ps\` — a stopped or blacklisted node is the usual cause.`,
        },
      )
      .toBe('complete');
  });

  test('a historical block is identical on every node', async ({ request, baseURL }) => {
    const tip = await blockchainStatus(request, baseURL, NODE_HOSTS[0]);
    const height = Math.max(1, Number(tip.numberOfBlocks) - 3);

    const blocks = await Promise.all(
      NODE_HOSTS.map(async (host) => {
        const response = await request.get(apiUrl(baseURL, host), {
          params: { requestType: 'getBlock', height },
          timeout: DEFAULT_TIMEOUT_MS,
        });
        expect(response.ok(), `${host}: getBlock HTTP ${response.status()}`).toBe(true);
        return `${host}=${(await response.json()).block}`;
      }),
    );

    const ids = blocks.map((b) => b.split('=')[1]);
    expect(new Set(ids).size, `block at height ${height} differs across nodes: ${blocks.join('  ')} — the chain forked`).toBe(1);
  });
});
