const getEnvConfig = (key) => {
    if (window['envConfig'][key]) {
        if (typeof window['envConfig'][key] !== 'string' && window['envConfig'][key].length === 0) {
            return null;
        } else if (typeof window['envConfig'][key] === 'string' && window['envConfig'][key] === '') {
            return null;
        } else {
            return window['envConfig'][key];
        }
    }
    return null;
}

export class AppConstants {

    public static languageConfig = {
        DEFAULT: 'en',
        SESSION_SELECTED_LANGUAGE_KEY: 'selected_language'
    };
    public static optionsConfig = {
        'tableOptions': 'options'
    };
    public static baseConfig = {
        'SESSION_STORAGE_NAMESPACE': 'com.client',
        // This url to access the node API is used when defined connection mode no URL is specified
        'AUTO_PAGE_REFRESH_INTERVAL': 60000,
        'TOKEN_QUANTS': 100000000,
        'TX_DEADLINE': 60,
        'apiEndPoint': 'api',
        'SESSION_CURRENT_BLOCK': 'current_block',
        'SESSION_APP_OPTIONS': 'app_options',
        'SESSION_PEER_ENDPOINTS': 'peerEndpoints',
        'SESSION_MAX_RETRIES': '2',
        'SESSION_CURRENT_TRY': '0',
        'EPOCH': getEnvConfig('genesisBlockEpoch'),
        'SESSION_STORAGE_EXPIRATION': getEnvConfig('walletBrowserStorageExp'),
        'LEASING_OFFSET_BLOCK': getEnvConfig('effectiveLeasingOffsetBlock'),
    };
    public static DEFAULT_OPTIONS = {
        'VERSION': getEnvConfig('version'),
        'NETWORK_ENVIRONMENT': getEnvConfig('env'),
        'DEADLINE': '60',
        'REFRESH_INTERVAL_MILLI_SECONDS': '60000',
        'TX_HEIGHT': getEnvConfig('phasingDuration'),
        'AUTO_UPDATE': 1,
        'RANDOMIZE_NODES': 1,
        'EXTENSIONS': 1,
        'NODE_API_URL': getEnvConfig('apiServerURL') || 'http://node-1',
    };
    public static addressBookConfig = {
        'tableAddressBook': 'addressBook'
    };
    public static assetsConfig = {
        'assetsEndPoint': 'api'
    };

    public static localhostConfig = {
        'apiUrl': 'http://localhost:23457',
        'endPoint': 'api',
        'SESSION_PEER_URL_KEY': 'peerKey'
    };

    public static accountConfig = {
        'accountEndPoint': 'api'
    };

    public static crowdfundingConfig = {
        'crowdfundingEndPoint': 'api'
    };
    public static options = {
        'TX_HEIGHT': getEnvConfig('phasingDuration'),
    };

    public static peerEndpoints = [
            AppConstants.DEFAULT_OPTIONS.NODE_API_URL
        ];

    public static loginConfig = {
        SESSION_ACCOUNT_DETAILS_KEY: 'account_details',
        SESSION_ACCOUNT_PRIVATE_KEY: 'account_private_key'
    };

    public static controlConfig = {
        SESSION_ACCOUNT_CONTROL_HASCONTROL_KEY: 'account_control_hascontrol',
        SESSION_ACCOUNT_CONTROL_JSONCONTROL_KEY: 'account_control_jsoncontrol'
    };

    public static dashboardConfig = {
        apiEndPoint: 'api'
    };

    public static marketDataConfig = {
        baseUrl: getEnvConfig('proxyMarketURL') || 'https://min-api.cryptocompare.com',
        endpoint: 'data'
    };

    public static exchangesConfig = {
        BLOCKR_URL_END_POINT: 'https://blockexplorer.com/api/',
        BLOCKR_ADDRESS_END_POINT: 'addr',
    };

    public static currenciesConfig = {
        currenciesEndPoint: 'api'
    };

    public static escrowConfig = {
        escrowEndPoint: 'api'
    };

    public static subscriptionConfig = {
        subscriptionEndPoint: 'api'
    };
    public static aliasesConfig = {
        aliasesEndPoint: 'api'
    };

    public static shufflingsConfig = {
        shufflingEndPoint: 'api',
    };
    public static ATConfig = {
        ATEndPoint: 'api',
        ATCompilerURL: getEnvConfig('apiServerURL'), // 'http://185.61.149.71:10080'
    };

    public static messagesConfig = {
        messagesEndPoint: 'api'
    };
    public static searchConfig = {
        searchEndPoint: getEnvConfig('SEARCH_ENDPOINT') || 'api',
        searchAccountString: getEnvConfig('SEARCH_ACCOUNG_STRING') || 'XIN',
        searchPeerUrl: getEnvConfig('SEARCH_PEER_URL') || 'http://168.119.228.238/api/nodes',
        searchPeerEndPoint: getEnvConfig('SEARCH_PEER_ENDPOINT') || 'api/nodes',
    };

    public static pollConfig = {
        pollEndPoint: 'api'
    };

    public static macapViewerConfig = {
        macapUrl: getEnvConfig('MACAP_URL') || 'http://167.99.242.171:8892',
        macapEndPoint: getEnvConfig('MACAP_ENDPOINT') || 'api/v1/get'
    };

    public static newsViewerConfig = {
        newsUrl: getEnvConfig('NEWS_URL') || 'http://199.127.137.169:8889',
        newsEndPoint: getEnvConfig('NEWS_ENDPOINT') || 'api/v1/news'
    };

    public static chainViewerConfig = {
        apiUrl: getEnvConfig('CHAINVIEWER_API_URL') || 'http://199.127.137.169:23457',
        peerUrl: getEnvConfig('CHAINVIEWER_PEER_URL') || 'http://199.127.137.169:8888',
        peerEndPoint: getEnvConfig('CHAINVIEWER_PEER_ENDPOINT') || 'api/nodes',
        endPoint: getEnvConfig('CHAINVIEWER_ENDPOINT') || 'api'
    };
}
