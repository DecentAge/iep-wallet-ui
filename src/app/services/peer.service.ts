import { Injectable } from '@angular/core';
import { HttpProviderService } from './http-provider.service';
import {AppConstants} from '../config/constants';
import {OptionService} from './option.service';

@Injectable()
export class PeerService {

  constructor(public http: HttpProviderService,
              public optionsService: OptionService) { }

    getPeers() {
        return this.http.get(this.getPeerEndPoints()[0], 'api?requestType=getPeers&state=CONNECTED');
    };

    searchIp(ip) {
        let params = {
            'ip': ip
        };
        return this.http.get(this.getPeerEndPoints()[0], '', params );
    };

    getPeerEndPoints() {
        return AppConstants.peerEndpoints;
    };
}
