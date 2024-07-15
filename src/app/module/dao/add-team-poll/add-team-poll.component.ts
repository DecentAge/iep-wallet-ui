import {Component, OnInit} from '@angular/core';
import {DaoService} from '../dao.service';
import {map} from 'rxjs/operators';
import {Router} from '@angular/router';

@Component({
    selector: 'app-add-team-poll',
    templateUrl: './add-team-poll.component.html',
    styleUrls: ['./add-team-poll.component.scss']
})
export class AddTeamPollComponent implements OnInit {

    public daosList: Array<any> = [];
    public teamsList = [];
    public currentDao = '';
    public currentTeam = '';
    public pollWalletRecipient: string | null = null;

    constructor(
        private daoService: DaoService,
        private router: Router
    ) {
    }

    ngOnInit() {
        // this.daosList = this.daoService.getAccountDaos();
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
    }

    setDao(dao): void {
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
        const daoToken = this.daoService.getDaoTokenFromDAOAlias(dao);
        this.daoService.getDaoTeams(`${daoToken}XN`).subscribe(success_ => {
            success_.subscribe((response: any) => {
                this.teamsList = response.aliases;
                this.pollWalletRecipient = null;
                this.currentTeam = '';
            })
        });
    }

    setTeam(team): void {
        this.currentTeam = team;
        this.daoService.getAssetForDaoTeam(`${team.split('XN').shift()}XE${team.split('XE').pop()}`)
            .pipe(map((response: any) => response.assets[0]))
            .subscribe(response => {
                this.pollWalletRecipient = response.asset;
            });
    }

    addTeamPoll() {
        this.router.navigate(['/voting/create-poll'], {queryParams: {recipient: this.pollWalletRecipient}}).then();
    }

}
