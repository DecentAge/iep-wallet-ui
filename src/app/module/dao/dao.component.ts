import {Component, OnInit, ViewChild} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {ActivatedRoute} from '@angular/router';

@Component({
    selector: 'app-dao',
    templateUrl: './dao.component.html',
    styleUrls: ['./dao.component.scss']
})
export class DaoComponent implements OnInit {

    @ViewChild('awWizard') wizard: WizardComponent;
    public createDaoForm: { [key: string]: string } = {
        'name': '', 'prefix': '', 'quantity': '', 'description': '', 'decimals': '', 'secretPhrase': ''
    }

    constructor(private route: ActivatedRoute) {
    }

    ngOnInit() {
        this.route.data.subscribe(data => {
        });
    }
}
