import {Component, Input, ViewEncapsulation} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../dao.service';

@Component({
    selector: 'app-create-dao',
    templateUrl: './create-dao.component.html',
    styleUrls: ['./create-dao.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class CreateDaoComponent {
    @Input() wizard: WizardComponent;
    @Input() createDaoForm: { [key: string]: string };

    public readonly alphanumericPattern12: RegExp = new RegExp('^[a-zA-WY-Z0-9]{1,12}$');
    public readonly alphanumericPatternMax5: RegExp = new RegExp('^[a-zA-WY-Z0-9]{1,5}$');

    constructor(
        private daoService: DaoService,
    ) {
    }

    createDAO() {
        this.daoService.createDAO(this.createDaoForm);
    }

}
