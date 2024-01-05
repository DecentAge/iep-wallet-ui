import {ChangeDetectorRef, Component, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {AccountService} from '../../account/account.service';

@Component({
    selector: 'app-show-dao-polls',
    templateUrl: './show-dao-polls.component.html',
    styleUrls: ['./show-dao-polls.component.scss']
})
export class ShowDaoPollsComponent implements OnInit {
    private accountId;
    private accountRs;

    constructor(
        private changeDetectorRef: ChangeDetectorRef,
        private route: ActivatedRoute,
        private router: Router,
        private accountService: AccountService,
    ) {
        if (this.route.snapshot.params['daoId'] === '' || this.route.snapshot.params['daoId'] === 'all') {
            this.accountRs = this.accountService.getAccountDetailsFromSession('accountRs');
            this.router.navigate([`dao/show-polls/${this.accountRs}`]).then();
        }
    }

    ngOnInit() {
        this.changeDetectorRef.detectChanges();
    }

}
