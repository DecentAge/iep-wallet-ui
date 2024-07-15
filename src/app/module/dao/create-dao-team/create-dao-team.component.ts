import {AfterViewInit, Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../dao.service';
import {ActivatedRoute, Router} from '@angular/router';
import {AccountService} from '../../account/account.service';

@Component({
    selector: 'app-create-dao-team',
    templateUrl: './create-dao-team.component.html',
    styleUrls: ['./create-dao-team.component.scss']
})
export class CreateDaoTeamComponent implements OnInit, AfterViewInit {

    getDaoName = this.daoService.getDaoName;
    getDaoNameFromDAOAlias = this.daoService.getDaoNameFromDAOAlias;

    @Input() wizard: WizardComponent | null = null;
    public createTeamForm: { [key: string]: string } = {
        'daoName': '',
        'teamWallet': '',
        'teamWalletConfirmation': '',
        'name': '',
        'prefix': '',
        'quantity': '',
        'description': '',
        'decimals': '1',
        'secretPhrase': ''
    }

    public currentDao = '';
    private teamDAO = '';
    private account;
    public readonly alphanumericPattern12: RegExp = new RegExp('^[a-zA-WY-Z0-9]{1,12}$');
    public readonly alphanumericPatternMax5: RegExp = new RegExp('^[a-zA-WY-Z0-9]{1,5}$');

    public daoList: Array<any>= [];

    constructor(
      private accountService: AccountService,
      private daoService: DaoService,
      private router: Router,
      private route: ActivatedRoute
    ) {
    }

    ngOnInit() {
        if (this.route.snapshot.routeConfig.path === 'create-dao/create-team') {
            this.currentDao = DaoService.currentDAO.name;
        }
        if (this.currentDao !== '') {
            this.setDao(this.currentDao);
        }
        this.account = this.accountService.getAccountDetailsFromSession('accountId');
        let tempDaoList = [];
        this.daoService.getAccountDaos().subscribe({
            next: (aliases: any) => {
                tempDaoList = [...tempDaoList, ...aliases]
            },
            error: (e) => console.error(e),
            complete: () => {
                this.daoList = tempDaoList;
            }
        });
    }

    createTeam(): void {
        if (this.router.url.toString() === '/dao/create-dao/create-team') {
            this.daoService.createTeam(`${DaoService.currentDAO.shortcode}`, this.createTeamForm);
            return;
        }
        this.daoService.checkAccountExists(this.createTeamForm.teamWallet).subscribe((response: any) => {
            if (response.errorCode) {
                this.daoService.showErrorMessage(response);
            } else {
                this.daoService.createTeam(`${this.teamDAO}`, this.createTeamForm, this.createTeamForm.teamWallet, this.currentDao);
            }
        })
    }

    ngAfterViewInit(): void {
        if (this.router.url.toString() === '/dao/create-dao/create-team') {
            if (!this.currentDao) {
                this.router.navigate(['/dao/create-dao']).then();
            }
            this.wizard.navigation.goToStep(0);
            this.wizard.navigation.goToStep(1);
        }
    }

    setDao(dao): void {
        this.currentDao = dao;
        this.teamDAO = this.daoService.getDaoName(this.daoService.getDaoTokenFromDAOAlias(dao));
    }
}
