import {Component, OnInit} from '@angular/core';
import {Page} from '../../../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {AccountService} from '../../../../account/account.service';
import {AssetsService} from '../../../../assets/assets.service';
import {DaoService} from '../../../dao.service';
import {ActivatedRoute, Router} from '@angular/router';

@Component({
    selector: 'app-dao-team-members',
    templateUrl: './dao-team-members.component.html',
    styleUrls: ['./dao-team-members.component.scss']
})
export class DaoTeamMembersComponent implements OnInit {

    public page = new Page();
    public rows = new Array<any>();
    public columnModes = ColumnMode;
    public daoName = '';
    public teamName = '';
    public teamTokens;
    public accountRs;

    constructor(
        private accountService: AccountService,
        private assetsService: AssetsService,
        private daoService: DaoService,
        private router: Router
    ) {
    }

    ngOnInit() {
        this.daoName = DaoService.currentDAO;
        this.teamName = DaoService.currentDAOTeam;
        this.accountRs = this.accountService.getAccountDetailsFromSession('accountRs');
        this.setPage({offset: 0});
    }

    public setPage(pageInfo) {
        this.page.pageNumber = pageInfo.offset;
        this.page.totalPages = 1;
        this.daoService.getTeamMembers(this.teamName).subscribe(response => {
            this.rows = response;
            this.page.size = this.rows.length;
            this.page.totalElements = this.rows.length;
        });
    }

    public reload() {
        this.setPage({offset: 0});
    }

    public sendMessage(accountId) {
        this.router.navigate(['/messages/send-message'], {queryParams: {recipient: accountId}}).then();
    }

    public accountId(aliasURI) {
        return aliasURI.split('acct:').pop().split('@xin').shift()
    }
}
