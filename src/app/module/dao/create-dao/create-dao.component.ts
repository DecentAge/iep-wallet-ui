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

    constructor(
        private daoService: DaoService,
    ) {
    }

    createDAO() {
        this.daoService.createDAO(this.createDaoForm);
    }

    // TODO: implement on step enter logic
}
