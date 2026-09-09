import { Locator, Page, expect } from '@playwright/test';
import { DEFAULT_TIMEOUT_MS } from '../fixtures/timeouts';

/**
 * Page Object for the create-dao wizard (`#/wallet/dao/create-dao`).
 *
 * The wizard is unusual: every step lives on its own route and each step
 * *navigates* to the next one after its broadcast succeeds, re-mounting
 * `DaoComponent` and replaying `wizard.goToStep(...)` to restore the position.
 * All four steps stay in the DOM at once and three of them share the input
 * names `name` / `prefix` / `quantity` / `description`, so every locator here
 * is scoped to its step component.
 */

/** Uppercase letters without X. The wizard's own `alphanumericPattern`
 *  (`^[a-zA-WY-Z0-9]$`) rejects an uppercase X, and DaoService parses names
 *  back out by splitting on the XT / XN / XE / XR markers — a stray X would
 *  corrupt every derived name. */
const SAFE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWYZ';

function randomToken(length: number): string {
  return Array.from(
    { length },
    () => SAFE_LETTERS[Math.floor(Math.random() * SAFE_LETTERS.length)],
  ).join('');
}

export interface DaoWizardNames {
  daoName: string;
  daoPrefix: string;
  teamName: string;
  teamPrefix: string;
  founderRole: string;
  memberRole: string;
  /** issueAsset name for the DAO token. */
  daoAssetName: string;
  /** setAlias name registering the DAO. */
  daoAliasName: string;
  /** issueAsset name for the team token — built from the DAO *prefix*, not its name. */
  teamAssetName: string;
  /** setAlias name registering the team. */
  teamAliasName: string;
}

/** Randomised, chain-unique names for one wizard run (asset names and alias
 *  names are unique on chain, so a fixed name would only work once). */
export function randomDaoNames(): DaoWizardNames {
  const daoName = `E2E${randomToken(4)}`;
  const daoPrefix = randomToken(4);
  const teamName = `TEAM${randomToken(3)}`;
  const teamPrefix = randomToken(3);

  return {
    daoName,
    daoPrefix,
    teamName,
    teamPrefix,
    founderRole: `FOUNDER${randomToken(2)}`,
    memberRole: `MEMBER${randomToken(2)}`,
    daoAssetName: `DAO${daoPrefix}`,
    daoAliasName: `DAO${daoName}XT${daoPrefix}`,
    teamAssetName: `DAO${daoPrefix}XE${teamPrefix}`,
    teamAliasName: `DAO${daoPrefix}XN${teamName}XE${teamPrefix}`,
  };
}

/** Alias a team member gets registered under (DaoService.addTeamMembers). */
export function teamMemberAliasName(names: DaoWizardNames, role: string): string {
  return `DAO${names.daoPrefix}XN${names.teamName}XR${role}XE${names.teamPrefix}`;
}

export class CreateDaoWizardPage {
  readonly page: Page;

  readonly daoStep: Locator;
  readonly teamStep: Locator;
  readonly foundersStep: Locator;
  readonly membersStep: Locator;

  readonly daoNext: Locator;
  readonly teamNext: Locator;
  readonly foundersNext: Locator;
  readonly addFounderButton: Locator;
  readonly addMemberButton: Locator;
  readonly finish: Locator;

  readonly alert: Locator;

  constructor(page: Page) {
    this.page = page;

    this.daoStep = page.locator('app-create-dao');
    this.teamStep = page.locator('app-create-dao-team');
    this.foundersStep = page.locator('app-founders');
    this.membersStep = page.locator('app-add-team-members');

    this.daoNext = this.daoStep.locator('button.btn-gradient');
    this.teamNext = this.teamStep.locator('button.btn-gradient');
    this.foundersNext = this.foundersStep.locator('button.btn-gradient');
    this.addFounderButton = this.foundersStep.locator('a.btn-gradient:has(i.fa-user-plus)');
    this.addMemberButton = this.membersStep.locator('a.btn-gradient:has(i.fa-user-plus)');
    this.finish = this.membersStep.locator('button.btn-gradient:has(i.fa-check)');

    this.alert = page.locator('.swal2-container');
  }

