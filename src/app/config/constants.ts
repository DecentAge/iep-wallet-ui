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
        'FALLBACK_HOST_URL': 'http://208.95.1.177:23457',
        'AUTO_PAGE_REFRESH_INTERVAL': 60000,
        'TOKEN_QUANTS': 100000000,
        'TX_DEADLINE': 60,
        'apiEndPoint': 'api',
        'SESSION_CURRENT_BLOCK': 'current_block',
        'SESSION_APP_OPTIONS': 'app_options',
        'SESSION_PEER_ENDPOINTS': 'peerEndpoints',
        'SESSION_MAX_RETRIES': '2',
        'SESSION_CURRENT_TRY': '0',
        'EPOCH': 1484046000,
    };
    public static DEFAULT_OPTIONS = {
        'VERSION': '1.0.1',
        'DEADLINE': '60',
        'REFRESH_INTERVAL_MILLI_SECONDS': '60000',
        'TX_HEIGHT': 7 * 1440,
        'AUTO_UPDATE': 1,
        // Following values are supported:
         //   - AUTO            Retrieves the node to be used from /api/nodes and take one randomly from the result list or the first if RANDOMIZE_NODES=true
         //   - FOUNDATION      The API endpoint to access the mainnet. Will use the URL defined by FOUNDATION_URL.
         //   - MANUAL          Let the user manually set override API endpoint in die wallet settings (value will be stored in Session store)
         //   - LOCAL_HOST      ?
         //   - TESTNET         The API endpoint to access the testnet. Will use the URL defined by TESTNET_URL.
         //   - LOCALTESTNET    The API endpoint to access the testnet locally. Will use the URL defined by LOCALTESTNET_URL.
         //   - DEVTESTNET      The API endpoint to access the devnet. Will use the URL defined by DEVTESTNET_URL.
         //   - HTTPS           The API endpoint to securly access the mainnet with SSL.
        'CONNECTION_MODE': 'TESTNET',
        'RANDOMIZE_NODES': 1,
        'EXTENSIONS': 1,
        'USER_NODE_URL': 'http://localhost:23457',
        'LOCALTESTNET_URL': 'http://node-1',
        'HTTPS_URL': 'https://ssl.infinity-economics.org',
        'FOUNDATION_URL': 'http://159.89.117.247:23457',
        'TESTNET_URL': 'http://168.119.228.238:9876',
        'DEVTESTNET_URL': 'http://142.93.129.78:9876'
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
        'TX_HEIGHT': 10080
    };

    public static peerEndpointsMap = {
        DEFAULT: [
            // 'http://185.35.137.7:8888/api/nodes',
            // 'http://185.35.139.102:8888/api/nodes',
            // 'http://185.35.139.103:8888/api/nodes',
            // 'http://185.35.139.104:8888/api/nodes',
            // 'http://185.35.139.105:8888/api/nodes',
            // 'http://46.244.20.41:8888/api/nodes',
            // 'http://185.35.139.101:8888/api/nodes',
            'http://208.95.1.177:8888/api/nodes',
            'http://199.127.137.169:8888/api/nodes',
            // 'http://185.103.75.217:8888/api/nodes',
            /* ----- New Node endpoints ----- */
            'http://35.204.224.241:8888/api/nodes'
        ],
        DEVTESTNET: [
            'http://185.35.138.132:9999/api/nodes',
        ],
        TESTNET: [
            // 'http://168.119.228.238/api/v1/nodes'
            'http://168.119.228.238/api/nodes'
        ],
		LOCALTESTNET: [
			'http://localhost/peerexplorer-backend/api/nodes'
		]
    };

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

    public static fiatConfig = {
        btcEndpoint: 'http://167.99.242.171:8080',
        xinEndpoint: 'http://167.99.242.171:8080'
    };

    public static marketDataConfig = {
        baseUrl: 'https://min-api.cryptocompare.com',
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
        ATCompilerURL: 'http://142.93.63.219:10080', // 'http://185.61.149.71:10080'
    };
    public static messagesConfig = {
        messagesEndPoint: 'api'
    };
    public static searchConfig = {
        'searchEndPoint': 'api',
        'searchAccountString': 'XIN',
        'searchPeerUrl': 'http://168.119.228.238/api/nodes',
        'searchPeerEndPoint': 'api/nodes',
    };
    public static pollConfig = {
        pollEndPoint: 'api'
    };

    public static macapViewerConfig = {
        'macapUrl': 'http://167.99.242.171:8892',
        'macapEndPoint': 'api/v1/get'
    };

    public static newsViewerConfig = {
        'newsUrl': 'http://199.127.137.169:8889',
        'newsEndPoint': 'api/v1/news'
    };

    public static chainViewerConfig = {
        'apiUrl': 'http://199.127.137.169:23457',
        'peerUrl': 'http://199.127.137.169:8888',
        'peerEndPoint': 'api/nodes',
        'endPoint': 'api'
    };
}
