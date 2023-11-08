import {Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../dao.service';

@Component({
    selector: 'app-create-team',
    templateUrl: './create-team.component.html',
    styleUrls: ['./create-team.component.scss']
})
export class CreateTeamComponent implements OnInit {

    @Input() wizard: WizardComponent;
    @Input() daoForm: any;
    public createTeamForm: { [key: string]: string } = {
        'name': '', 'prefix': '', 'quantity': '', 'description': '', 'decimals': '2', 'secretPhrase': ''
    }

    constructor(
        private daoService: DaoService,
    ) {
    }

    ngOnInit() {
    }

    createTeam() {
        this.daoService.createTeam(`${this.daoForm.prefix}`, this.createTeamForm, this.wizard);
    }

}
