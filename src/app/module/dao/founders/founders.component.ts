import {AfterViewInit, Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {Founder} from '../team-members/interfaces';
import {DaoService} from '../dao.service';
import {Router} from '@angular/router';

@Component({
    selector: 'app-founders',
    templateUrl: './founders.component.html',
    styleUrls: ['./founders.component.scss']
})
export class FoundersComponent implements OnInit, AfterViewInit {

    @Input() wizard: WizardComponent;
    public createFounderForm = {
        founders: Array<Founder>()
    };
    private currentDao;
    private currentTeam;

    constructor(private router: Router) {
    }

    ngOnInit() {
        this.currentDao = DaoService.currentDAO ? DaoService.currentDAO : '';
        this.currentTeam = DaoService.currentDAOTeam ? DaoService.currentDAOTeam : '';
    }

    ngAfterViewInit(): void {
        if (this.router.url.toString() === '/dao/create-dao/add-founders') {
            if (!this.currentDao) {
                this.router.navigate(['/dao/create-dao']).then();
            }
            if (!this.currentTeam) {
                this.router.navigate(['/dao/create-dao/create-team']).then();
            }
            this.wizard.navigation.goToStep(0);
            this.wizard.navigation.goToStep(1);
            this.wizard.navigation.goToStep(2);
        }
    }

    addFounder() {
        this.createFounderForm.founders.push({
            founderWalletAlias: '',
            founderWalletAddress: '',
            initialAllocation: ''
        });
        DaoService.currentDAOTeamFounders = [...this.createFounderForm.founders];
    }

    deleteFounder(index) {
        this.createFounderForm.founders.splice(index, 1);
        DaoService.currentDAOTeamFounders = [...this.createFounderForm.founders];
    }

    nextStep() {
        this.router.navigate(['/dao/create-dao/add-team-members']).then();
    }
}
