/**
 * Deterministic passphrases for tests.
 *
 * The wallet derives the keypair locally from the passphrase, so any string
 * with >= 15 words yields a deterministic account. Both Test Account 1 and
 * Test Account 2 are bootstrap-funded on devnet by
 * `iep-node/scripts/docker_init_devnet.sh`. **Safe to commit**: these
 * passphrases are bootstrap-only on devnet; the accounts exist nowhere else.
 *
 * When to use which:
 *   - `TEST_ACCOUNT_1_*` — the default logged-in account for nearly every
 *     test (passphrase used by `WelcomePage.login()`).
 *   - `TEST_ACCOUNT_2_*` — for tests that need a "normal" recipient: ones
 *     that assert the recipient's balance changed, exercise a 2-account
 *     on-chain primitive (balance leasing, phasing, multi-sig escrow, asset
 *     transfer), or need the recipient to be a non-forging non-genesis
 *     account.
 *   - `CASH_ACCOUNT_RS` — narrow "just need any recipient" cases where the
 *     transfer side-effects don't matter. Cash accumulates many inbound txs
 *     across runs (balance assertions on it are unreliable), and is itself
 *     a genesis recipient with bootstrap side-effects.
 */

// ---- Test Account 1 (the default logged-in account) ----------------------

/** Override via env when pointing at a different network. */
export const TEST_ACCOUNT_1_PASSPHRASE: string =
  process.env.TEST_ACCOUNT_1_PASSPHRASE ??
  process.env.TEST_PASSPHRASE ??           // legacy env var name; keep working
  'steel hand sing dress expect render resource below speed nurse crouch census multiply crack card famous fault equip';

/** Reed-Solomon (display) form derived from `TEST_ACCOUNT_1_PASSPHRASE`. */
export const TEST_ACCOUNT_1_RS: string = 'XIN-WDYP-H647-KPNR-BWWRK';

/** Numeric ID form derived from `TEST_ACCOUNT_1_PASSPHRASE` (used by the API). */
export const TEST_ACCOUNT_1_ID: string = '11015695257149779925';

/** Public key derived from `TEST_ACCOUNT_1_PASSPHRASE` (64-char hex). The
 *  wallet's receive view shows this in the read-only "address" input —
 *  confusing naming inside the wallet code, but factually the public key. */
export const TEST_ACCOUNT_1_PUBLIC_KEY: string =
  '75a8ed54e419f9c48836b11682806f35f706511826b8ee343948db682dc61339';

// ---- Test Account 2 (the "normal recipient" account) ---------------------

export const TEST_ACCOUNT_2_PASSPHRASE: string =
  process.env.TEST_ACCOUNT_2_PASSPHRASE ??
  'ocean blue stone river mountain forest wild garden harbor dolphin echo wisdom secret journey storm bright signal pulse';

/** Reed-Solomon form derived from `TEST_ACCOUNT_2_PASSPHRASE`. */
export const TEST_ACCOUNT_2_RS: string = 'XIN-UCFP-FSBN-Y6R4-A396F';

/** Numeric ID form derived from `TEST_ACCOUNT_2_PASSPHRASE`. */
export const TEST_ACCOUNT_2_ID: string = '9696497860615154101';

/** Public key derived from `TEST_ACCOUNT_2_PASSPHRASE` (64-char hex). Pre-published
 *  on chain by docker_init_devnet.sh's TEST_ACCOUNT_2 → cash payment so
 *  encryption flows can target it as recipient without "recipient public key
 *  required" errors. */
export const TEST_ACCOUNT_2_PUBLIC_KEY: string =
  '90be2eafd73eef4e6005c2ddd44f99efddf0e4fe5fe483f7bce4ebbc771a9b56';

// ---- Cash account (the genesis-funded forger source) ---------------------

/** Cash account RS — second genesis recipient, used as a generic recipient
 *  in tests that don't care about the recipient's state. Already exists on
 *  every fresh devnet (created by genesis), no bootstrap step needed. */
export const CASH_ACCOUNT_RS: string = 'XIN-C28M-7S2E-E9X8-A9ZHF';

// ---- Negative-test fixture -----------------------------------------------

/** A bogus passphrase used for negative login tests (single word — under the
 * 15-word minimum the welcome page warns about, but the wallet still derives
 * a key from it; the failure mode we're testing is the *insecure passphrase*
 * warning, not a login refusal). */
export const SHORT_PASSPHRASE: string = 'shortbogus';