  async goto(): Promise<void> {
    await this.page.goto('#/wallet/dao/create-dao');
    await expect(
      this.daoStep.locator('input[name="name"]'),
      'create-dao wizard did not mount at #/wallet/dao/create-dao',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }

  async fillDaoStep(names: DaoWizardNames, quantity: string, description: string): Promise<void> {
    await this.daoStep.locator('input[name="name"]').fill(names.daoName);
    await this.daoStep.locator('input[name="prefix"]').fill(names.daoPrefix);
    await this.daoStep.locator('input[name="quantity"]').fill(quantity);
    const desc = this.daoStep.locator('textarea[name="description"]');
    await desc.fill(description);
    await desc.blur();
  }

  /** Waits until the wizard has re-mounted on the create-team route and
   *  replayed itself onto step 2. */
  async expectTeamStepActive(): Promise<void> {
    await expect(
      this.teamStep.locator('input[name="name"]'),
      'create-team step never became visible after the wizard re-mounted at ' +
      '/dao/create-dao/create-team — the goToStep(0)/goToStep(1) replay in ' +
      'CreateDaoTeamComponent.ngAfterViewInit is what restores the wizard position',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
  }

  async fillTeamStep(names: DaoWizardNames, quantity: string, description: string): Promise<void> {
    await this.teamStep.locator('input[name="name"]').fill(names.teamName);
    await this.teamStep.locator('input[name="prefix"]').fill(names.teamPrefix);
    await this.teamStep.locator('input[name="quantity"]').fill(quantity);
    const desc = this.teamStep.locator('textarea[name="description"]');
    await desc.fill(description);
    await desc.blur();
  }

  /**
   * Rows of a repeated sub-form, addressed positionally.
   *
   * These rows cannot be addressed by input name: both templates build the name
   * by interpolation (`name="founderWalletAlias-{{i}}"`), which Angular consumes
   * as NgModel's `name` input instead of emitting a DOM attribute — unlike the
   * static `name="name"` of the two earlier steps.
   */
  private repeatedRows(step: Locator): Locator {
    return step.locator('.form-body > .row').filter({ has: this.page.locator('input[type="text"]') });
  }

  async addFounder(
    index: number,
    founder: { role: string; address: string; allocation: string },
  ): Promise<void> {
    await this.addFounderButton.click();
    const row = this.repeatedRows(this.foundersStep).nth(index);
    await expect(
      row,
      `founder row ${index} did not render after addFounder() — the *ngFor over ` +
      'createFounderForm.founders may have broken',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    await row.locator('input[type="text"]').first().fill(founder.role);
    await row.locator('input[type="text"]').nth(1).fill(founder.address);
    // The allocation input carries the same interpolated name as the wallet-alias
    // input, so it is told apart by type.
    const allocation = row.locator('input[type="number"]');
    await allocation.fill(founder.allocation);
    await allocation.blur();
  }

  async addTeamMember(index: number, member: { role: string; address: string }): Promise<void> {
    await this.addMemberButton.click();
    const row = this.repeatedRows(this.membersStep).nth(index);
    await expect(
      row,
      `team-member row ${index} did not render after addTeamMember()`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    await row.locator('input[type="text"]').first().fill(member.address);
    const role = row.locator('input[type="text"]').nth(1);
    await role.fill(member.role);
    await role.blur();
  }

  /**
   * Waits for the broadcast-result dialog, fails with its text if the wallet
   * reported an error, then dismisses it — dismissing is what triggers the
   * router.navigate() to the next wizard route.
   *
   * `mustMentionOneOf` are tx ids captured off the wire. The dialog body is
   * `translateInfoMessage('success-broadcast-message') + <tx id>`, so requiring
   * one of them proves the wallet reported the transaction it really broadcast
   * and that the message went through the translator (a raw i18n key would
   * carry no id).
   */
  async confirmSuccessAlert(
    what: string,
    mustMentionOneOf: string[] = [],
    timeoutMs: number = DEFAULT_TIMEOUT_MS * 3,
  ): Promise<void> {
    await expect(
      this.alert,
      `${what}: the wallet never showed the broadcast-result dialog`,
    ).toBeVisible({ timeout: timeoutMs });

    const text = ((await this.alert.innerText()) ?? '').replace(/\s+/g, ' ').trim();
    await expect(
      this.alert.locator('.swal2-icon.swal2-success'),
      `${what}: the wallet reported a failure instead of a successful broadcast — ` +
      `dialog said: "${text}"`,
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    if (mustMentionOneOf.length > 0) {
      expect(
        mustMentionOneOf.some((txId) => text.includes(txId)),
        `${what}: the success dialog does not name any of the transactions the wallet just ` +
        `broadcast (${mustMentionOneOf.join(', ')}). Dialog said: "${text}"`,
      ).toBe(true);
    }

    await this.alert.locator('.swal2-confirm').click();
    await expect(
      this.alert,
      `${what}: the result dialog stayed open after OK — the wallet never ran the ` +
      'navigate() that follows it',
    ).toBeHidden({ timeout: DEFAULT_TIMEOUT_MS });
  }

  /**
   * Opens `#/wallet/dao/show-daos/all` and asserts the DAO is listed with the
   * given root account. The table pages client-side at 10 rows and every run of
   * this spec adds one more DAO to the shared devnet, so this walks the pager;
   * each hop is bounded by the pager's own active-page number rather than a
   * sleep.
   */
  async expectDaoListed(daoName: string, rootAccountRS: string, maxPages = 40): Promise<void> {
    await this.page.goto('#/wallet/dao/show-daos/all');
    const table = this.page.locator('app-daos');
    await expect(
      table.locator('datatable-body-row').first(),
      'the show-daos table stayed empty — getAliasesLike(aliasPrefix=DAO) returned nothing',
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });

    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      const row = table.locator('datatable-body-row', { hasText: daoName }).first();
      if ((await row.count()) > 0) {
        await expect(
          row.locator('a.hyperlink'),
          `the show-daos name cell for "${daoName}" shows something else — the row text is built ` +
          'by getDaoNameFromDAOAlias(getDaoName(aliasName)), which strips the DAO prefix and the ' +
          'XT shortcode back off the alias',
        ).toHaveText(daoName);
        await expect(
          row,
          `the show-daos row for "${daoName}" does not name ${rootAccountRS} as root account — ` +
          'the alias URI acct:<RS>@xin is not being decoded back into an account',
        ).toContainText(rootAccountRS);
        return;
      }
      const nextPage = table.locator('datatable-pager li:not(.disabled) a:has(i.datatable-icon-right)');
      if ((await nextPage.count()) === 0) break;
      await nextPage.first().click();
      await expect(
        table.locator('datatable-pager li.pages.active a'),
        `the show-daos pager did not advance to page ${pageNo + 1} after clicking next`,
      ).toHaveText(String(pageNo + 1), { timeout: DEFAULT_TIMEOUT_MS });
    }

    throw new Error(
      `DAO "${daoName}" never appeared in #/wallet/dao/show-daos/all. Its alias is on chain, so ` +
      'either getAliases() filtered it out (it drops any alias containing XN/XE/XU/XC/XD) or the ' +
      'DaosComponent paging loop stopped fetching before reaching it.',
    );
  }
}
