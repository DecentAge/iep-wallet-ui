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

    public daosList;
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
        this.daosList = this.daoService.getAccountDaos();
        this.currentDao = DaoService.currentDAO ? DaoService.currentDAO : '';
        this.currentTeam = DaoService.currentDAOTeam ? DaoService.currentDAOTeam : '';
    }

    setDao(dao): void {
        this.currentDao = dao;
        this.daosList = this.daoService.getAccountDaos();
        this.daoService.getDaoTeams(`${dao}TN`).subscribe(success_ => {
            success_.subscribe((response: any) => {
                this.teamsList = response.aliases;
                this.pollWalletRecipient = null;
                this.currentTeam = '';
            })
        });
    }

    setTeam(team): void {
        this.currentTeam = team;
        this.daoService.getAssetForDaoTeam(`${team.split('TN').shift()}TT${team.split('TT').pop()}`)
            .pipe(map((response: any) => response.assets[0]))
            .subscribe(response => {
                this.pollWalletRecipient = response.asset;
            });
    }

    addTeamPoll() {
        this.router.navigate(['/voting/create-poll'], {queryParams: {recipient: this.pollWalletRecipient}}).then();
    }

}
