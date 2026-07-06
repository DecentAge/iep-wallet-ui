import { Injectable } from '@angular/core';
import { AppConstants } from '../config/constants';
import { HttpProviderService } from './http-provider.service';
import {shareReplay} from 'rxjs/operators';

import {Observable} from 'rxjs';
import { of } from 'rxjs';


@Injectable()
export class FiatService {

    private cache$: Observable<Object>;
    private lastFetch: number;

    constructor(public http: HttpProviderService) {
        this.lastFetch = 0;
    }

    // XIN (Infinity Economics) is not listed on any public exchange / price API
    // (CoinGecko: not listed; cryptocompare now requires an API key). There is no
    // reliable XIN->USD source, so return null and let the UI show "n/a".
    getXinPrice() {
        return of(null);
    };
}
