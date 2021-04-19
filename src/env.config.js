window.envConfig = {
    CONNECTION_MODE: "LOCALTESTNET",

    FALLBACK_HOST_URL: 'http://208.95.1.177:23457',

    USER_NODE_URL: 'http://localhost:23457',
    LOCALTESTNET_URL: 'http://node-1',
    HTTPS_URL: 'https://ssl.infinity-economics.org',
    FOUNDATION_URL: 'http://159.89.117.247:23457',
    TESTNET_URL: 'http://168.119.228.238:9876',
    DEVTESTNET_URL: 'http://142.93.129.78:9876',

    peerEndpointsMap: {
        DEFAULT: [
            'http://208.95.1.177:8888/api/nodes',
            'http://199.127.137.169:8888/api/nodes',
            'http://35.204.224.241:8888/api/nodes'
        ],
        DEVTESTNET: [
            'http://185.35.138.132:9999/api/nodes',
        ],
        TESTNET: [
            'http://168.119.228.238/api/nodes'
        ],
        LOCALTESTNET: [
            'http://localhost/peerexplorer-backend/api/nodes'
        ]
    },

    fiatConfig: {
        btcEndpoint: 'http://167.99.242.171:8080',
        xinEndpoint: 'http://167.99.242.171:8080'
    },

    marketDataConfig: {
        baseUrl: 'https://min-api.cryptocompare.com',
        endpoint: 'data'
    },

    exchangesConfig: {
        BLOCKR_URL_END_POINT: 'https://blockexplorer.com/api/',
        BLOCKR_ADDRESS_END_POINT: 'addr',
    },

    ATConfig: {
        ATEndPoint: 'api',
        ATCompilerURL: 'http://142.93.63.219:10080', // 'http://185.61.149.71:10080'
    },

    searchConfig: {
        searchEndPoint: 'api',
        searchAccountString: 'XIN',
        searchPeerUrl: 'http://168.119.228.238/api/nodes',
        searchPeerEndPoint: 'api/nodes',
    },

    macapViewerConfig: {
        macapUrl: 'http://167.99.242.171:8892',
        macapEndPoint: 'api/v1/get'
    },

    newsViewerConfig: {
        newsUrl: 'http://199.127.137.169:8889',
        newsEndPoint: 'api/v1/news'
    },

    chainViewerConfig: {
        apiUrl: 'http://199.127.137.169:23457',
        peerUrl: 'http://199.127.137.169:8888',
        peerEndPoint: 'api/nodes',
        endPoint: 'api'
    }
}
