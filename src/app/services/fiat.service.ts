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

    // XIN reference price from the IEP market-cap backend (single source; the backend
    // fetches + persists the ieUnit XIN price server-side). Cached 10 min. Emits
    // { USD } or { USD: null } -> UI shows "n/a".
    getXinPrice() {
        if (!this.cache$ || new Date().getTime() - this.lastFetch > 1000 * 60 * 10) {
            this.lastFetch = new Date().getTime();
            this.cache$ = this.http.get(
                AppConstants.macapViewerConfig.macapUrl,
                AppConstants.macapViewerConfig.macapEndPoint,
                { name: 'xin' }
            ).pipe(
                map((res: any) => {
                    const doc = Array.isArray(res) ? res[0] : res;
                    return { USD: doc && doc.price_usd != null ? doc.price_usd : null };
                }),
                shareReplay(1)
            );
        }
        return this.cache$;
    };
}
