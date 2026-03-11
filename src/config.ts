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
    API_ENABLED: boolean;
    API_PORT: number;
    DEBUG_MODE: boolean;
}

import { BlockProvider } from './providers/block-provider';

export interface ConfigInput extends Partial<ConfigInterface> {
    blockProvider?: BlockProvider;
    activeKey?: ConfigInterface['ACTIVE_KEY'];
    postingKey?: ConfigInterface['POSTING_KEY'];
    jsonId?: ConfigInterface['JSON_ID'];
    hiveEngineApi?: ConfigInterface['HIVE_ENGINE_API'];
    hiveEngineId?: ConfigInterface['HIVE_ENGINE_ID'];
    appName?: ConfigInterface['APP_NAME'];
    username?: ConfigInterface['USERNAME'];
    payloadIdentifier?: ConfigInterface['PAYLOAD_IDENTIFIER'];
    lastBlockNumber?: ConfigInterface['LAST_BLOCK_NUMBER'];
    blockCheckInterval?: ConfigInterface['BLOCK_CHECK_INTERVAL'];
    blocksBehindWarning?: ConfigInterface['BLOCKS_BEHIND_WARNING'];
    resumeFromState?: ConfigInterface['RESUME_FROM_STATE'];
    catchUpBatchSize?: ConfigInterface['CATCH_UP_BATCH_SIZE'];
    catchUpDelayMs?: ConfigInterface['CATCH_UP_DELAY_MS'];
    apiNodes?: ConfigInterface['API_NODES'];
    apiEnabled?: ConfigInterface['API_ENABLED'];
    apiPort?: ConfigInterface['API_PORT'];
    debugMode?: ConfigInterface['DEBUG_MODE'];
}

type ConfigAliasKey = keyof Omit<ConfigInput, keyof ConfigInterface | 'blockProvider'>;

const CONFIG_KEYS: Array<keyof ConfigInterface> = [
    'ACTIVE_KEY',
    'POSTING_KEY',
    'JSON_ID',
    'HIVE_ENGINE_API',
    'HIVE_ENGINE_ID',
    'APP_NAME',
    'USERNAME',
    'PAYLOAD_IDENTIFIER',
    'LAST_BLOCK_NUMBER',
    'BLOCK_CHECK_INTERVAL',
    'BLOCKS_BEHIND_WARNING',
    'RESUME_FROM_STATE',
    'CATCH_UP_BATCH_SIZE',
    'CATCH_UP_DELAY_MS',
    'API_NODES',
    'API_ENABLED',
    'API_PORT',
    'DEBUG_MODE',
];

export const CONFIG_KEY_ALIASES: Record<ConfigAliasKey, keyof ConfigInterface> = {
    activeKey: 'ACTIVE_KEY',
    postingKey: 'POSTING_KEY',
    jsonId: 'JSON_ID',
    hiveEngineApi: 'HIVE_ENGINE_API',
    hiveEngineId: 'HIVE_ENGINE_ID',
    appName: 'APP_NAME',
    username: 'USERNAME',
    payloadIdentifier: 'PAYLOAD_IDENTIFIER',
    lastBlockNumber: 'LAST_BLOCK_NUMBER',
    blockCheckInterval: 'BLOCK_CHECK_INTERVAL',
    blocksBehindWarning: 'BLOCKS_BEHIND_WARNING',
    resumeFromState: 'RESUME_FROM_STATE',
    catchUpBatchSize: 'CATCH_UP_BATCH_SIZE',
    catchUpDelayMs: 'CATCH_UP_DELAY_MS',
    apiNodes: 'API_NODES',
    apiEnabled: 'API_ENABLED',
    apiPort: 'API_PORT',
    debugMode: 'DEBUG_MODE',
};

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
    API_ENABLED: false,
    API_PORT: 5001,

    DEBUG_MODE: false,
};

export function normalizeConfigInput(config: ConfigInput = {}): Partial<ConfigInterface> {
    const normalized: Partial<ConfigInterface> = {};
    const normalizedRecord = normalized as Record<keyof ConfigInterface, ConfigInterface[keyof ConfigInterface]>;
    const canonicalConfig = config as Partial<ConfigInterface>;

    for (const key of CONFIG_KEYS) {
        const value = canonicalConfig[key];
        if (value !== undefined) {
            normalizedRecord[key] = value;
        }
    }

    const aliasEntries = Object.entries(CONFIG_KEY_ALIASES) as Array<[ConfigAliasKey, keyof ConfigInterface]>;

    for (const [aliasKey, canonicalKey] of aliasEntries) {
        if (normalized[canonicalKey] !== undefined) {
            continue;
        }

        const aliasValue = config[aliasKey];
        if (aliasValue !== undefined) {
            normalizedRecord[canonicalKey] = aliasValue as ConfigInterface[typeof canonicalKey];
        }
    }

    return normalized;
}

export function createConfig(config: ConfigInput = {}): ConfigInterface {
    const normalized = normalizeConfigInput(config);
    const apiNodes = Array.isArray(normalized.API_NODES) ? [...normalized.API_NODES] : [...Config.API_NODES];

    return {
        ...Config,
        ...normalized,
        API_NODES: apiNodes,
    };
}
