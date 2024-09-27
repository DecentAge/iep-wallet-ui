import {AfterViewInit, Component, OnInit, ViewChild} from '@angular/core';
import {WizardComponent, WizardStep} from 'angular-archwizard';
import {ActivatedRoute} from '@angular/router';

@Component({
    selector: 'app-dao',
    templateUrl: './dao.component.html',
    styleUrls: ['./dao.component.scss']
})
export class DaoComponent implements OnInit, AfterViewInit {

    @ViewChild('awWizard', { static: true }) wizard: WizardComponent;
    public createDaoForm: { [key: string]: string } = {
        'name': '', 'prefix': '', 'quantity': '', 'description': '', 'decimals': '1', 'secretPhrase': ''
    }

    constructor(private route: ActivatedRoute) {
    }

    ngOnInit() {
        this.route.data.subscribe(data => {
        });
    }

    ngAfterViewInit(): void {
    }
}
