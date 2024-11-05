import {Component, Input, ViewEncapsulation} from '@angular/core';
import {WizardComponent} from '../../../shared/archwizard';
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

    public readonly alphanumericPattern: RegExp = new RegExp('^[a-zA-Z0-9_]*$');
    public readonly alphanumericPatternMax7: RegExp = new RegExp('^[a-zA-Z0-9_]{1,7}$');

    constructor(
        private daoService: DaoService,
    ) {
    }

    createDAO() {
        this.daoService.createDAO(this.createDaoForm);
    }

}
