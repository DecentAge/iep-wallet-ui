import {Component, OnChanges, OnInit, SimpleChanges} from '@angular/core';
import {DaoService} from '../../dao.service';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {DEFAULT_FIRST_INDEX, DEFAULT_INDEX_INCREMENT, DEFAULT_LAST_INDEX, ShowDaosMode} from '../../enums';
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
    getDaoNameFromDAOAlias = this.daoService.getDaoNameFromDAOAlias;

    public columnModes = ColumnMode;
    public viewMode: ShowDaosMode;
    public viewModes = ShowDaosMode;
    public page = new Page();
    public rows = new Array<any>();
    private tempRows = new Array<any>();
    private tempElementsCount = 0;
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
        this.tempRows = [];
        this.tempElementsCount = 0;
        this.page.pageNumber = pageInfo.offset;
        this.getDaosAliases();
    }

    public getDaosAliases(first = DEFAULT_FIRST_INDEX, last = DEFAULT_LAST_INDEX) {
            this.daoService.getAliases('', first, last).subscribe((response: any) => {
                if (!response) {
                    response = [];
                }
                let aliases = response.aliases;
                if (!aliases) {
                    return;
                }
                this.tempRows = [...this.tempRows, ...aliases]
                this.tempElementsCount += aliases.length;
                if (!!response.moreItems) {
                    // call getDaosAliases again with changed first / last index to get more aliases
                    this.getDaosAliases(first + DEFAULT_INDEX_INCREMENT, last + DEFAULT_INDEX_INCREMENT);
                } else {
                    if (this.viewMode === ShowDaosMode.all) {
                        // All
                        this.rows = [...this.tempRows]
                        this.page.totalElements = this.tempElementsCount;
                    } else {
                        // My and Mobile views
                        aliases = [...this.tempRows];
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
                    }
                }
            });
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
