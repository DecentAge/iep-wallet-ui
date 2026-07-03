import { test, expect } from '@playwright/test';
import { TEST_ACCOUNT_1_RS, TEST_ACCOUNT_1_ID, TEST_ACCOUNT_1_PASSPHRASE } from '../../fixtures/test-accounts';
import { DEFAULT_TIMEOUT_MS } from '../../fixtures/timeouts';

/**
 * Early-warning canary: the test account derived from `TEST_ACCOUNT_1_PASSPHRASE` must
 * be funded on the chain we're testing against. If devnet's genesis didn't
 * include this account, every later transaction-flow spec fails with a
 * useless error message — this spec fails first with a clear one.
 *
 * Hits iep-node's API directly (not via the wallet UI) so the failure mode
 * isolates to "is the chain seeded correctly" rather than "did the wallet
 * render the right thing".
 *
 * Skip this spec on networks where the test account has no balance by
 * setting `SKIP_FUNDED_CHECK=1` (e.g. when pointing at testnet via
 * `BASE_URL=...` and a custom `TEST_ACCOUNT_1_PASSPHRASE`).
 */
/**
 * iep-node's getState exposes `peerPort`, which is per-network:
 *   devnet  = 8775  (matches IEP_NODE_1_PEER_SERVER_PORT in environment/devnet/env)
 *   testnet = 8776
 *   mainnet = 23456
 * iep-node doesn't expose `isTestnet`/`isDevnet` directly, so peerPort is the
 * canonical network identifier.
 */
const DEVNET_PEER_PORT = 8775;

test.describe('devnet sanity', () => {
  test.skip(
    process.env.SKIP_FUNDED_CHECK === '1',
    'SKIP_FUNDED_CHECK=1 set; assuming the test account is unfunded by design',
  );

  test(`node is running in devnet mode`, async ({ request, baseURL }) => {
    const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;
    const response = await request.get(`${apiOrigin}/api`, {
      params: { requestType: 'getState' },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    expect(response.ok(), `getState HTTP ${response.status()}`).toBe(true);
    const body = await response.json();

    expect(
      body.peerPort,
      `node's peerPort=${body.peerPort} (expected ${DEVNET_PEER_PORT}=devnet). ` +
      `The test suite is calibrated for devnet — running it against testnet (8776) or mainnet (23456) is meaningless. ` +
      `Override by setting BASE_URL to the right host or SKIP_FUNDED_CHECK=1 if intentional.`,
    ).toBe(DEVNET_PEER_PORT);
  });

  test(`TEST_ACCOUNT_1_PASSPHRASE derives the expected accountRS / account ID`, async ({ request, baseURL }) => {
    // Guards against fixture drift: if anyone changes TEST_ACCOUNT_1_PASSPHRASE without
    // updating TEST_ACCOUNT_1_RS/ID (or vice versa), this fails before the
    // balance test runs against the wrong account. Uses iep-node's
    // getAccountId, which derives the keypair from the passphrase locally on
    // the node side and returns the account.
    const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;
    const response = await request.post(`${apiOrigin}/api`, {
      form: {
        requestType: 'getAccountId',
        secretPhrase: TEST_ACCOUNT_1_PASSPHRASE,
      },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    expect(response.ok(), `getAccountId HTTP ${response.status()}`).toBe(true);
    const body = await response.json();

    expect(
      body.accountRS,
      `passphrase derives ${body.accountRS} but fixtures/test-accounts.ts has TEST_ACCOUNT_1_RS=${TEST_ACCOUNT_1_RS}. ` +
      `Update either the passphrase or the expected account constants so they match.`,
    ).toBe(TEST_ACCOUNT_1_RS);

    expect(body.account, 'derived account ID mismatch with TEST_ACCOUNT_1_ID').toBe(TEST_ACCOUNT_1_ID);
  });

  test(`Test Account ${TEST_ACCOUNT_1_ID} has non-zero balance`, async ({ request, baseURL }) => {
    // One-shot: when the test runs, devnet must already be initialized. If
    // the account isn't funded, that's a real failure — don't paper over it
    // by polling.
    const apiOrigin = new URL(baseURL ?? 'http://node-1').origin;
    const response = await request.get(`${apiOrigin}/api`, {
      params: { requestType: 'getAccount', account: TEST_ACCOUNT_1_RS },
      timeout: DEFAULT_TIMEOUT_MS,
    });
    expect(response.ok(), `getAccount HTTP ${response.status()}`).toBe(true);
    const body = await response.json();

    // iep-node returns either { account, balanceNQT, ... } for a known account
    // or { errorCode: 5, errorDescription: "Unknown account" } if it doesn't
    // exist in the chain. Both are valid HTTP 200 — discriminate on body shape.
    expect(
      body.errorCode,
      `getAccount returned errorCode ${body.errorCode}: ${body.errorDescription}\n` +
      `Account ${TEST_ACCOUNT_1_RS} is not on the chain — devnet wasn't initialized correctly. ` +
      `Re-run \`./run-devnet.sh start --clean\` and wait until docker_init_devnet.sh has finished ` +
      `(check \`docker compose logs node-1 | tail -40\`) before running tests.`,
    ).toBeUndefined();

    expect(body.account, 'account ID mismatch').toBe(TEST_ACCOUNT_1_ID);

    // iep-node uses TQT as the smallest unit (1 XIN = 1e8 TQT).
    const balanceTQT = BigInt(body.balanceTQT ?? '0');
    expect(
      balanceTQT > 0n,
      `Test Account ${TEST_ACCOUNT_1_RS} has zero balance — devnet's chain didn't fund it. ` +
      `Re-run \`./run-devnet.sh start --clean\` and wait for docker_init_devnet.sh to finish.`,
    ).toBe(true);

    // Log the balance so it shows up in the test output.
    const balanceXin = Number(balanceTQT) / 1e8;
    test.info().annotations.push({
      type: 'balance',
      description: `Test Account 1 balance: ${balanceXin.toLocaleString()} XIN`,
    });
  });
});
