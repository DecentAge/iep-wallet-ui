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
        'FALLBACK_HOST_URL': window['envConfig']['FALLBACK_HOST_URL'],
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
        'CONNECTION_MODE': window['envConfig']['CONNECTION_MODE'],
        'RANDOMIZE_NODES': 1,
        'EXTENSIONS': 1,
        'USER_NODE_URL': window['envConfig']['USER_NODE_URL'],
        'LOCALTESTNET_URL': window['envConfig']['LOCALTESTNET_URL'],
        'HTTPS_URL': window['envConfig']['HTTPS_URL'],
        'FOUNDATION_URL': window['envConfig']['FOUNDATION_URL'],
        'TESTNET_URL': window['envConfig']['TESTNET_URL'],
        'DEVTESTNET_URL': window['envConfig']['DEVTESTNET_URL'],
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

    public static peerEndpointsMap = window['envConfig']['peerEndpointsMap'];

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

    public static fiatConfig = window['envConfig']['fiatConfig'];

    public static marketDataConfig = window['envConfig']['marketDataConfig'];

    public static exchangesConfig = window['envConfig']['exchangesConfig'];

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
    public static ATConfig = window['envConfig']['ATConfig'];

    public static messagesConfig = {
        messagesEndPoint: 'api'
    };
    public static searchConfig = window['envConfig']['searchConfig'];

    public static pollConfig = {
        pollEndPoint: 'api'
    };

    public static macapViewerConfig = window['envConfig']['macapViewerConfig'];

    public static newsViewerConfig = window['envConfig']['newsViewerConfig'];

    public static chainViewerConfig = window['envConfig']['chainViewerConfig'];
}
