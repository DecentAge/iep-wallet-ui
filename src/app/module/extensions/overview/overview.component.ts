import { Component, OnInit } from '@angular/core';
import { Subject } from 'rxjs';

@Component({
    selector: 'app-overview',
    templateUrl: './overview.component.html',
    styleUrls: ['./overview.component.scss'],
    standalone: false
})
export class OverviewComponent implements OnInit {
    routeChange = new Subject();

    constructor() {

    }

    ngOnInit() {

    }

    onTabChange() {
        this.routeChange.next();
    }

}
