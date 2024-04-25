import {ChangeDetectorRef, Component, OnDestroy, OnInit} from '@angular/core';
import {DaoService} from '../dao.service';
import {ActivatedRoute, Router} from '@angular/router';
import {ShowDaosMode} from '../enums';
import {Subject} from 'rxjs';

@Component({
    selector: 'app-show-dao-details',
    templateUrl: './show-dao-details.component.html',
    styleUrls: ['./show-dao-details.component.scss']
})
export class ShowDaoDetailsComponent implements OnInit, OnDestroy {

    public viewModes = ShowDaosMode;
    public viewMode: ShowDaosMode = ShowDaosMode.all;
    public routeChange = new Subject();

    constructor(
        private cdRef: ChangeDetectorRef,
        private daoService: DaoService,
        private router: Router,
        private route: ActivatedRoute
    ) {
    }

    ngOnInit() {
        DaoService.currentDAO = this.route.snapshot.params['daoName'];
        DaoService.showDaoMode = this.route.snapshot.params['mode'];
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
        this.cdRef.detectChanges();
    }

    goBack() {
        this.router.navigate([`dao/show-daos/${this.viewMode}`]).then();
    }

    ngOnDestroy(): void {
        this.daoService.destroyChangeDaoViewMode();
    }
}
