import {Component, Input, OnInit} from '@angular/core';
import {SessionStorageService} from '../../../../services/session-storage.service';
import {AccountService} from '../../../account/account.service';
import {AssetsService} from '../../assets.service';
import {ActivatedRoute, Router} from '@angular/router';
import {Page} from '../../../../config/page';
import {DataStoreService} from '../../../../services/data-store.service';

@Component({
  selector: 'app-open-orders',
  templateUrl: './open-orders.component.html',
  styleUrls: ['./open-orders.component.scss']
})
export class OpenOrdersComponent implements OnInit {

    page = new Page();
    orders: any = [];
    offerType: any = 'Buy';
    accountId: any;
    accountRs: any;
    @Input()
    offerTypeInput: any;
    constructor(public router: Router,
                public sessionStorageService: SessionStorageService,
                public assetsService: AssetsService,
                public route: ActivatedRoute,
                public accountService: AccountService) {
        this.page.pageNumber = 0;
        this.page.size = 10;
    }

    ngOnInit() {
        this.offerType = this.offerTypeInput;
        this.accountId = this.accountService.getAccountDetailsFromSession('accountId');
        this.accountRs = this.accountService.getAccountDetailsFromSession('accountRs');

        this.setPage({offset: 0});
    }
    setPage(pageInfo) {

        this.page.pageNumber = pageInfo.offset;

        let startIndex = this.page.pageNumber * 10;
        let endIndex = ((this.page.pageNumber + 1) * 10) - 1;

        if (this.offerType === 'Buy') {
            this.assetsService.getAccountCurrentBidOrders(this.accountRs, startIndex, endIndex + 1)
                .subscribe((success: any) => {
                    this.applyPage(success.bidOrders, startIndex);
                });
        } else {
            this.assetsService.getAccountCurrentAskOrders(this.accountRs, startIndex, endIndex + 1)
                .subscribe((success: any) => {
                    this.applyPage(success.askOrders, startIndex);
                });
        }

    }
    // No endpoint reports the total: one extra row is the only "is there more".
    private applyPage(orders: any, startIndex: number) {
        const all = orders || [];
        this.orders = all.slice(0, this.page.size);
        this.page.totalElements = startIndex + this.orders.length + (all.length > this.page.size ? 1 : 0);
        this.page.totalPages = Math.ceil(this.page.totalElements / this.page.size);
    }
    reload() {
        this.setPage({offset: 0});
    }
    goToAssetDetails(accountID) {
        this.router.navigate(['/assets/open-orders/asset-details'],{ queryParams: { id: accountID }});
    }
    goToTransactionDetails(id) {
        DataStoreService.set('transaction-details', { id, type: 'onlyID', view: 'transactionDetail'});
        this.router.navigate(['/assets/open-orders/transaction-details']);
    }
    goToTradeDesk(id) {
        this.router.navigate(['/assets/trade', id]);
    }
    goToCancelOrder(rowData) {
        DataStoreService.set('offer-details', rowData);
        this.router.navigate(['assets/open-orders/cancel-order']);
    }
}
