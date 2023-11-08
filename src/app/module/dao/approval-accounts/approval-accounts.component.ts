import {Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';

@Component({
    selector: 'app-approval-accounts',
    templateUrl: './approval-accounts.component.html',
    styleUrls: ['./approval-accounts.component.scss']
})
export class ApprovalAccountsComponent implements OnInit {

    @Input() wizard: WizardComponent;

    constructor() {
    }

    ngOnInit() {
    }

}
