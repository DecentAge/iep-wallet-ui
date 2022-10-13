import { Injectable } from '@angular/core';
import { AppConstants } from '../config/constants';
import { HttpProviderService } from './http-provider.service';
import {shareReplay} from 'rxjs/operators';
import 'rxjs/add/observable/from';
import {Observable} from 'rxjs';

@Injectable()
export class FiatService {

    private cache$: Observable<Object>;
    private lastFetch: number;

    constructor(public http: HttpProviderService) {
        this.lastFetch = 0;
    }

    getXinPrice() {
        return Observable.from([{USD: 0.00038717}]);
        /*
        if (!this.cache$ || new Date().getTime() - this.lastFetch > 1000 * 60 * 10 ) {
            this.lastFetch = new Date().getTime();
            this.cache$ = this.http.get(AppConstants.marketDataConfig.baseUrl, 'data/price?fsym=XIN&tsyms=USD').pipe( shareReplay(1) );
        }
        return this.cache$;
         */
    };
}
