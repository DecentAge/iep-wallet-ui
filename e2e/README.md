# iep-wallet-ui — Playwright e2e tests

End-to-end tests that drive a real Chromium against the running wallet UI. Originally built as a regression safety net **before** the Angular 6 → 18 upgrade; that upgrade has since landed (the wallet is on Angular 18.2.11), and the suite now serves as the ongoing regression net.

**Last full run: 2026-09-10 — 269 passed, 0 failed, 5 skipped** against the local devnet from
`iep-docker-dev` (274 tests in 58 files, ~9 min wall clock, `workers: 1`). The skips are documented
wallet bugs and flows that need a second browser session; each names its cause in the skip message.

## Prerequisites the chain must satisfy

The `authenticated` specs spend real devnet XIN, so the chain has to be seeded with the
two documented test accounts (`fixtures/test-accounts.ts`). That happens automatically on
the fresh-genesis node when `IEP_NODE_1_INIT_DEVNET_E2E_ACCOUNTS=true` — set in
`iep-docker-dev/environment/local/devnet.env`, consumed by `iep-node`'s entrypoint, which
then runs `scripts/docker_init_devnet_local.sh` (idempotent: it skips when account 1
already holds a balance).

If you ever face an unseeded chain (older node image), seed it by hand without a rebuild:

```bash
docker exec iep-docker-dev-node-1-1 /iep-node/scripts/docker_init_devnet_local.sh
```

Each node keeps its H2 database on a named volume (`node-{1,2,3}-h2db`), so the chain survives
image rebuilds and restarts. Run `./run-devnet.sh start --clean` for a fresh genesis — always do
that for an automated run, otherwise the suite starts on a chain that previous runs have filled.

## Status

Items 1–3 of the plan are scaffolded:

