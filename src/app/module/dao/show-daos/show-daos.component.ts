import {Component, OnInit} from '@angular/core';
import {AssetsService} from '../../assets/assets.service';
import {Page} from '../../../config/page';
import {DaoService} from '../dao.service';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {Router} from '@angular/router';

@Component({
    selector: 'app-show-daos',
    templateUrl: './show-daos.component.html',
    styleUrls: ['./show-daos.component.scss']
})
export class ShowDaosComponent implements OnInit {

    public page = new Page();
    public rows = new Array<any>();
    public columnModes = ColumnMode;

    constructor(
        private assetsService: AssetsService,
        private daoService: DaoService,
        private router: Router
    ) {
    }

    ngOnInit() {
        this.setPage({offset: 0});
    }

    public setPage(pageInfo) {
        this.page.pageNumber = pageInfo.offset;
        this.page.totalPages = 1;
        this.getExternalLinks();
    }

    public getExternalLinks() {
        this.daoService.getAliases().subscribe((response: any) => {
            if (!response) {
                response = [];
            }
            const aliases = response;
            if (!aliases) {
                return;
            }
            this.rows = aliases;
            this.page.size = this.rows.length;
            this.page.totalElements = this.rows.length;
        });
    }

    public routeUri(uri) {
        DaoService.currentDAO = uri;
        this.router.navigate([`dao/show-daos/${uri}/teams`]).then();
        console.log(uri);
    }

    public accountId(value) {
        return value.split('acct:').pop().split('@xin').shift();
    }

    sendMessage(aliasURI) {
        this.router.navigate(['/messages/send-message'], {queryParams: {recipient: this.accountId(aliasURI)}}).then();
    }
}
