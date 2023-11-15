import {AfterViewChecked, AfterViewInit, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../dao.service';
import {NavigationEnd, NavigationStart, Router} from '@angular/router';
import {Subject, Subscription} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

@Component({
    selector: 'app-create-team',
    templateUrl: './create-team.component.html',
    styleUrls: ['./create-team.component.scss']
})
export class CreateTeamComponent implements OnInit, AfterViewInit {

    @Input() wizard: WizardComponent;
    public createTeamForm: { [key: string]: string } = {
        'name': '', 'prefix': '', 'quantity': '', 'description': '', 'decimals': '2', 'secretPhrase': ''
    }
    private readonly destroy$ = new Subject();

    constructor(
        private daoService: DaoService,
        private router: Router
    ) {
    }

    ngOnInit() {
    }

    createTeam() {
        console.log(this.daoService.daoForm);
        this.daoService.createTeam(`${DaoService.currentDAO.name}`, this.createTeamForm);
    }

    ngAfterViewInit(): void {
        if (this.router.url.toString() === '/dao/create-dao/create-team') {
            this.wizard.navigation.goToStep(1);
            this.wizard.navigation.goToStep(2);
            this.wizard.navigation.goToStep(3);
        }
    }
}
