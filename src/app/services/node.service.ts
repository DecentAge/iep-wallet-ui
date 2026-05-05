import { Injectable } from '@angular/core';
import { SessionStorageService } from './session-storage.service';
import { NodeConfig } from '../config/node-config';
import { PeerService } from './peer.service';
import { OptionService } from './option.service';
import { LocalhostService } from './localhost.service';
import { AppConstants } from '../config/constants';
import { BroadcastService } from './broadcast.service';
import {HttpProviderService} from './http-provider.service';

@Injectable()
export class NodeService {

    constructor(
        public http: HttpProviderService,
        public sessionService: SessionStorageService,
        public peerService: PeerService,
        public optionsService: OptionService,
        public localHostService: LocalhostService,
        public broadcastService: BroadcastService
    ) { }

    getLocalNode() {
        const node = this.sessionService.getFromSession(NodeConfig.SESSION_LOCAL_NODE);
        if (!node) {
            return this.optionsService.getOption('USER_NODE_URL', '');
        }
        return node;
    }

    hasLocal() {
        return this.sessionService.getFromSession(NodeConfig.SESSION_HAS_LOCAL);
    }

    getPeerNode(i) {
        const peerNodes = this.sessionService.getFromSession(NodeConfig.SESSION_PEER_NODES);
        if (!peerNodes) {
            return this.peerService.getPeers().subscribe((response) => {
                if (this.sessionService) {
                    this.sessionService.saveToSession(NodeConfig.SESSION_PEER_NODES, response);
                }
                // Used custom broadcast
                // TODO: change broadcast listner to custom broadcastService method
                if (this.broadcastService) {
                    this.broadcastService.broadcast('peers-updated');
                }
                return response[i];
            });
        } else {
            return peerNodes[i];
        }

    }

    clearNodeConfig() {
        this.sessionService.deleteFromSession(NodeConfig.SESSION_PEER_NODES);
        this.sessionService.deleteFromSession(NodeConfig.SESSION_HAS_LOCAL);
        this.sessionService.deleteFromSession(NodeConfig.SESSION_LOCAL_NODE);
    };

    getNodesCount() {
        const total = this.sessionService.getFromSession(NodeConfig.SESSION_PEER_NODES) || [];
        return total.length + 1;
    };

    getNodeUrl() {
        return this.optionsService.getOption('NODE_API_URL', '');
    };

    appendPortIfNotPresent(url, port) {

        let parser = new URL(url);

        if (!parser.port) {
            return url + ':' + port;
        }

        return url;
    }

    // Returns true when it is safe to send a passphrase to the node.
    // Safe means: running on devnet, or the browser is on localhost/127.0.0.1.
    isLocalNode(): boolean {
        const env = (AppConstants.DEFAULT_OPTIONS.NETWORK_ENVIRONMENT || '').toLowerCase();
        if (env === 'devnet') {
            return true;
        }
        const loc = window.location;
        return loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
    }

    // Throws when isLocalNode() is false. Call this at the top of any service
    // method that sends a secretPhrase over HTTP.
    requireLocalNode(): void {
        if (!this.isLocalNode()) {
            throw new Error('This operation requires a local node connection. Set connection mode to LOCALHOST in options.');
        }
    }



    getLastBlock() {
        return this.http.get(this.getNodeUrl(), 'api?requestType=getBlock');
    }

}
