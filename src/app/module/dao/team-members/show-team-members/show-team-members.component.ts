import { Component, OnInit } from '@angular/core';
import {Page} from '../../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {AccountService} from '../../../account/account.service';
import {AssetsService} from '../../../assets/assets.service';
import {DaoService} from '../../dao.service';
import {ActivatedRoute, Router} from '@angular/router';

@Component({
  selector: 'app-show-team-members',
  templateUrl: './show-team-members.component.html',
  styleUrls: ['./show-team-members.component.scss']
})
export class ShowTeamMembersComponent implements OnInit {

  public page = new Page();
  public rows = new Array<any>();
  public columnModes = ColumnMode;
  public daoName = '';
  public teamName = '';
  public teamTokens;
  public accountRs;

  constructor(
      private accountService: AccountService,
      private assetsService: AssetsService,
      private daoService: DaoService,
      private router: Router,
      private route: ActivatedRoute
  ) {
  }

  ngOnInit() {
    this.daoName = this.route.snapshot.params['daoName'];
    this.teamName = this.route.snapshot.params['teamName'];
    this.setPage({offset: 0});
    this.accountRs = this.accountService.getAccountDetailsFromSession('accountRs');
  }

  public setPage(pageInfo) {
    this.page.pageNumber = pageInfo.offset;
    this.page.totalPages = 1;
    this.daoService.getTeamMembers(this.teamName).subscribe(response => {
        this.rows = response;
        this.page.size = this.rows.length;
        this.page.totalElements = this.rows.length;
    });
  }

  public reload() {
    this.setPage({offset: 0});
  }

}
