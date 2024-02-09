import {Component, OnInit} from '@angular/core';
import {DataStoreService} from '../../../../services/data-store.service';
import {Page} from '../../../../config/page';
import {CommonService} from '../../../../services/common.service';
import {MessageService} from '../../../message/message.service';
import {Router} from '@angular/router';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {DaoService} from '../../dao.service';

@Component({
    selector: 'app-dao-messages',
    templateUrl: './dao-messages.component.html',
    styleUrls: ['./dao-messages.component.scss']
})
export class DaoMessagesComponent implements OnInit {

    public page = new Page();
    public rows = new Array<any>();
    public accountRs: string;
    public columnModes = ColumnMode;

    constructor(
        private commonsService: CommonService,
        private daoService: DaoService,
        private messageService: MessageService,
        private router: Router
    ) {
    }

    ngOnInit() {
        this.setPage({offset: 0});
    }

    setPage(pageInfo) {
        this.page.pageNumber = pageInfo.offset;
        this.accountRs = this.commonsService.getAccountDetailsFromSession('accountRs');
        this.daoService.getDAOAlias(DaoService.currentDAO).subscribe((alias: any) => {
            const accountRs = alias.accountRS;
            this.messageService.getAccountDetails(accountRs).subscribe(((accountDetails: any) => {
                const account = accountDetails.account;
                this.messageService.getMessagesByAccountId(account).subscribe((messagesResponse: any) => {
                    this.rows = messagesResponse.transactions;
                    this.page.totalElements = this.rows.length;
                });
            }));
        });
    }

    messageDetail(rowData) {
        DataStoreService.set('message-details', rowData);
        this.router.navigate(['/messages/show-messages/read-message-details']).then();
    }

    accountDetail(accountID) {
        this.router.navigate(['/messages/show-messages/account-details'], {queryParams: {id: accountID}}).then();
    }

    transactionDetail(rowData) {
        DataStoreService.set('transaction-details', {id: rowData.transaction, type: 'onlyID', view: 'transactionDetail'});
        this.router.navigate(['/messages/show-messages/transaction-details']).then();
    }

    messageReply(senderID) {
        this.router.navigate(['/messages/send-message'], {queryParams: {recipient: senderID}}).then();
    }

    reload() {
        this.setPage({offset: 0});
    }

}
