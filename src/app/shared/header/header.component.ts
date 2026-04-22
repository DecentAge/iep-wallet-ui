import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { NodeService } from 'app/services/node.service';
import { OptionService } from 'app/services/option.service';
import { TransactionService } from 'app/services/transaction.service';
import { SessionStorageService } from 'app/services/session-storage.service';
import { LocalhostService } from 'app/services/localhost.service';
import { BroadcastService } from 'app/services/broadcast.service';
import { AppConstants } from 'app/config/constants';
import { RootScope } from 'app/config/root-scope';
import { TranslateService } from '@ngx-translate/core';
import {AccountService} from 'app/module/account/account.service';

@Component({
    selector: 'app-header',
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class HeaderComponent implements OnInit {

    connectedURL: string;
    totalNodes: string;
    currentHeight: string;
    peerState: any = {};
    options: any = {};
    currentModeText: string = '';
    selectedLanguage: string;
    accountRS: string;
    accountName: string | undefined = undefined;
    lastBlock: any;

    constructor(
        private accountService: AccountService,
        private nodeService: NodeService,
        private broadcastService: BroadcastService,
        private localhostService: LocalhostService,
        private sessionStorageService: SessionStorageService,
        private transactionService: TransactionService,
        private optionService: OptionService,
        private translate: TranslateService
    ) {
        this.optionService.optionsChanged$.subscribe(res => {
            this.ngOnInit();
        });
        this.accountRS = this.accountService.getAccountDetailsFromSession('accountRs');
        this.accountService.getAccountDetails(this.accountRS).subscribe((success: any) => {
            this.accountName = success.name || undefined;
        });
    }

    ngOnInit() {
        RootScope.onChange.subscribe(data => {
            this.options = data['options'];
        });
        this.init();

        this.broadcastService.on('reload-options').subscribe((success) => {
            this.init();
        });

        this.broadcastService.on('peers-updated').subscribe((success) => {
            this.init();
        });

        this.nodeService.getLastBlock()
            .subscribe((data) => {
                this.lastBlock = data;
            })
    }

    init() {
        this.connectedURL = this.nodeService.getNodeUrl();
        this.totalNodes = this.nodeService.getNodesCount();
        this.transactionService.getBlockChainStatus().subscribe((success) => {
            this.currentHeight = success.numberOfBlocks;
            this.sessionStorageService.saveToSession(AppConstants.baseConfig.SESSION_CURRENT_BLOCK, success.numberOfBlocks);
        });
        this.getState();

        this.currentModeText = AppConstants.DEFAULT_OPTIONS.NETWORK_ENVIRONMENT;
    };

    getState() {
        this.localhostService.getPeerState(this.nodeService.getNodeUrl())
            .subscribe((success) => {
                this.peerState = success;
            });
    };

    public copyAccountRs(element, tooltip): void {
        element.focus();
        element.select();
        document.execCommand('copy');
        tooltip.open();
        setTimeout(() => {
            tooltip.close();
        }, 5000)
    }

}
