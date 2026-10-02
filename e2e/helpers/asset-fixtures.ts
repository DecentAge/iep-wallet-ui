import { APIRequestContext, Page, expect, request as pwRequest } from '@playwright/test';
import { WelcomePage } from '../pages/welcome.page';
import { DashboardPage } from '../pages/dashboard.page';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';
import { apiOriginFromBaseURL } from './broadcast-confirm';

/**
 * Node-API fixture helpers for the asset read-side specs (search, lists,
 * history, expected-* views). Everything here signs on the node with
 * `secretPhrase`, which only the devnet allows.
 */

export const API_BASE = process.env.API_BASE ?? `${apiOriginFromBaseURL(process.env.BASE_URL)}/api`;
export const TQT_PER_XIN = 100_000_000;

/** Kept well under the 60s hook budget so a stalled devnet surfaces as the
 *  explicit error below, not as a hook timeout. */
const CONFIRM_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class NodeApi {
  private constructor(private readonly ctx: APIRequestContext) {}

  static async create(): Promise<NodeApi> {
    return new NodeApi(await pwRequest.newContext());
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }

  async get(params: Record<string, string>): Promise<any> {
    const resp = await this.ctx.get(API_BASE, { params, timeout: DEFAULT_TIMEOUT_MS });
    return resp.json();
  }

  async post(params: Record<string, string>): Promise<any> {
    const resp = await this.ctx.post(API_BASE, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams(params).toString(),
      timeout: DEFAULT_TIMEOUT_MS,
    });
    return resp.json();
  }

  /** Sign and broadcast on the node; returns the transaction id. */
  async broadcast(what: string, secretPhrase: string, params: Record<string, string>): Promise<string> {
    const sent = await this.post({
      feeTQT: String(TQT_PER_XIN),
      deadline: '80',
      broadcast: 'true',
      secretPhrase,
      ...params,
    });
    if (!sent.transaction || sent.broadcasted !== true) {
      throw new Error(`${what} failed: ${JSON.stringify(sent)}`);
    }
    return sent.transaction;
  }

  /** Poll every listed tx to inclusion in a block, all under one deadline. */
  async awaitConfirmations(txIds: string[], what: string): Promise<void> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    const pending = new Set(txIds);
    while (Date.now() < deadline) {
      for (const txId of [...pending]) {
        const tx = await this.get({ requestType: 'getTransaction', transaction: txId });
        if (tx.block && typeof tx.confirmations === 'number') pending.delete(txId);
      }
      if (pending.size === 0) return;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(
      `${what} tx(s) ${[...pending].join(', ')} did not confirm within ${CONFIRM_TIMEOUT_MS}ms ` +
      '— devnet forging stalled?',
    );
  }

  /** Poll until `probe` returns a value; the fulltext index and the trade
   *  tables trail the block that carries the transaction by a moment. */
  async until<T>(what: string, probe: () => Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const found = await probe();
      if (found !== undefined) return found;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`${what} did not happen within ${CONFIRM_TIMEOUT_MS}ms`);
  }
}

/** Seven random characters: asset names are not chain-unique, but a fresh one
 *  is an unambiguous marker in a datatable and a single Lucene token. */
export function randomToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`.slice(-7);
}

export async function login(page: Page, passphrase: string): Promise<void> {
  const welcome = new WelcomePage(page);
  await welcome.goto();
  await welcome.login(passphrase);
  await new DashboardPage(page).expectVisible();
}

/** Console errors and uncaught exceptions from here on; assert with `expectNoErrors`. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

export function expectNoErrors(errors: string[], where: string): void {
  // Same dev-server noise the route smoke filters out.
  const real = errors.filter(
    (e) => !/ng-cli-ws|webpack-dev-server|\[WDS\]/i.test(e) && !/Failed to load resource:.*404/i.test(e),
  );
  expect(real, `console errors on ${where}:\n${real.join('\n')}`).toEqual([]);
}

/** Text of every body row of a datatable, cells joined by " | ". */
export async function rowTexts(table: import('@playwright/test').Locator): Promise<string[]> {
  return table.locator('datatable-body-row').evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll('datatable-body-cell'))
        .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        .join(' | '),
    ),
  );
}
