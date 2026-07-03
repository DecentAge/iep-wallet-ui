import { Component, OnInit } from '@angular/core';
import { OptionService } from '../../../services/option.service';
import { AccountService } from '../account.service';
import { NodeService } from '../../../services/node.service';
import { SessionStorageService } from '../../../services/session-storage.service';
import { CommonService } from '../../../services/common.service';

@Component({
    selector: 'app-block-generation',
    templateUrl: './block-generation.component.html',
    styleUrls: ['./block-generation.component.scss']
})
export class BlockGenerationComponent implements OnInit {
    status = 'Unknown';
    isLocal = false;
    generationStatus: any;
    secretPhrase = '';

    constructor(public optionsService: OptionService,
                public accountService: AccountService,
                public nodeService: NodeService,
                public sessionStorageService: SessionStorageService,
                public commonService: CommonService) {
        this.generationStatus = '—';
    }

    ngOnInit() {
        this.isLocal = this.nodeService.isLocalNode();
    }

    runBlockGeneration(mode) {
        this.accountService.blockGeneration(mode, this.secretPhrase)
            .subscribe((success: any) => {
                if (success.errorDescription) {
                    this.generationStatus = success.errorDescription;
                }
                if (typeof success.deadline !== 'undefined') {
                    this.generationStatus = '<span class="label label-success">Running</span>';
                }
                if (success.errorCode === 4) {
                    this.generationStatus = '<span class="label label-warning">Account not found</span>';
                }
                // TODO: Multiple condition for same code need to refine code.
                if (success.foundAndStopped === true) {
                    this.generationStatus = '<span class="label label-danger">Stopped</span>';
                }
                if (success.foundAndStopped === false) {
                    this.generationStatus = '<span class="label label-danger">Stopped</span>';
                }
            });
    };
}
