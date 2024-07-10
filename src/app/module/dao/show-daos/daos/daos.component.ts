import {Component, OnChanges, OnInit, SimpleChanges} from '@angular/core';
import {DaoService} from '../../dao.service';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {ShowDaosMode} from '../../enums';
import {AccountService} from '../../../account/account.service';
import {ActivatedRoute, Router} from '@angular/router';
import {Page} from 'app/config/page';

@Component({
    selector: 'app-daos',
    templateUrl: './daos.component.html',
    styleUrls: ['./daos.component.scss']
})
export class DaosComponent implements OnInit, OnChanges {

    getDaoName = this.daoService.getDaoName;

    public columnModes = ColumnMode;
    public viewMode: ShowDaosMode;
    public viewModes = ShowDaosMode;
    public page = new Page();
    public rows = new Array<any>();
    private account;

    constructor(
        private accountService: AccountService,
        private daoService: DaoService,
        private router: Router,
        private route: ActivatedRoute
    ) {
    }

    ngOnInit() {
        this.route.data.subscribe(data => {
            this.viewMode = data.mode;
        });
        this.daoService.changeDaoViewMode(this.viewMode);
        this.setPage({offset: 0, size: 3});
        this.account = this.accountService.getAccountDetailsFromSession('accountId');
    }

    ngOnChanges(changes: SimpleChanges): void {
        console.log(changes);
    }

    public setPage(pageInfo) {
        this.rows = [];
        this.page.pageNumber = pageInfo.offset;
        this.getDaosAliases();
    }

    public getDaosAliases() {
        if (this.viewMode === ShowDaosMode.all) {
            // All
            this.daoService.getAliases().subscribe((response: any) => {
                if (!response) {
                    response = [];
                }
                const aliases = response;
                if (!aliases) {
                    return;
                }
                this.rows = aliases;
                this.page.totalElements = aliases.length;
            });
        } else {
            // My and Mobile views
            this.daoService.getAliases().subscribe((response: any) => {
                if (!response) {
                    response = [];
                }
                const aliases = response;
                if (!aliases) {
                    return;
                }
                this.daoService.getMyDaoTokens(this.account).subscribe(assets => {
                    console.log('MY ASSETS:', assets)
                    console.log(aliases.map(al => this.daoService.getDaoNameFromDAOAlias(al.aliasName)));
                    const filtered = aliases
                      .filter(al => assets
                        .map(asset => asset.name)
                        .includes(this.daoService.getDaoTokenFromDAOAlias(al.aliasName)));
                    this.rows = filtered;
                    this.page.totalElements = filtered.length;
                });
            });
        }
    }

    public showDaoDetails(daoName) {
        DaoService.currentDAO.name = daoName;
        this.router.navigate([`dao/show-daos/${this.viewMode}/${daoName}/general-info`]).then();
    }

    public accountId(value) {
        return this.daoService.getAccountId(value);
    }

    sendMessage(aliasURI) {
        this.router.navigate(['/messages/send-message'], {queryParams: {recipient: this.accountId(aliasURI)}}).then();
    }

    showDaoPolls(value) {
        this.router.navigate([`dao/show-polls/${value.aliasName}`]).then();
    }
}
