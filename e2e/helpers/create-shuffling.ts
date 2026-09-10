import { APIRequestContext } from '@playwright/test';
import { TEST_ACCOUNT_1_PASSPHRASE } from '../fixtures/test-accounts';

/**
 * Seeds shuffling state on devnet through the node's REST API (server-side
 * signing via `secretPhrase`, same approach as cast-vote.spec.ts).
 *
 * Not through the wizard: the join half needs a second account, and
 * `canRegisterEnabled()` disables the join action for the issuer, so a second
 * logged-in browser session would be required. Seeding over the API is also
 * retry-safe — the wizard test asserts the UI path separately.
 */

/** 1 XIN — the fee the wallet hardcodes for every shuffling transaction. */
const FEE_TQT = '100000000';

const TQT_PER_XIN = 100_000_000;

/** Constants.MIN_NUMBER_OF_SHUFFLING_PARTICIPANTS. */
const PARTICIPANT_COUNT = 3;

/**
 * Whole-XIN range the seeded amount is drawn from. Every shuffling looks alike
 * on this chain (same issuer, participant count, stage), so the amount is the
 * only field that can identify a row — it is picked per run and checked against
 * the amounts already in use.
 *
 * Lower bound: Constants.SHUFFLING_DEPOSIT_TQT (1000 XIN) is the chain minimum
 * for an XIN shuffling, and everything seeded before the amount was randomised
 * sits at exactly 1000 — 1001 keeps this run out of that collision class.
 * Whole XIN only: the `amountTqt` pipe passes no maximumFractionDigits, so a
 * fractional amount would render with three decimals.
 */
const MIN_AMOUNT_XIN = 1001;
const MAX_AMOUNT_XIN = 1999;

/**
 * Registration window in blocks — chosen per run, not fixed, and deliberately
 * far below the wizard's own minValue of 1440.
 *
 * `Shuffling.getAll()` orders by `blocks_remaining ASC` and the All tab renders
 * only its first ten rows with no working pager (see the spec header). Since
 * blocks_remaining decays, every shuffling still alive from an earlier run
 * sorts ahead of a fresh one — a fixed window puts the new shuffling last and
 * pushes it off the page as soon as ten runs overlap. Undercutting the shortest
 * window currently on the chain puts it at position 0 instead.
 *
 * The floor keeps it alive well past a full spec run (~35 s, i.e. ~15 blocks at
 * the devnet's ~2.4 s block time); the ceiling caps how long the amount stays
 * locked, because expiry is the only cleanup a REGISTRATION-stage shuffling has.
 */
const MIN_REGISTRATION_PERIOD = 60;
const MAX_REGISTRATION_PERIOD = 200;
/** Slack for the blocks that pass between reading the list and being forged in. */
const SORT_MARGIN_BLOCKS = 10;

const CONFIRM_TIMEOUT_MS = 30_000;

export interface SeededShuffling {
  /** Shuffling id — equal to the shufflingCreate transaction id. */
  shufflingId: string;
  /** Full hash of the creating transaction; the handle `shufflingRegister` wants. */
  fullHash: string;
  /** Unique among the active shufflings on this chain at seeding time. */
  amountTQT: string;
  participantCount: number;
  registrationPeriod: number;
}

/** Creates a shuffling in REGISTRATION stage and waits until it is in a block. */
export async function createShufflingViaApi(
  api: APIRequestContext,
  apiBase: string,
  passphrase: string = TEST_ACCOUNT_1_PASSPHRASE,
): Promise<SeededShuffling> {
  const { amountTQT, registrationPeriod } = await pickSeedParameters(api, apiBase);

  const created = await broadcast(api, apiBase, {
    requestType: 'shufflingCreate',
    amount: amountTQT,
    participantCount: String(PARTICIPANT_COUNT),
    registrationPeriod: String(registrationPeriod),
    holdingType: '0',
    feeTQT: FEE_TQT,
    deadline: '60',
    broadcast: 'true',
    secretPhrase: passphrase,
  });

  await awaitConfirmation(api, apiBase, created.transaction);

  return {
    shufflingId: created.transaction,
    fullHash: created.fullHash,
    amountTQT,
    participantCount: PARTICIPANT_COUNT,
    registrationPeriod,
  };
}

