import {forkJoin} from 'rxjs';
import {Component, OnInit} from '@angular/core';
import {ActivatedRoute, NavigationExtras, Router} from '@angular/router';
import {VotingService} from '../../voting.service';
import {SessionStorageService} from '../../../../services/session-storage.service';
import {AppConstants} from '../../../../config/constants';
import {Page} from '../../../../config/page';
import {AccountService} from '../../../account/account.service';

@Component({
    selector: 'app-polls',
    templateUrl: './polls.component.html',
    styleUrls: ['./polls.component.scss']
})
export class PollsComponent implements OnInit {

    public page = new Page();
    public polls: any[] = [];
    public pollType: any = 'ALL';
    public searchQuery: any = '';
    daoAssets: Array<string> = [];
    public filters = [
        {name: 'Active Polls', icon: 'fa-hourglass-2', popoverText: 'filter-active-polls-popover', isEnabled: false},
    ];
    private includeFinished = true;
    private accountId: any;
    private accountRs: any;
    private daoName: string;

    constructor(public router: Router,
                public votingService: VotingService,
                public sessionStorageService: SessionStorageService,
                public route: ActivatedRoute,
                public accountService: AccountService) {
        this.page.pageNumber = 0;
        this.page.size = 10;
    }

    removeFilter() {
        this.includeFinished = true;

        this.filters.forEach(obj => {
            obj.isEnabled = false;
        });

        this.setPage({offset: 0});
    }

    applyFilter(filter) {
        this.searchQuery = '';
        switch (filter.name) {
            case 'Active Polls':
                this.includeFinished = false;
                break;
            case 'All Polls':
                this.includeFinished = true;
        }
        this.filters.forEach(obj => {
            obj.isEnabled = (obj.name === filter.name);
        });
        this.setPage({offset: 0});
    }

    ngOnInit() {
        this.route.data.subscribe(data => {
            this.pollType = data.pollType;
            this.accountId = this.accountService.getAccountDetailsFromSession('accountId');
            this.accountRs = this.accountService.getAccountDetailsFromSession('accountRs');
            if (this.pollType === 'DAO') {
                this.daoName = this.route.snapshot.params['daoId'];
            }
            this.setPage({offset: 0});
        });
    }

    getDays(value) {
        const currentHeight = this.sessionStorageService.getFromSession(AppConstants.baseConfig.SESSION_CURRENT_BLOCK);
        let days: number;

        if (currentHeight && currentHeight < value) {
            days = (parseInt(value, 10) - currentHeight) / 1440;
        } else {
            days = 0;
        }

        if (days < 0) {
            days = 0;
        }

        return days.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2});
    }

    setPage(pageInfo) {

        this.page.pageNumber = pageInfo.offset;

        const startIndex = this.page.pageNumber * 10;
        const endIndex = ((this.page.pageNumber + 1) * 10) - 1;

        if (this.pollType === 'ALL') {
            this.votingService.getPolls(startIndex, endIndex, this.includeFinished)
                .subscribe((success: any) => {
                    this.setUpPage(success.polls);
                });
        } else if (this.pollType === 'DAO') {
            this.votingService.getDaoTeamTokens(this.daoName).subscribe((response: any) => {
                this.daoAssets = response.assets.map(a => a.asset);
                this.votingService.getAllPolls().subscribe(polls => {
                    this.setUpPage(polls.filter(poll => this.daoAssets.includes(poll.holding)));
                })
            });
        } else {
            this.votingService.getAccountPolls(this.accountId, startIndex, endIndex, this.includeFinished)
                .subscribe((success: any) => {
                    this.setUpPage(success.polls);
                });
        }
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

    reload() {
        this.setPage({offset: 0});
    }

    onCustom(event) {
        const navigationExtras: NavigationExtras = {
            queryParams: {
                id: event.poll
            }
        };
        switch (event.action) {
            case 'result':
                this.router.navigate(['/voting/show-polls/result'], navigationExtras).then();
                break;
            case 'details':
                this.router.navigate(['/voting/show-polls/details'], navigationExtras).then();
                break;
            case 'vote':
                this.router.navigate(['/voting/show-polls/vote'], navigationExtras).then();
                break;
            case 'voters':
                this.router.navigate(['/voting/show-polls/voters'], navigationExtras).then();
                break;
        }
    }

    onSearchChange(query) {
        if (query !== '') {
            this.removeFilter();
            this.votingService.searchPolls(query, this.page.pageNumber * 10, ((this.page.pageNumber + 1) * 10) - 1)
                .subscribe((success) => {
                    forkJoin([success, this.votingService.getPoll(query)])
                        .subscribe((successNext: any) => {
                            const [result1, result2] = successNext;

                            if (!result1.errorCode) {
                                this.polls = result1.polls;
                            }
                            if (!result2.errorCode) {
                                this.polls = result2.polls;
                                this.page.totalElements = this.polls.length;
                            }

                        });
                });
        } else {
            this.reload();
        }
    }
}