| # | Layer | Specs | Status |
|---|---|---|---|
| 1 | Smoke (pre-auth) | `specs/smoke/pre-auth.spec.ts` | done |
| 2 | Login flow | `specs/auth/login.spec.ts` | done |
| 3 | Smoke (post-auth) | `specs/smoke/post-auth-routes.spec.ts` | done — covers all top-level modules (dashboard / account-* / messages / voting / assets / aliases / at / crowdfunding / subscriptions / escrow / shuffling / currencies / tool / tools / dao / wallet-settings) |
| 3b | Sign-up wizard pages | `specs/smoke/sign-up.spec.ts` | done — smokes each step renders without console errors |
| 3c | Logout flow | `specs/auth/logout.spec.ts` | done — covers confirm + cancel paths |
| 4 | Visual regression | `specs/visual/welcome.visual.spec.ts`, `specs/visual/sign-up.visual.spec.ts`, `specs/visual/post-auth.visual.spec.ts` | scaffolded — covers welcome (3 states), sign-up wizard (steps 1/2/3 with random passphrase masked), and **all** top-level post-auth modules. Run `RUN_VISUAL=1 npm run snapshot` to capture goldens. See **Migration regression workflow** below. |
| 5 | Form interaction (validation only) | `specs/forms/send.spec.ts` | done — Send form: required fields + toggles + validation + submit enable/disable |
| 5b | Receive view | `specs/forms/receive.spec.ts` | done — pins displayed public key to TEST_ACCOUNT_1_PUBLIC_KEY; verifies QR canvas rendered with non-zero size |
| - | Sanity (chain pre-flight) | `specs/sanity/devnet-funded.spec.ts` | done — fails fast if Test Account 1 isn't funded on the chain we're hitting |
| - | Sanity (quorum pre-flight) | `specs/sanity/devnet-quorum.spec.ts` | done — three nodes must converge on one tip, hold ≥2 connected peers each, and agree on a historical block. The wallet only talks to node-1, so without this a broken mesh stays invisible. |
| 26 | Cross-node propagation | `specs/sync/tx-propagation.spec.ts` | done — sends 1 XIN through the wallet (node-1), then asserts node-2 and node-3 carry the tx **in the same block** and applied the same recipient balance; second test pins that the tips stay aligned afterwards. |
| 6 | Real send-XIN happy path | `specs/forms/send-tx.spec.ts` | done — drives the full wizard (form → Next → auto-sign → Broadcast); asserts unconfirmedBalanceTQT drops by amount + fee. Three variants: (a) basic send, (b) send with **encrypted private-message attachment** (`cryptoService.encryptMessage` pipeline), (c) **send-secret HTLC / phased payment** (expert-mode Secret tab; SHA-256 hashed secret + 1440-block lock-up; covers the SEND_SECRET subtype attachment encoding). |
| 7 | Sign-up wizard walkthrough | `specs/auth/sign-up-flow.spec.ts` | done — disclaimer → passphrase capture → confirm → dashboard |
| 8 | Transactions list (ngx-datatable) | `specs/forms/transactions.spec.ts` | done — sends a tx via API, asserts a row appears in the wallet's transactions page |
| 9 | Send-message form | `specs/forms/send-message.spec.ts` | done — fields, validation, toggle, submit enable/disable |
| 10 | Sidebar navigation | `specs/smoke/sidebar-nav.spec.ts` | done — sidebar renders, Dashboard link routerLink works, Expert/Basic toggle changes label, top-level submenu expands on click |
| 11 | Account detail | `specs/forms/account-detail.spec.ts` | done — accountRS matches TEST_ACCOUNT_1_RS; non-zero balance shown via amountTqt pipe |
| 12 | Bookmarks (IndexedDB) | `specs/forms/bookmarks.spec.ts` | done — add → list re-renders → reload persists (catches angular2-indexeddb replacement breakage) |
| 13 | Asset list | `specs/forms/assets.spec.ts` | done — ngx-datatable mounted, search input editable, i18n title rendered (not bare key) |
| 14 | Expert/Basic toggle | `specs/forms/expert-toggle.spec.ts` | done — sidebar Advanced submenu reveal, Send & Receive layout swap, in-memory-only persistence pinned |
| 15 | Advanced sub-routes smoke | extension of `specs/smoke/post-auth-routes.spec.ts` | done — added 7 routes: `/account/{control,balance-lease,search-account,lessors,properties,block-generation,funding-monitor}` |
| 16 | Expert-mode visual | `specs/visual/expert-mode.visual.spec.ts` | scaffolded — covers `/account/send` and `/account/receive-tab` in expert mode (pixel + aria); baselines pending capture |
| 17 | Sweetalert2 modal contract | `specs/forms/sweetalert-modal.spec.ts` | done — pins logout-modal shape (title, type:warning icon, checkbox input, custom `btn-success`/`btn-danger` button classes) so the v7→v11 upgrade can't silently break it |
| 18 | Issue-Asset wizard | `specs/forms/issue-asset.spec.ts` | done — drives the second archwizard form (4 required fields with custom `minValue="1"`); reaches confirm step + asserts signed bytes are hex; deliberately stops short of broadcast |
| 19 | Send-form validator boundaries | extension of `specs/forms/send.spec.ts` | done — pins `minValue="1"` directive: 0 fails, -1 fails, 1 (boundary) passes — catches a custom-validator regression after the Angular 6→20 migration |
| 20 | ng-bootstrap popover trigger | `specs/forms/popover.spec.ts` | done — hover the Send recipient question-mark icon → assert `ngb-popover-window` mounts with translated content → mouseleave dismisses (pins ng-bootstrap @1.x→19 popover contract) |
| 21 | Messages module functional | `specs/forms/messages.spec.ts` | done — ngx-datatable mounts on `/messages/show-messages`, filter button group has ≥3 buttons, column headers + page title aren't bare i18n keys |
| 22 | Issue Currency wizard | `specs/forms/issue-currency.spec.ts` | done — drives the 3-step Monetary System currency-issuance wizard (name + code + description → type/decimals/supply → confirm); covers the CURRENCY_ISSUANCE subtype attachment encoding + auto-derived maxSupply via `(input)` handler; stops short of broadcast |
| 23 | Account Properties (set + list) | `specs/forms/properties.spec.ts` | done — set-property 2-step wizard (recipient/key/value → confirm; SET_ACCOUNT_PROPERTY subtype) + my-properties + external-properties datatables (covers the route `data: { propertyType }` reuse pattern) |
| 24 | Create Poll wizard | `specs/forms/create-poll.spec.ts` | done — 3-step archwizard with **dynamic-array option fields** (`addNewOption()` + `*ngFor` over `pollOptions`); covers POLL_CREATION subtype + the `isSecondStepValid` derived flag that gates which Next button renders; also exercises the sweetalert2 InfoAlertBox info dialog dismissal in a real flow |
| 25 | Create Alias wizard | `specs/forms/create-alias.spec.ts` | done — 2-step archwizard for alias-name → URI mapping (ALIAS_ASSIGNMENT subtype); exercises a `<select>`-driven prefix dropdown with `(change)` placeholder swap |