/** Registers `passphrase`'s account as an additional participant. */
export async function registerForShufflingViaApi(
  api: APIRequestContext,
  apiBase: string,
  shufflingFullHash: string,
  passphrase: string,
): Promise<string> {
  const registered = await broadcast(api, apiBase, {
    requestType: 'shufflingRegister',
    shufflingFullHash,
    feeTQT: FEE_TQT,
    deadline: '60',
    broadcast: 'true',
    secretPhrase: passphrase,
  });

  await awaitConfirmation(api, apiBase, registered.transaction);
  return registered.transaction;
}

/**
 * Reads the active shufflings once and derives both seed parameters from them:
 * an amount no other active shuffling uses (so the seeded row can be found by
 * what it renders rather than by list position), and a registration window that
 * undercuts every window already running (so the row sorts onto page 1).
 */
async function pickSeedParameters(
  api: APIRequestContext,
  apiBase: string,
): Promise<{ amountTQT: string; registrationPeriod: number }> {
  const resp = await api.get(apiBase, {
    params: {
      requestType: 'getAllShufflings',
      firstIndex: '0',
      lastIndex: '99',       // maxAPIRecords on devnet
      includeFinished: false,
    },
  });
  const json = await resp.json();
  if (!resp.ok() || json.errorCode) {
    throw new Error(`getAllShufflings failed while picking seed parameters: HTTP ${resp.status()} ${JSON.stringify(json)}`);
  }
  const active: any[] = json.shufflings ?? [];

  const shortestWindow = active.reduce(
    (min, s) => Math.min(min, Number(s.blocksRemaining)),
    Number.POSITIVE_INFINITY,
  );
  const registrationPeriod = Math.max(
    MIN_REGISTRATION_PERIOD,
    Math.min(MAX_REGISTRATION_PERIOD, shortestWindow - SORT_MARGIN_BLOCKS),
  );

  const taken = new Set<string>(active.map((s) => String(s.amount)));
  const span = MAX_AMOUNT_XIN - MIN_AMOUNT_XIN + 1;
  const offset = Math.floor(Math.random() * span);
  for (let i = 0; i < span; i++) {
    const amountTQT = String((MIN_AMOUNT_XIN + ((offset + i) % span)) * TQT_PER_XIN);
    if (!taken.has(amountTQT)) return { amountTQT, registrationPeriod };
  }
  throw new Error(
    `every amount between ${MIN_AMOUNT_XIN} and ${MAX_AMOUNT_XIN} XIN is already in use by an active ` +
    'shuffling on this devnet — the spec identifies its row by amount and needs a free one. ' +
    'Wait for older shufflings to expire, or re-bootstrap the devnet.',
  );
}

async function broadcast(
  api: APIRequestContext,
  apiBase: string,
  form: Record<string, string>,
): Promise<any> {
  const resp = await api.post(apiBase, { form });
  const json = await resp.json();
  if (json.errorCode || !json.transaction || json.broadcasted !== true) {
    // `json` never echoes the secretPhrase, so it is safe to dump.
    throw new Error(`${form.requestType} was not broadcast: ${JSON.stringify(json)}`);
  }
  return json;
}

export async function awaitConfirmation(
  api: APIRequestContext,
  apiBase: string,
  txId: string,
  timeoutMs: number = CONFIRM_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await api.get(apiBase, {
      params: { requestType: 'getTransaction', transaction: txId },
      timeout: 5_000,
    });
    if (resp.ok()) {
      const tx = await resp.json();
      if (tx.block && typeof tx.confirmations === 'number') return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `shuffling tx ${txId} did not confirm within ${timeoutMs}ms — devnet forging may have stalled`,
  );
}
