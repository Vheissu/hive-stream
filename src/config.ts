export interface ConfigInterface {
    ACTIVE_KEY: string;
    POSTING_KEY: string;
    APP_NAME: string;
    USERNAME: string;
    LAST_BLOCK_NUMBER: number;
    BLOCK_CHECK_INTERVAL: number;
    BLOCKS_BEHIND_WARNING: number;
    CHAIN_ID: string;
    API_NODES: string[];
    DEBUG_MODE: boolean;
}

export const Config: ConfigInterface = {
    ACTIVE_KEY: '',
    POSTING_KEY: '',

    APP_NAME: 'steem-stream',

    USERNAME: '',

    LAST_BLOCK_NUMBER: 0,

    BLOCK_CHECK_INTERVAL: 1000,
    BLOCKS_BEHIND_WARNING: 25,

    CHAIN_ID: 'ssc-mainnet1',
    API_NODES: ['https://anyx.io', 'https://api.hive.blog'],

    DEBUG_MODE: false,
};