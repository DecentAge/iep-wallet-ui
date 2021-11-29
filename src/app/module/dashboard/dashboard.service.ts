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

    getMarketData(fsym, tsym): any {

        var params = {
            aggregate: 6,
            e: 'CCCAGG',
            extraParams: '1',
            limit: 120,
            tryConversion: false,
            fsym,
            tsym
        };

        return this.http.get(AppConstants.marketDataConfig.baseUrl, AppConstants.marketDataConfig.endpoint + '/' + 'histohour', params);
    }

}
