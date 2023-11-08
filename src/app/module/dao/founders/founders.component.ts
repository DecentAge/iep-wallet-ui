import {Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';

@Component({
    selector: 'app-founders',
    templateUrl: './founders.component.html',
    styleUrls: ['./founders.component.scss']
})
export class FoundersComponent implements OnInit {

    @Input() wizard: WizardComponent;

    constructor() {
    }

    ngOnInit() {
    }

}
