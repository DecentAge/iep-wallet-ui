import { Injectable } from '@angular/core';
import { AppConstants } from '../config/constants';
import { HttpProviderService } from './http-provider.service';
import {shareReplay, map} from 'rxjs/operators';

import {Observable} from 'rxjs';
import { of } from 'rxjs';


@Injectable()
export class FiatService {

    private cache$: Observable<Object>;
    private lastFetch: number;

    constructor(public http: HttpProviderService) {
        this.lastFetch = 0;
    }

    // XIN (Infinity Economics) reference price from the ieUnit API
    // (rates.php -> special.XIN.usd; XIN is pegged to 1 Satoshi, so it tracks BTC).
    // CORS-enabled, no API key. Cached 10 min. Emits { USD } or { USD: null } (-> "n/a").
    getXinPrice() {
        if (!this.cache$ || new Date().getTime() - this.lastFetch > 1000 * 60 * 10) {
            this.lastFetch = new Date().getTime();
            this.cache$ = this.http.get('https://ieunit.org/api/v1', 'rates.php').pipe(
                map((res: any) => ({ USD: res && res.special && res.special.XIN ? res.special.XIN.usd : null })),
                shareReplay(1)
            );
        }
        return this.cache$;
    };
}
