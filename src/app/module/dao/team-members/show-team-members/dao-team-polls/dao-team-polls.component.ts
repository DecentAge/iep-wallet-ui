import { Component, OnInit } from '@angular/core';
import {Page} from '../../../../../config/page';
import {ColumnMode} from '@swimlane/ngx-datatable';
import {AccountService} from '../../../../account/account.service';
import {VotingService} from '../../../../voting/voting.service';
import {DaoService} from '../../../dao.service';

@Component({
  selector: 'app-dao-team-polls',
  templateUrl: './dao-team-polls.component.html',
  styleUrls: ['./dao-team-polls.component.scss']
})
export class DaoTeamPollsComponent implements OnInit {

  public page = new Page();
  public polls: any[] = [];
  private accountId: any;
  private daoName: string;
  public teamName: string;
  public teamToken: string;
  private teamAssets: Array<string> = [];
  public columnModes = ColumnMode;

  constructor(
      private accountService: AccountService,
      private votingService: VotingService
  ) {
  }

  ngOnInit() {
    this.daoName = DaoService.currentDAO.name;
    this.teamName = DaoService.currentDAOTeam.name;
    this.accountId = this.accountService.getAccountDetailsFromSession('accountId');
    this.teamToken = `TT${this.teamName.split('TT').pop()}`;
    this.setPage({offset: 0});
  }

  setPage(pageInfo) {
    this.page.pageNumber = pageInfo.offset;
    this.votingService.getDaoTeamTokens(this.daoName).subscribe((response: any) => {
      this.teamAssets = response.assets.filter(a => a.name === `${this.daoName}${this.teamToken}`).map(a => a.asset);
      this.votingService.getAllPolls().subscribe(polls => {
        this.setUpPage(polls.filter(poll => this.teamAssets.includes(poll.holding)).map(poll => {
          const asset = response.assets.find((ast: any) => ast.asset === poll.holding);
          poll.assetName = asset.name;
          return poll;
        }));
      });
    });
  }

  setUpPage(data) {
    this.polls = data;
    if (this.page.pageNumber === 0 && this.polls.length < 10) {
      this.page.totalElements = this.polls.length;
    } else if (this.page.pageNumber > 0 && this.polls.length < 10) {
      this.page.totalElements = this.page.pageNumber * 10 + this.polls.length;
      this.page.totalPages = this.page.pageNumber;
    }
  }

  onCustom(event) {
    this.votingService.detailsActions(event);
  }

  getDays(value) {
    return this.votingService.getDays(value);
  }

  reload() {
    this.setPage({offset: 0});
  }

}
