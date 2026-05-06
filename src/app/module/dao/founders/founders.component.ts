import {AfterViewInit, Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from '../../../shared/archwizard';
import {Founder} from '../interfaces';
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
    public readonly alphanumericPattern: RegExp = new RegExp('^[a-zA-WY-Z0-9]*$');

    constructor(private router: Router) {
    }

    ngOnInit() {
        this.currentDao = DaoService.currentDAO.name;
        this.currentTeam = DaoService.currentDAOTeam.name;
    }

    ngAfterViewInit(): void {
        if (this.router.url.toString() === '/dao/create-dao/add-founders') {
            if (!this.currentDao) {
                this.router.navigate(['/dao/create-dao']).then();
            }
            if (!this.currentTeam) {
                this.router.navigate(['/dao/create-dao/create-team']).then();
            }
            setTimeout(() => this.wizard.goToStep(0));
            setTimeout(() => this.wizard.goToStep(1));
            setTimeout(() => this.wizard.goToStep(2));
        }
    }

    addFounder() {
        this.createFounderForm.founders.push({
            founderWalletAlias: '',
            founderWalletAddress: '',
            initialAllocation: '',
            issueDaoToken: true
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
