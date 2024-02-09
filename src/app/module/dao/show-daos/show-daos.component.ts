import {AfterViewChecked, AfterViewInit, ChangeDetectorRef, Component, OnDestroy, OnInit} from '@angular/core';
import {Subject} from 'rxjs';
import {ShowDaosMode} from '../enums';
import {DaoService} from '../dao.service';

@Component({
    selector: 'app-show-daos',
    templateUrl: './show-daos.component.html',
    styleUrls: ['./show-daos.component.scss']
})
export class ShowDaosComponent implements OnInit, OnDestroy {

    public viewModes = ShowDaosMode;
    public viewMode: ShowDaosMode = ShowDaosMode.all;
    public routeChange = new Subject();

    constructor(
        private cdRef: ChangeDetectorRef,
        private daoService: DaoService,
    ) {
    }

    onTabChange() {
        this.routeChange.next();
        this.cdRef.detectChanges();
    }

    ngOnInit(): void {
        this.daoService.daoViewModeChanged$.subscribe(response => {
            if (this.viewMode !== response) {
                this.viewMode = response;
                if (!this.cdRef['destroyed']) {
                    this.cdRef.detectChanges();
                }
            }
        });
    }

    ngOnDestroy(): void {
        this.daoService.destroyChangeDaoViewMode();
    }
}
