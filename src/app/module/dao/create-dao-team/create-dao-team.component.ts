import {AfterViewInit, Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../dao.service';
import {Router} from '@angular/router';
import {Observable} from 'rxjs';
import {AccountService} from '../../account/account.service';
import {map} from 'rxjs/operators';

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
        private accountService: AccountService,
        private daoService: DaoService,
        private router: Router
    ) {
        const accountRS = this.accountService.getAccountDetailsFromSession('accountRs');
        this.daoList = this.daoService.getAliases().pipe(
            map((aliases: any) => {
                return aliases.filter(alias => alias.accountRS === accountRS);
            })
        );
    }


    ngOnInit() {
        this.currentDao = DaoService.currentDAO ? DaoService.currentDAO : '';
    }

    createTeam() {
        if (this.router.url.toString() === '/dao/create-dao/create-team') {
            this.daoService.createTeam(`${DaoService.currentDAO}`, this.createTeamForm);
            return;
        }
        this.daoService.checkAccountExists(this.createTeamForm.teamWallet).subscribe((response: any) => {
            if (response.errorCode) {
                this.daoService.showErrorMessage(response);
            } else {
                this.daoService.createTeam(`${this.teamDAO}`, this.createTeamForm, this.createTeamForm.teamWallet);
            }
        })
    }

    ngAfterViewInit(): void {
        if (this.router.url.toString() === '/dao/create-dao/create-team') {
            if (!this.currentDao) {
                this.router.navigate(['/dao/create-dao']).then();
            }
            this.wizard.navigation.goToStep(1);
            this.wizard.navigation.goToStep(2);
            this.wizard.navigation.goToStep(3);
        }
    }

    setDao(dao): void {
        this.currentDao = dao;
        this.teamDAO = dao.split('DAO').join('');
    }
}
