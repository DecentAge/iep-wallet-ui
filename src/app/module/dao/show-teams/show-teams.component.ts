import {Component, OnInit} from '@angular/core';
import {Page} from '../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {AssetsService} from '../../assets/assets.service';
import {DaoService} from '../dao.service';
import {ActivatedRoute, Router} from '@angular/router';
import {AccountService} from '../../account/account.service';
import {SessionStorageService} from '../../../services/session-storage.service';
import {CommonService} from '../../../services/common.service';
import {AliasesService} from '../../aliases/aliases.service';

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
    public editMode = false;
    public webPageUrl;
    public chatChannelUrl;
    public sharedDataLinkUrl;
    public sharedDataLinkAlias;
    public webPageUrlAlias;
    public chatChannelUrlAlias;
    public daoAccountRs = null;

    constructor(
        private accountService: AccountService,
        private assetsService: AssetsService,
        private daoService: DaoService,
        private router: Router,
        private route: ActivatedRoute,
        private sessionStorageService: SessionStorageService,
        private commonService: CommonService,
        private aliasesService: AliasesService
    ) {
    }

    ngOnInit() {
        this.daoName = this.route.snapshot.params['daoName'];
        this.daoService.getDAO(this.daoName).subscribe((alias: any) => {
            this.daoAccountRs = alias.accountRS;
        });
        this.setPage({offset: 0});
        this.accountRs = this.accountService.getAccountDetailsFromSession('accountRs');
        this.daoService.getDaoExternalLinks(this.daoName).subscribe((response) => {
            if (response.webPageUrl.length > 0) {
                this.webPageUrlAlias = response.webPageUrl.shift()
                this.webPageUrl = this.webPageUrlAlias.aliasURI.split('url:').pop().split('@xin').shift();
            }
            if (response.chatChannel.length > 0) {
                this.chatChannelUrlAlias = response.chatChannel.shift();
                this.chatChannelUrl = this.chatChannelUrlAlias.aliasURI.split('url:').pop().split('@xin').shift();
            }
            if (response.sharedDataLink.length > 0) {
                this.sharedDataLinkAlias = response.sharedDataLink.shift();
                this.sharedDataLinkUrl = this.sharedDataLinkAlias.aliasURI.split('url:').pop().split('@xin').shift();
            }
        });
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
        this.router.navigate([`dao/show-daos/${this.daoName}/teams/${uri}`]).then();
    }

    public reload() {
        this.setPage({offset: 0});
    }

    transferTeamToken(teamToken) {
        this.daoService.transferTeamToken(teamToken);
    }

    goBack() {
        this.router.navigate([`dao/show-daos`]).then();
    }

    sendMessage(teamToken) {
        this.router.navigate(['/messages/send-message'], {queryParams: {recipient: teamToken.teamWallet}}).then();
    }

    createPoll(teamToken) {
        this.router.navigate(['/voting/create-poll'], {queryParams: {recipient: teamToken.asset}}).then();
    }

    toggleEditMode() {
        this.editMode = !this.editMode;
    }

    updateExternalDaoInfo() {
        const publicKey = this.commonService.getAccountDetailsFromSession('publicKey');
        const fee = 1;
        const queries = []

        const webUrlAliasName = `${this.daoName}UL`;
        const webPageAlias = !this.webPageUrl ? '' : `url:${this.webPageUrl}@xin`;
        queries.push(this.aliasesService.setAlias(publicKey, webUrlAliasName, webPageAlias, fee));

        const chatChannelAliasName = `${this.daoName}CT`;
        const chatChannelAlias = !this.chatChannelUrl ? '' : `url:${this.chatChannelUrl}@xin`;
        queries.push(this.aliasesService.setAlias(publicKey, chatChannelAliasName, chatChannelAlias, fee));

        const sharedDataLinkAliasName = `${this.daoName}SL`;
        const sharedDataLinkAlias = !this.sharedDataLinkUrl ? '' : `url:${this.sharedDataLinkUrl}@xin`;
        queries.push(this.aliasesService.setAlias(publicKey, sharedDataLinkAliasName, sharedDataLinkAlias, fee));

        this.daoService.updateExternalDaoInfo(queries);
        this.editMode = false;
    }
}
