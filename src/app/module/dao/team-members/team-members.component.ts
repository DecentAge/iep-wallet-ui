import {Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';

@Component({
    selector: 'app-team-members',
    templateUrl: './team-members.component.html',
    styleUrls: ['./team-members.component.scss']
})
export class TeamMembersComponent implements OnInit {

    @Input() wizard: WizardComponent;

    constructor() {
    }

    ngOnInit() {
    }

}
