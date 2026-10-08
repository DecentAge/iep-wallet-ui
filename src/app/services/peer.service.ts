import { Injectable } from '@angular/core';
import { HttpProviderService } from './http-provider.service';
import { map } from 'rxjs/operators';
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
        return this.http.get(AppConstants.peerExplorerApiURL, 'nodes', { 'ip': ip })
            .pipe(map((peer: any) => PeerService.flatten(peer)));
    };

    // the backend nests the node's own report under peerState; the views read it flat
    static flatten(peer: any) {
        return { ...peer, ...(peer && peer.peerState || {}), _id: peer && peer._id };
    }

    getPeerEndPoints() {
        return AppConstants.peerEndpoints;
    };
}
