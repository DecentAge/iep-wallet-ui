import {AfterViewInit, Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../../dao.service';
import {Founder, TeamMember} from '../../interfaces';
import {Router} from '@angular/router';

@Component({
    selector: 'app-add-team-members',
    templateUrl: './add-team-members.component.html',
    styleUrls: ['./add-team-members.component.scss']
})
export class AddTeamMembersComponent implements OnInit, AfterViewInit {

    @Input() wizard: WizardComponent | null = null;

    public daosList: Array<any> = [];
    public teamsList = [];
    public teamTokens;
    public currentDao = '';
    public currentTeam = '';
    public addTeamMemberForm = {
        teamMembers: Array<TeamMember>(),
        issueDaoTokens: false
    };
    public isPending = true;
    public pendingTransactions = [];
    public readonly alphanumericPattern: RegExp = new RegExp('^[a-zA-WY-Z0-9]*$');

    constructor(
        private daoService: DaoService,
        private router: Router
    ) {
    }

    ngOnInit() {
        let tempDaoList = [];
        this.daoService.getAccountDaos().subscribe({
            next: (aliases: any) => {
                tempDaoList = [...tempDaoList, ...aliases]
            },
            error: (e) => console.error(e),
            complete: () => {
                this.daosList = tempDaoList;
            }
        });
        this.currentDao = DaoService.currentDAO.name;
        if (!!this.wizard) {
            this.currentTeam = DaoService.currentDAOTeam.name;
        } else {
            this.daoService.currentTeamMembers = [];
            DaoService.currentDAOTeamFounders = [];
        }
        if (this.currentDao !== '') {
            this.setDao(this.currentDao);
        }
    }

    ngAfterViewInit(): void {
        if (this.router.url.toString() === '/dao/create-dao/add-team-members') {
            if (!this.currentDao) {
                this.router.navigate(['/dao/create-dao']).then();
            } else if (!this.currentTeam) {
                this.router.navigate(['/dao/create-dao/create-team']).then();
            } else {
                this.wizard.navigation.goToStep(0);
                this.wizard.navigation.goToStep(1);
                this.wizard.navigation.goToStep(2);
                this.wizard.navigation.goToStep(3);
                this.checkTransactions();
            }
        }
    }

    checkTransactions() {
        this.daoService.checkTransactions().subscribe(response => {
            this.isPending = response.isPending;
            this.pendingTransactions = response.transactions;
        });
    }

    addTeamMembers() {
        if (!this.currentDao) {
            this.currentDao = DaoService.currentDAO.name;
        }
        if (!this.currentTeam) {
            this.currentTeam = DaoService.currentDAOTeam.name;
        }
        if (!this.addTeamMemberForm.teamMembers.length &&
          !DaoService.currentDAOTeamFounders.length &&
          !this.daoService.currentTeamMembers.length) {
            this.router.navigate([`dao/show-daos/DAO${this.currentDao}/teams`]).then();
        }
        this.daoService.currentTeamMembers = [...this.daoService.currentTeamMembers, ...this.addTeamMemberForm.teamMembers];
        if (DaoService.currentDAOTeamFounders.length > 0) {
            this.daoService.currentTeamMembers = [
                ...this.daoService.currentTeamMembers,
                ...DaoService.currentDAOTeamFounders.map((teamFounder: Founder) => {
                    return {
                        teamMemberWallet: teamFounder.founderWalletAddress,
                        teamMemberRole: teamFounder.founderWalletAlias,
                        quantity: teamFounder.initialAllocation,
                        issueDaoToken: teamFounder.issueDaoToken
                    }
                })];
        }
        this.daoService.addTeamMembers(this.currentDao, this.currentTeam, this.daoService.currentTeamMembers);
    }

    setDao(dao): void {
        if (!!this.wizard) {
            return;
        }
        this.currentDao = dao;
        let tempDaoList = [];
        this.daoService.getAccountDaos().subscribe({
            next: (aliases: any) => {
                tempDaoList = [...tempDaoList, ...aliases]
            },
            error: (e) => console.error(e),
            complete: () => {
                this.daosList = tempDaoList;
            }
        });
        this.daoService.getDaoTeams(`${this.daoService.getDaoTokenFromDAOAlias(dao)}XN`).subscribe(success_ => {
            success_.subscribe((response: any) => {
                this.teamsList = response.aliases;
                this.teamTokens = response.res.assets;
            })
        });
        this.setTeam('');
    }

    setTeam(team): void {
        this.currentTeam = team;
    }

    addTeamMember() {
        this.addTeamMemberForm.teamMembers.push({
            teamMemberWallet: '',
            teamMemberRole: '',
            issueDaoToken: true
        });
    }

    deleteTeamMember(index) {
        this.addTeamMemberForm.teamMembers.splice(index, 1);
    }

    indexTracker(index: number, value: any) {
        return index;
    }

    finishDaoCreation() {
        this.addTeamMembers();
    }
}