## Usage

### One-time setup

```bash
cd ~/git/iep/iep-wallet-ui/e2e
npm install                            # pulls @playwright/test
npx playwright install chromium        # downloads the browser binary
```

### Running the tests

The tests assume the dev compose stack is up and serving the wallet at
`http://node-1/wallet/`. Bring it up in a separate terminal first:

```bash
cd ~/git/iep/iep-docker-dev && ./run-devnet.sh start
```

Then from `iep-wallet-ui/e2e/`:

```bash
npm test                              # all projects, headless (default)
npm run test:headed                   # same, but with a visible browser
npm run test:ui                       # interactive UI mode (per-step playback,
                                      # network panel, console, DOM snapshots —
                                      # best for debugging a failing test)
npm run report                        # open the last HTML report in a browser
```

The default reporter is `list`, so `npm run report` only finds something if the run
emitted an HTML report. Ask for it explicitly:

```bash
npx playwright test --reporter=list,html   # then:
npm run report
```

### Running a single project / file / test

Playwright's CLI accepts the same selectors:

```bash
# By project (defined in playwright.config.ts: unauthenticated | authenticated | visual-*)
npx playwright test --project=authenticated

# By file
npx playwright test specs/auth/login.spec.ts

# By test title (substring match)
npx playwright test -g "navigates to dashboard"

# Combine
npx playwright test --project=authenticated -g "dashboard"
```

### Debugging a failing test

1. **Inspect the trace** — every failed test writes one to
   `test-results/<test-name>/trace.zip`. Open with:
   ```bash
   npx playwright show-trace test-results/<test-name>/trace.zip
   ```
   You get a timeline of every action with DOM snapshots, network, and console.
2. **Re-run with the UI** — `npm run test:ui`, then click the failing test.
   Step through actions, see selectors highlighted on the page.
3. **Run headed** — `npm run test:headed -- specs/auth/login.spec.ts` to see
   it happen in a real browser.
4. **In IntelliJ** — the JetBrains Playwright plugin gives you gutter ▶️
   icons next to each `test()` and integrates the trace viewer.

### Updating tests after a wallet UI change

If a selector breaks (e.g. you renamed an `input` from `passPhrase` to
`passphrase`), update the matching Page Object under `pages/`. The specs
themselves rarely need to change — that's what the POMs are for.

If you add a new route worth smoke-testing, append to:
- `POST_AUTH_ROUTES` in `specs/smoke/post-auth-routes.spec.ts` (functional smoke)
- `POST_AUTH_VISUAL_ROUTES` in `specs/visual/post-auth.visual.spec.ts` (visual)

### Tuning timeouts

All per-action waits use `DEFAULT_TIMEOUT_MS` from `fixtures/timeouts.ts`
(currently 10 s). Edit that file once to raise/lower across the whole suite.
The per-test budget (`testTimeout` in `playwright.config.ts`, currently 60 s)
is intentionally separate — it bounds the total time a single test can run.

