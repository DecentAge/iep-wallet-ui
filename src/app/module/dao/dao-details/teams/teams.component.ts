import {Component, OnInit} from '@angular/core';
import {DaoService} from '../../dao.service';
import {Page} from '../../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {ShowDaosMode} from '../../enums';
import {AccountService} from '../../../account/account.service';
import {AssetsService} from '../../../assets/assets.service';
import {ActivatedRoute, Router} from '@angular/router';

@Component({
    selector: 'app-teams',
    templateUrl: './teams.component.html',
    styleUrls: ['./teams.component.scss']
})
export class TeamsComponent implements OnInit {

    public page = new Page();
    public rows = new Array<any>();
    public columnModes = ColumnMode;
    public daoName = '';
    public teamTokens;
    public accountRs;
    public editMode = false;
    public webPageUrl;
    public webPageUrlAlias;
    public chatChannelUrlAlias;
    public daoAccountRs = null;
    public viewMode: ShowDaosMode;

    constructor(
        private accountService: AccountService,
        private assetsService: AssetsService,
        private daoService: DaoService,
        private router: Router,
        private route: ActivatedRoute,
    ) {
    }

    ngOnInit() {
        this.daoName = DaoService.currentDAO;
        this.viewMode = DaoService.showDaoMode;
        this.daoService.getDAOAlias(this.daoName).subscribe((alias: any) => {
            this.daoAccountRs = alias.accountRS;
        });
        this.setPage({offset: 0});
    }

    public setPage(pageInfo) {
        this.page.pageNumber = pageInfo.offset;
        this.page.totalPages = 1;
        this.daoService.getDaoTeams(`${this.daoName}TN`).subscribe(success_ => {
            success_.subscribe(response => {
                this.teamTokens = response.res.map((token: any) => {
                    return token.assets[0];
                });
                this.rows = response.aliases.map((alias, index) => {
                    if (!this.teamTokens[index]) {
                        return alias;
                    }
                    alias.teamToken = this.teamTokens[index];
                    alias.teamToken.teamWallet = alias.aliasURI.split('acct:').pop().split('@xin').shift();
                    return alias;
                });
                this.page.size = this.rows.length;
                this.page.totalElements = this.rows.length;
            })
        });
    }

    public routeUri(uri) {
        DaoService.currentDAO = this.daoName;
        DaoService.currentDAOTeam = uri;
        const viewMode = DaoService.showDaoMode;
        this.router.navigate([`dao/show-daos/${viewMode}/${this.daoName}/teams/${uri}`]).then();
    }

    public reload() {
        this.setPage({offset: 0});
    }

    transferTeamToken(teamToken) {
        this.daoService.transferTeamToken(teamToken);
    }

    sendMessage(teamToken) {
        this.router.navigate(['/messages/send-message'], {queryParams: {recipient: teamToken.teamWallet}}).then();
    }

    createPoll(teamToken) {
        this.router.navigate(['/voting/create-poll'], {queryParams: {recipient: teamToken.asset, dao: this.daoName}}).then();
    }
}
