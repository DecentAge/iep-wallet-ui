import {AfterViewInit, Component, Input, OnInit} from '@angular/core';
import {WizardComponent} from 'angular-archwizard';
import {DaoService} from '../../dao.service';
import {TeamMember} from '../interfaces';
import {Router} from '@angular/router';

@Component({
    selector: 'app-add-team-members',
    templateUrl: './add-team-members.component.html',
    styleUrls: ['./add-team-members.component.scss']
})
export class AddTeamMembersComponent implements OnInit, AfterViewInit {

    @Input() wizard: WizardComponent | null = null;

    public daosList;
    public teamsList = [];
    public teamTokens;
    public currentDao = '';
    public currentTeam = '';
    public addTeamMemberForm = {
        teamMembers: Array<TeamMember>()
    };
    private teamDAO = '';

    constructor(
        private daoService: DaoService,
        private router: Router
    ) {
    }

    ngOnInit() {
        this.daosList = this.daoService.getAccountDaos();
        this.currentDao = DaoService.currentDAO ? DaoService.currentDAO : '';
        this.currentTeam = DaoService.currentDAOTeam ? DaoService.currentDAOTeam : '';
    }

    ngAfterViewInit(): void {
        if (this.router.url.toString() === '/dao/create-dao/add-team-members') {
            if (!this.currentDao) {
                this.router.navigate(['/dao/create-dao']).then();
            }
            if (!this.currentTeam) {
                this.router.navigate(['/dao/create-dao/create-team']).then();
            }
            this.wizard.navigation.goToStep(1);
            this.wizard.navigation.goToStep(2);
            this.wizard.navigation.goToStep(3);
            this.wizard.navigation.goToStep(4);
        }
    }

    addTeamMembers() {
        if (!this.currentDao) {
            this.currentDao = DaoService.currentDAO;
        }
        if (!this.currentTeam) {
            this.currentTeam = DaoService.currentDAOTeam;
        }
        if (!this.addTeamMemberForm.teamMembers.length) {
            this.router.navigate([`dao/show-daos/DAO${this.currentDao}/teams`]).then();
        }
        this.daoService.addTeamMembers(this.currentDao, this.currentTeam, this.addTeamMemberForm);
    }

    setDao(dao): void {
        this.currentDao = dao;
        this.teamDAO = dao.split('DAO').join('');
        this.daosList = this.daoService.getAccountDaos();
        this.daoService.getDaoTeams(`${dao}TN`).subscribe(success_ => {
            success_.subscribe((response: any) => {
                this.teamsList = response.aliases;
                this.teamTokens = response.res.assets;
            })
        });
    }

    setTeam(team, setDao = true): void {
        this.currentTeam = team;
        if (setDao) {
            this.teamDAO = team.split('TN').join('');
        }
    }

    addTeamMember() {
        this.addTeamMemberForm.teamMembers.push({
            teamMemberWallet: '',
            teamMemberRole: ''
        });
    }

    deleteTeamMember(index) {
        this.addTeamMemberForm.teamMembers.splice(index, 1);
    }

    indexTracker(index: number, value: any) {
        return index;
    }

    finishDaoCreation() {
        this.addTeamMembers()
    }
}
