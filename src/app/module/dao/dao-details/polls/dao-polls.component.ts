import {Component, OnInit} from '@angular/core';
import {VotingService} from '../../../voting/voting.service';
import {Page} from '../../../../config/page';
import {DaoService} from '../../dao.service';
import {AccountService} from '../../../account/account.service';
import {ColumnMode} from '@swimlane/ngx-datatable';

@Component({
    selector: 'app-dao-polls',
    templateUrl: './dao-polls.component.html',
    styleUrls: ['./dao-polls.component.scss']
})
export class DaoPollsComponent implements OnInit {

    public page = new Page();
    public polls: any[] = [];
    private accountId: any;
    private daoName: string;
    private daoAssets: Array<string> = [];
    public columnModes = ColumnMode;

    constructor(
        private accountService: AccountService,
        private votingService: VotingService
    ) {
    }

    ngOnInit() {
        this.daoName = DaoService.currentDAO;
        this.accountId = this.accountService.getAccountDetailsFromSession('accountId');
        this.setPage({offset: 0});
    }

    setPage(pageInfo) {
        this.page.pageNumber = pageInfo.offset;
        this.votingService.getDaoTeamTokens(this.daoName).subscribe((response: any) => {
            this.daoAssets = response.assets.map(a => a.asset);
            this.votingService.getAllPolls().subscribe(polls => {
                this.setUpPage(polls.filter(poll => this.daoAssets.includes(poll.holding)));
            })
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
