import {Component, OnInit} from '@angular/core';
import {Page} from '../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {AssetsService} from '../../assets/assets.service';
import {DaoService} from '../dao.service';
import {ActivatedRoute, Router} from '@angular/router';
import {AccountService} from '../../account/account.service';

@Component({
    selector: 'app-show-teams',
    templateUrl: './show-teams.component.html',
    styleUrls: ['./show-teams.component.scss']
})
export class ShowTeamsComponent implements OnInit {

    public page = new Page();
    public rows = new Array<any>();
    public columnModes = ColumnMode;
    public daoName = '';
    public teamTokens;
    public accountRs;

    constructor(
        private accountService: AccountService,
        private assetsService: AssetsService,
        private daoService: DaoService,
        private router: Router,
        private route: ActivatedRoute
    ) {
    }

    ngOnInit() {
        this.daoName = this.route.snapshot.params['daoName'];
        this.setPage({offset: 0});
        this.accountRs = this.accountService.getAccountDetailsFromSession('accountRs');
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

    public daoDetails() {
        return;
    }

    public routeUri(uri) {
        DaoService.currentDAO = this.daoName;
        DaoService.currentDAOTeam = uri;
        this.router.navigate([`dao/show-daos/${this.daoName}/teams/${uri}`]).then();
    }

    public reload() {
        this.setPage({offset: 0});
    }

    transferTeamToken(teamToken) {
        this.daoService.transferTeamToken(teamToken);
    }
}
