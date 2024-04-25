import {Component, OnInit} from '@angular/core';
import {DaoService} from '../../../dao.service';
import {DataStoreService} from '../../../../../services/data-store.service';
import {Page} from '../../../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {CommonService} from '../../../../../services/common.service';
import {MessageService} from '../../../../message/message.service';
import {Router} from '@angular/router';

@Component({
    selector: 'app-dao-team-messages',
    templateUrl: './dao-team-messages.component.html',
    styleUrls: ['./dao-team-messages.component.scss']
})
export class DaoTeamMessagesComponent implements OnInit {

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
        this.daoService.getDAOAlias(DaoService.currentDAOTeam).subscribe((alias: any) => {
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
