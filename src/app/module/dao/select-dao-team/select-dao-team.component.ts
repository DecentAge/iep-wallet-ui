import {Component, EventEmitter, Input, OnInit, Output} from '@angular/core';
import {Observable} from 'rxjs';

@Component({
    selector: 'app-select-dao-team',
    templateUrl: './select-dao-team.component.html',
    styleUrls: ['./select-dao-team.component.scss']
})
export class SelectDaoTeamComponent implements OnInit {

    @Input() currentDao;
    @Input() daosList: Observable<any>;
    @Input() currentTeam;
    @Input() teamsList: Array<any>;
    @Output() setDao = new EventEmitter<any>();
    @Output() setTeam = new EventEmitter<any>();

    constructor() {
    }

    ngOnInit() {
    }

    changeDao(currentDao) {
      this.setDao.emit(currentDao)
    }
    changeTeam(currentTeam) {
      this.setTeam.emit(currentTeam);
    }
}
