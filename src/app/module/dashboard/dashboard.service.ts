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

    // XIN/USD daily price history from the IEP market-cap backend (single, persisted
    // source; the backend maintains it from ieUnit + a one-time CoinGecko backfill).
    getXinHistory(days): any {
        return this.http.get(
            AppConstants.macapViewerConfig.macapUrl,
            AppConstants.macapViewerConfig.xinHistoryEndPoint,
            { days: days }
        );
    }

}
