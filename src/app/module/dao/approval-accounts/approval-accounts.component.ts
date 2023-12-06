import {Component, OnInit} from '@angular/core';
import {DaoService} from '../dao.service';
import {Page} from '../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {AppConstants} from '../../../config/constants';
import * as alertFunctions from '../../../shared/data/sweet-alerts';
import {CryptoService} from '../../../services/crypto.service';
import {CommonService} from '../../../services/common.service';
import {SessionStorageService} from '../../../services/session-storage.service';
import {AccountService} from '../../account/account.service';

@Component({
    selector: 'app-approval-accounts',
    templateUrl: './approval-accounts.component.html',
    styleUrls: ['./approval-accounts.component.scss']
})
export class ApprovalAccountsComponent implements OnInit {

    public page = new Page();
    public rows = new Array<any>();
    public columnModes = ColumnMode;
    public currentDao = '';
    public currentTeam = '';
    public currentTeamAlias;
    public teamsList;
    public daosList;
    public approvalAccountsForm = {
        quorum: 0,
        accounts: []
    }
    public controlDetected: boolean | null = null;
    public whiteList: Array<string> = [];

    constructor(
        private accountService: AccountService,
        private daoService: DaoService,
        private cryptoService: CryptoService,
        private commonService: CommonService,
        private sessionStorageService: SessionStorageService
    ) {
    }

    ngOnInit() {
        this.daosList = this.daoService.getAccountDaos();
    }

    public setPage(pageInfo) {
        this.page.pageNumber = pageInfo.offset;
        this.page.totalPages = 1;
        this.daoService.getTeamMembers(this.currentTeam).subscribe(response => {
            this.rows = response;
            this.page.size = this.rows.length;
            this.page.totalElements = this.rows.length;
        });
    }

    setDao(dao): void {
        this.currentDao = dao;
        this.daosList = this.daoService.getAccountDaos();
        this.daoService.getDaoTeams(`${dao}TN`).subscribe(success_ => {
            success_.subscribe((response: any) => {
                this.teamsList = response.aliases;
            })
        });
    }

    setTeam(team): void {
        this.currentTeam = team;
        this.currentTeamAlias = this.accountId(
            this.teamsList.filter(t => t.aliasName.split('acct:').pop().split('@xin').shift() === team)[0].aliasURI
        );
        this.accountService.getPhasingOnlyControl(this.currentTeamAlias).subscribe((success) => {
            if (success.account) {
                this.controlDetected = true;
                this.whiteList = [...success.whitelist];

                this.sessionStorageService.saveToSession(AppConstants.controlConfig.SESSION_ACCOUNT_CONTROL_HASCONTROL_KEY,
                    true);
                this.sessionStorageService.saveToSession(AppConstants.controlConfig.SESSION_ACCOUNT_CONTROL_JSONCONTROL_KEY,
                    success);
            } else {
                this.controlDetected = false;
                this.whiteList = [];
                this.sessionStorageService.saveToSession(AppConstants.controlConfig.SESSION_ACCOUNT_CONTROL_HASCONTROL_KEY,
                    false);
                this.sessionStorageService.saveToSession(AppConstants.controlConfig.SESSION_ACCOUNT_CONTROL_JSONCONTROL_KEY,
                    '');

            }
        });
        this.daoService.getTeamMembers(this.currentTeam).subscribe(response => {
            this.rows = response;
            this.page.size = this.rows.length;
            this.page.totalElements = this.rows.length;
        });
    }

    accountId(value) {
        return value.split('acct:').pop().split('@xin').shift();
    }

    handleApproval(event) {
        const approvalAccount = event.target.value;
        if (!event.target.checked) {
            this.approvalAccountsForm.accounts = [...this.approvalAccountsForm.accounts.filter(account => account !== approvalAccount)];
            return;
        }
        this.approvalAccountsForm.accounts.push(approvalAccount);
    }

    validateForm(): boolean {
        return this.approvalAccountsForm.accounts.length > this.approvalAccountsForm.quorum;
    }

    setAccountControl() {
        this.daoService.setAccountControl(this.approvalAccountsForm, this.currentTeamAlias);
    }
}