## Dialogs: the alert fixture

The wallet pops a sweetalert2 dialog after most write operations and nothing
closes it. The dialog's backdrop swallows pointer events, so it does not just
clutter the trace — the next click lands on the overlay instead of the target.

**Rule: informational dialogs are dismissed as soon as they appear, and specs
assert on what was recorded rather than on the live DOM.**

`fixtures/test.ts` exports the `test` and `expect` every spec must import. It
carries an auto-fixture that polls for a dialog with a *visible* confirm button
and no *visible* cancel button, records title, body and kind, then closes it.
Visibility matters: sweetalert2 renders the cancel button and every icon variant
into each dialog and hides the unused ones, so matching on presence excludes
every informational dialog and the fixture silently does nothing.

```ts
import { test, expect } from '../../fixtures/test';   // never from '@playwright/test'

test('…', async ({ page, infoAlerts }) => {
  // … drive the flow …
  await expect.poll(() => infoAlerts.last()?.kind).toBe('success');
});
```

An **error** dialog is recorded, dismissed so the run continues, and then fails
the test in teardown. Clicking a real wallet error away silently would turn a
broken flow into a green run — the first full run with this fixture in place
immediately surfaced one on `tools/chain-viewer/peers`.

A spec that asserts on the dialog itself opts out per file, with the reason:

```ts
test.use({ autoDismissAlerts: false });
```

Four specs do (`funding-monitor`, `asset-trading`, `my-subscriptions`, `at`,
`create-dao`) because they check the dialog's own content or icon.

Note the fixture closes the dialog outside the test's action steps, so the trace
shows no "click OK" — the dialog simply disappears between two snapshots. The
evidence that it fired is `infoAlerts`, not a visible step.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://node-1/wallet/` | Where the wallet is served. Override for local `ng serve` (e.g. `http://localhost:4200`). |
| `DEVNET_NODE_HOSTS` | `node-1,node-2,node-3` | Hosts the quorum sanity spec checks. All three must resolve (`/etc/hosts` → `127.0.0.1`, Traefik routes by `Host:`). |
| `SKIP_QUORUM_CHECK` | unset | `1` skips the three-node quorum pre-flight (single-node runs). |
| `TEST_ACCOUNT_1_PASSPHRASE` | a 15-word throwaway | Account used by post-auth specs. Override for tests that need a devnet-balanced account. |
| `CI` | unset | When set, retries=2 and HTML reporter is emitted. |

## Project structure

```
e2e/
├── playwright.config.ts        ← projects, baseURL, viewport, timeouts
├── fixtures/
│   └── test-accounts.ts        ← deterministic passphrases
├── pages/                      ← Page Object Model
│   ├── welcome.page.ts
│   └── dashboard.page.ts
├── specs/
│   ├── smoke/
│   │   ├── pre-auth.spec.ts            ← item 1
│   │   └── post-auth-routes.spec.ts    ← item 3
│   └── auth/
│       └── login.spec.ts               ← item 2
└── README.md
```

## Why a separate sub-project?

The root `iep-wallet-ui` is on Angular 6 with `rxjs-compat`, `node-sass@4`, `@angular/cli@6` — adding `@playwright/test` to its `package.json` triggers peer-dep churn and bad resolutions. Isolation keeps the e2e suite stable, and after the framework upgrade nothing in `e2e/` needs to change.

## Known noise filters

- `ng-cli-ws` / `webpack-dev-server` console errors are dev-server artefacts of Traefik stripping the path prefix; tests filter them out.
- The wallet's hash routing means URLs are `/wallet/index.html#/dashboard` etc. — `playwright.config.ts`'s baseURL ends with `index.html`, and tests navigate via `goto('#/...')`.

## Migration regression workflow

The visual specs (`specs/visual/*.visual.spec.ts`) were written as the safety net for
the Angular 6 → 18 migration, but **their baselines were never captured** — no
`*-snapshots/` directory is committed, which is why the `visual-*` projects stay behind
`RUN_VISUAL=1`. The migration has landed, so baselines taken now pin the *current* build
and protect future changes instead.

