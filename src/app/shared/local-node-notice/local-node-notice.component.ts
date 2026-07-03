import { Component, Input, OnInit } from '@angular/core';
import { NodeService } from '../../services/node.service';

@Component({
    selector: 'app-local-node-notice',
    templateUrl: './local-node-notice.component.html'
})
export class LocalNodeNoticeComponent implements OnInit {
    @Input() messageKey = 'common.local-node-required';
    isLocal = false;

    constructor(private nodeService: NodeService) {}

    ngOnInit() {
        this.isLocal = this.nodeService.isLocalNode();
    }
}
