import { Injectable } from '@angular/core';
import { NodeService } from '../../services/node.service';
import { OptionService } from '../../services/option.service';
import { HttpProviderService } from '../../services/http-provider.service';
import { AppConstants } from '../../config/constants';
import { Observable } from 'rxjs';

@Injectable()
export class DashboardService {

    constructor(private http: HttpProviderService, private nodeService: NodeService, private optionService: OptionService) { }

    getAccountAssetsAndBalances(accountRS): Observable<any> {

        var params = {
            'requestType': 'getAccount',
            'includeAssets': 'true', 'includeCurrencies': 'true', 'includeEffectiveBalance': 'true',
            'includeLessors': 'true',
            'account': accountRS
        };

        return this.http.get(this.nodeService.getNodeUrl(), AppConstants.dashboardConfig.apiEndPoint, params)

    };

    // BTC/USD hourly history from CoinGecko (free, CORS-enabled, no API key).
    // Used to derive the XIN/USD chart series (XIN is pegged to 1 Satoshi = BTC * 1e-8).
    getBtcUsdMarketData(): any {
        return this.http.get('https://api.coingecko.com/api/v3', 'coins/bitcoin/market_chart', {
            vs_currency: 'usd',
            days: 7
        });
    }

}