Baselines are OS- and browser-build-specific: capture and replay them on the same setup
(ideally inside `mcr.microsoft.com/playwright:v1.59.1-noble` with `--network host`), or
they will drift for no reason.

### 1. Capture baselines (current build)

```bash
cd ~/git/iep/iep-docker-dev && ./run-devnet.sh start
cd ~/git/iep/iep-wallet-ui/e2e
npm run snapshot           # = playwright test --update-snapshots
git add specs/visual/*-snapshots/
git commit -m "wallet-ui e2e: visual baselines (Angular 6, pre-migration)"
```

This writes golden PNGs under `specs/visual/<spec-name>-snapshots/` and aria
snapshot YAML inside the spec files. Both should be committed.

### 2. After the framework migration

```bash
npm test                   # any visual drift fails the relevant test
```

For each failure, Playwright's HTML report shows side-by-side `expected /
actual / diff` images. Decide per case:

- **Drift is unintentional** → fix the regression in the wallet code, re-run
- **Drift is intentional** (cosmetic improvement, deliberate redesign) →
  `npm run snapshot` to accept the new baseline, then commit

### 3. Add new screens later

Append rows to the `POST_AUTH_VISUAL_ROUTES` table in
`specs/visual/post-auth.visual.spec.ts`, run `RUN_VISUAL=1 npm run snapshot`, commit
the new goldens. For pre-auth screens (welcome / sign-up steps), edit the
matching spec directly — they are not table-driven.

### Visual coverage matrix

| Spec | Routes / states |
|---|---|
| `welcome.visual.spec.ts` | empty form, with passphrase, insecure-warning, aria of `<form>` |
| `sign-up.visual.spec.ts` | step-1 disclaimer, step-2 (random passphrase masked), step-3 confirm — pixel + aria each |
| `post-auth.visual.spec.ts` | dashboard, account/{detail,send,receive-tab,transactions,bookmark,ledger-view}, messages, voting, wallet-settings, assets, aliases, at, crowdfunding, subscriptions, escrow, shuffling, currencies, tool/user-guide, tools, dao — pixel + aria each |

### What the snapshots actually capture

- **Pixel snapshots** (`expect(page).toHaveScreenshot`) — full-page PNG, 1%
  pixel-diff threshold, animations disabled, fonts + images settled,
  dynamic regions (timestamps, balances, block heights) masked via the
  `mask` parameter from `fixtures/visual.ts`
- **Aria snapshots** (`expect(...).toMatchAriaSnapshot`) — semantic DOM
  structure independent of pixel rendering. Catches drift like an extra
  wrapper `<div>` or a removed `aria-label` even when the screenshot
  still matches

The two are complementary: visual catches CSS/layout regressions, aria
catches DOM/semantic regressions. Run both before declaring the migration
visually-clean.

### Stability tips

- Run inside the same OS + browser version each time. Playwright's bundled
  Chromium pinned by `package.json` covers the browser; Linux + the pinned
  `@playwright/test` version covers the OS as long as both baseline and
  post-migration runs happen on the same machine type. For CI: use the
  `mcr.microsoft.com/playwright:vX-jammy` Docker image.
- Always run against the **devnet** stack (`run-devnet.sh`). The suite is
  devnet-calibrated (the sanity spec pins `peerPort=8775`) and the authenticated
  specs broadcast real transactions — pointing them at testnet or mainnet is
  meaningless at best and expensive at worst.
- If a snapshot flakes from a dynamic region we haven't masked yet, add the
  selector to `maskDynamicRegions()` in `fixtures/visual.ts` and re-snapshot.

## Wallet auth note

The wallet stores its unlocked passphrase / derived key in **sessionStorage**, which Playwright's `storageState` does not preserve. Rather than reverse-engineer the storage shape, every post-auth spec re-runs the welcome login in a `beforeEach`. Cost is ~2 s/test in headless Chromium.
