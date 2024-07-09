import {ChangeDetectorRef, Component, OnDestroy, OnInit} from '@angular/core';
import {DaoService} from '../../dao.service';
import {ActivatedRoute, Router} from '@angular/router';
import {ShowDaosMode} from '../../enums';
import {Subject} from 'rxjs';

@Component({
    selector: 'app-show-team-members',
    templateUrl: './show-team-members.component.html',
    styleUrls: ['./show-team-members.component.scss']
})
export class ShowTeamMembersComponent implements OnInit, OnDestroy {

    public viewModes = ShowDaosMode;
    public viewMode: ShowDaosMode = ShowDaosMode.all;
    public routeChange = new Subject();
    public daoName;
    public teamName;
    public teamAccountRs;

    constructor(
        private cdRef: ChangeDetectorRef,
        private daoService: DaoService,
        private route: ActivatedRoute,
        private router: Router
    ) {
    }

    ngOnInit() {
        this.daoName = this.route.snapshot.params['daoName'];
        this.teamName = this.route.snapshot.params['teamName'];
        this.route.queryParams.subscribe((params: any) => {
            this.teamAccountRs = params.teamAccountRs;
        });
        DaoService.currentDAO.name = this.daoName;
        DaoService.currentDAOTeam.name = this.route.snapshot.params['teamName'];
        this.daoService.daoViewModeChanged$.subscribe(response => {
            if (this.viewMode !== response) {
                this.viewMode = response;
                if (!this.cdRef['destroyed']) {
                    this.cdRef.detectChanges();
                }
            }
        });
    }

    onTabChange() {
        this.routeChange.next();
    }

    public goBack() {
        const viewMode = DaoService.showDaoMode;
        this.router.navigate([`dao/show-daos/${viewMode}/${this.daoName}/teams`]).then();
    }

    ngOnDestroy(): void {
        this.daoService.destroyChangeDaoViewMode();
    }
}
