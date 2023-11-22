import {Component, OnInit} from '@angular/core';
import {Page} from '../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {AssetsService} from '../../assets/assets.service';
import {DaoService} from '../dao.service';
import {ActivatedRoute, Router} from '@angular/router';
import {combineLatest} from 'rxjs';

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

    constructor(
        private assetsService: AssetsService,
        private daoService: DaoService,
        private router: Router,
        private route: ActivatedRoute
    ) {
    }

    ngOnInit() {
        this.daoName = this.route.snapshot.params['daoName'];
        this.setPage({offset: 0});
    }

    public setPage(pageInfo) {
        this.page.pageNumber = pageInfo.offset;
        this.page.totalPages = 1;
        this.daoService.getDaoTeams(`${this.daoName}TN`).subscribe((response: any) => {
            if (!response) {
                response = [];
            }
            const aliases = response;
            if (!aliases) {
                return;
            }
            const tokenNames = [];
            aliases.forEach(el => {
                tokenNames.push(
                    this.daoService.getAssetForDaoTeam(`${el.aliasName.split('TN').shift()}TT${el.aliasName.split('TT').pop()}`)
                );
            });
            combineLatest(tokenNames).subscribe(res => {
                console.log(res);
                this.teamTokens = res.map((token: any) => {
                    return token.assets[0];
                });
                this.rows = aliases.map((alias, index) => {
                    if (!this.teamTokens[index]) {
                        return alias;
                    }
                    alias.teamToken = this.teamTokens[index];
                    alias.teamToken.teamWallet = alias.aliasURI;
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
        this.router.navigate([`dao/show-daos/${uri}/teams`]).then();
        console.log(uri);
    }

    public reload() {
        this.setPage({offset: 0});
    }

    transferTeamToken(teamToken) {
        this.daoService.transferTeamToken(teamToken);
    }
}
