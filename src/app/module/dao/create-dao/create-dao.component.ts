import {Component, OnInit, ViewChild, ViewEncapsulation} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../dao.service';

@Component({
    selector: 'app-create-dao',
    templateUrl: './create-dao.component.html',
    styleUrls: ['./create-dao.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class CreateDaoComponent implements OnInit {

    @ViewChild('awWizard') wizard: WizardComponent;
    public createDaoForm: { [key: string]: string } = {
        'name': '', 'prefix': '', 'quantity': '', 'description': '', 'decimals': '', 'secretPhrase': ''
    }

    constructor(
        private daoSevice: DaoService
    ) {
    }

    ngOnInit() {
    }

    createAsset() {
        this.daoSevice.createAsset(this.createDaoForm, this.wizard);
    }
}
