import {Component, OnInit} from '@angular/core';
import {Page} from '../../../config/page';
import {DaoService} from '../dao.service';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {Router} from '@angular/router';
import {AccountService} from '../../account/account.service';

@Component({
    selector: 'app-show-daos',
    templateUrl: './show-daos.component.html',
    styleUrls: ['./show-daos.component.scss']
})
export class ShowDaosComponent implements OnInit {

    public page = new Page();
    public myPage = new Page();
    public rows = new Array<any>();
    public myRows = new Array<any>();
    public columnModes = ColumnMode;
    public modeAll = true;
    private account;

    constructor(
        private accountService: AccountService,
        private daoService: DaoService,
        private router: Router
    ) {
    }

    ngOnInit() {
        this.setPage({offset: 0});
        this.account = this.accountService.getAccountDetailsFromSession('accountId');
    }

    public setPage(pageInfo) {
        this.rows = [];
        this.page.pageNumber = pageInfo.offset;
        this.page.totalPages = 1;
        this.getDaosAliases();
    }

    public getDaosAliases() {
        this.daoService.getAliases().subscribe((response: any) => {
            if (!response) {
                response = [];
            }
            const aliases = response;
            if (!aliases) {
                return;
            }
            this.daoService.getMyDaoTokens(this.account).subscribe(assets => {
                // All
                this.rows = aliases;
                this.page.size = this.rows.length;
                this.page.totalElements = this.rows.length;
                // My
                this.myRows = aliases.filter(al => assets.map(ass => ass.name.split('TT').shift()).includes(al.aliasName));
                this.myPage.size = this.myRows.length;
                this.myPage.totalElements = this.myRows.length;
            });
        });
    }

    public routeUri(uri) {
        DaoService.currentDAO = uri;
        this.router.navigate([`dao/show-daos/${uri}/teams`]).then();
    }

    public accountId(value) {
        return value.split('acct:').pop().split('@xin').shift();
    }

    sendMessage(aliasURI) {
        this.router.navigate(['/messages/send-message'], {queryParams: {recipient: this.accountId(aliasURI)}}).then();
    }

    showDaoPolls(value) {
        this.router.navigate([`dao/show-polls/${this.accountId(value)}`]).then();
    }

    onTabChange() {
        this.modeAll = !this.modeAll;
        this.setPage({offset: 0});
    }
}
