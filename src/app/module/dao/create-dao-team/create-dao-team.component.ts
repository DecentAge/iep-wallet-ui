import {AfterViewInit, Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../dao.service';
import {Router} from '@angular/router';
import {Observable} from 'rxjs';

@Component({
    selector: 'app-create-dao-team',
    templateUrl: './create-dao-team.component.html',
    styleUrls: ['./create-dao-team.component.scss']
})
export class CreateDaoTeamComponent implements OnInit, AfterViewInit {

    @Input() wizard: WizardComponent | null = null;
    public createTeamForm: { [key: string]: string } = {
        'daoName': '',
        'teamWallet': '',
        'teamWalletConfirmation': '',
        'name': '',
        'prefix': '',
        'quantity': '',
        'description': '',
        'decimals': '2',
        'secretPhrase': ''
    }

    public currentDao = '';
    private teamDAO = '';

    daoList: Observable<Array<any>>;

    constructor(
        private daoService: DaoService,
        private router: Router
    ) {
        this.daoList = this.daoService.getAliases();
    }


    ngOnInit() {
        this.currentDao = DaoService.currentDAO ? DaoService.currentDAO.name : '';
    }

    createTeam() {
        if (this.router.url.toString() === '/dao/create-dao/create-team') {
            this.daoService.createTeam(`${DaoService.currentDAO.name}`, this.createTeamForm);
            return;
        }
        this.daoService.createTeam(`${this.teamDAO}`, this.createTeamForm, this.createTeamForm.teamWallet);
        this.transferTeamToken();
    }

    ngAfterViewInit(): void {
        if (this.router.url.toString() === '/dao/create-dao/create-team') {
            this.wizard.navigation.goToStep(1);
            this.wizard.navigation.goToStep(2);
            this.wizard.navigation.goToStep(3);
        }
    }

    setDao(dao): void {
        this.currentDao = dao;
        this.teamDAO = dao.split('DAO').join('');
    }

    transferTeamToken() {
        // this.daoService.transferTeamToken(this.currentDao.split('DAO').join(''), this.createTeamForm);
    }
}
