export interface ConfigInterface {
    ACTIVE_KEY: string;
    POSTING_KEY: string;
    JSON_ID: string;
    HIVE_ENGINE_API: string;
    HIVE_ENGINE_ID: string;
    APP_NAME: string;
    USERNAME: string;
    PAYLOAD_IDENTIFIER: string;
    LAST_BLOCK_NUMBER: number;
    BLOCK_CHECK_INTERVAL: number;
    BLOCKS_BEHIND_WARNING: number;
    RESUME_FROM_STATE: boolean;
    CATCH_UP_BATCH_SIZE: number;
    CATCH_UP_DELAY_MS: number;
    API_NODES: string[];
    DEBUG_MODE: boolean;
}

export const Config: ConfigInterface = {
    ACTIVE_KEY: process.env.ACTIVE_KEY,
    POSTING_KEY: process.env.POSTING_KEY,

    JSON_ID: 'hivestream',

    HIVE_ENGINE_API: 'https://api.hive-engine.com/rpc',
    HIVE_ENGINE_ID: 'ssc-mainnet-hive',

    APP_NAME: 'hive-stream',

    PAYLOAD_IDENTIFIER: 'hive_stream',

    USERNAME: '',

    LAST_BLOCK_NUMBER: 0,

    BLOCK_CHECK_INTERVAL: 1000,
    BLOCKS_BEHIND_WARNING: 25,
    RESUME_FROM_STATE: true,
    CATCH_UP_BATCH_SIZE: 50,
    CATCH_UP_DELAY_MS: 0,

    API_NODES: ['https://api.hive.blog', 'https://api.openhive.network', 'https://rpc.ausbit.dev'],

    DEBUG_MODE: true,
};
