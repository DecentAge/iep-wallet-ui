import { Component, OnDestroy, OnInit } from '@angular/core';
import { AccountService } from '../../account/account.service';
import { ActivatedRoute, Router } from '@angular/router';
import { SessionStorageService } from '../../../services/session-storage.service';
import { AssetsService } from '../assets.service';
import { Observable, Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';

@Component({
    selector: 'app-search-assets',
    templateUrl: './search-assets.component.html',
    styleUrls: ['./search-assets.component.scss']
})
export class SearchAssetsComponent implements OnInit, OnDestroy {
    assets: any[] = [];
    accountId: any;
    accountRs: any;
    searchQuery: any;

    private searchTerms = new Subject<string>();
    private searchSubscription: Subscription;

    constructor(public router: Router,
        public sessionStorageService: SessionStorageService,
        public assetsService: AssetsService,
        public route: ActivatedRoute,
        public accountService: AccountService) {
    }

    ngOnInit() {
        // switchMap drops the response of an outdated keystroke
        this.searchSubscription = this.searchTerms.pipe(
            map(query => (query || '').trim()),
            debounceTime(250),
            distinctUntilChanged(),
            switchMap(query => this.search(query)),
        ).subscribe(assets => this.assets = assets);
    }
    ngOnDestroy() {
        this.searchSubscription.unsubscribe();
    }
    onSearchChange(query) {
        this.searchTerms.next(query);
    }
    private search(query: string): Observable<any[]> {
        const luceneQuery = SearchAssetsComponent.toPrefixQuery(query);
        const byText: Observable<any> = luceneQuery
            ? this.assetsService.serachAssets(luceneQuery).pipe(catchError(() => of({})))
            : of({});
        const byId: Observable<any> = /^\d+$/.test(query)
            ? this.assetsService.getAsset(query).pipe(catchError(() => of({})))
            : of({});

        return forkJoin([byText, byId]).pipe(
            map(([textResult, idResult]) => {
                const assets = textResult.assets || [];
                if (idResult.asset && !assets.some(asset => asset.asset === idResult.asset)) {
                    assets.unshift(idResult);
                }
                return assets;
            }),
        );
    }
    // The node hands the query to Lucene, which only matches whole words and
    // rejects stray syntax characters: search each word as a prefix instead.
    static toPrefixQuery(query: string): string {
        return query
            .split(/[\s+\-&|!(){}\[\]^"~*?:\\\/]+/)
            .filter(word => word !== '')
            .map(word => word + '*')
            .join(' ');
    }
    goToAccountDetails(accountID) {
        this.router.navigate(['/assets/search-assets/account-details'], { queryParams: { id: accountID } });
    }
    goToAssetDetails(accountID) {
        this.router.navigate(['/assets/search-assets/asset-details'], { queryParams: { id: accountID } });
    }
    goToTradeDesk(id) {
        this.router.navigate(['/assets/trade', id]);
    }

}
