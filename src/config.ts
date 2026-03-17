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

import { config as loadDotenv } from 'dotenv';
import { BlockProvider } from './providers/block-provider';

export interface EnvConfigOptions {
    path?: string | string[];
    override?: boolean;
}

export interface ConfigInput extends Partial<ConfigInterface> {
    blockProvider?: BlockProvider;
    env?: boolean | EnvConfigOptions;
    activeKey?: ConfigInterface['ACTIVE_KEY'];
    postingKey?: ConfigInterface['POSTING_KEY'];
    jsonId?: ConfigInterface['JSON_ID'];
    hiveEngineApi?: ConfigInterface['HIVE_ENGINE_API'];
    hiveEngineId?: ConfigInterface['HIVE_ENGINE_ID'];
    appName?: ConfigInterface['APP_NAME'];
    username?: ConfigInterface['USERNAME'];
    account?: ConfigInterface['USERNAME'];
    hiveAccount?: ConfigInterface['USERNAME'];
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

type ConfigAliasKey = keyof Omit<ConfigInput, keyof ConfigInterface | 'blockProvider' | 'env'>;

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
    account: 'USERNAME',
    hiveAccount: 'USERNAME',
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
    ACTIVE_KEY: '',
    POSTING_KEY: '',

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

const ENV_VALUE_ALIASES: Record<keyof ConfigInterface, string[]> = {
    ACTIVE_KEY: ['HIVE_ACTIVE_KEY', 'ACTIVE_KEY'],
    POSTING_KEY: ['HIVE_POSTING_KEY', 'POSTING_KEY'],
    JSON_ID: ['JSON_ID'],
    HIVE_ENGINE_API: ['HIVE_ENGINE_API'],
    HIVE_ENGINE_ID: ['HIVE_ENGINE_ID'],
    APP_NAME: ['APP_NAME'],
    USERNAME: ['HIVE_ACCOUNT', 'HIVE_USERNAME', 'ACCOUNT', 'USERNAME'],
    PAYLOAD_IDENTIFIER: ['PAYLOAD_IDENTIFIER'],
    LAST_BLOCK_NUMBER: ['LAST_BLOCK_NUMBER'],
    BLOCK_CHECK_INTERVAL: ['BLOCK_CHECK_INTERVAL'],
    BLOCKS_BEHIND_WARNING: ['BLOCKS_BEHIND_WARNING'],
    RESUME_FROM_STATE: ['RESUME_FROM_STATE'],
    CATCH_UP_BATCH_SIZE: ['CATCH_UP_BATCH_SIZE'],
    CATCH_UP_DELAY_MS: ['CATCH_UP_DELAY_MS'],
    API_NODES: ['API_NODES'],
    API_ENABLED: ['API_ENABLED'],
    API_PORT: ['API_PORT'],
    DEBUG_MODE: ['DEBUG_MODE'],
};

function parseBoolean(value: string): boolean {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseNumber(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStringArray(value: string, fallback: string[]): string[] {
    const parsed = value.split(',').map((item) => item.trim()).filter(Boolean);
    return parsed.length > 0 ? parsed : fallback;
}

export function loadEnv(options: boolean | EnvConfigOptions = true): void {
    if (!options) {
        return;
    }

    const dotenvOptions = typeof options === 'object' ? options : {};
    loadDotenv(dotenvOptions);
}

export function readEnvConfig(): Partial<ConfigInterface> {
    const envConfig: Partial<ConfigInterface> = {};
    const envRecord = envConfig as Record<keyof ConfigInterface, ConfigInterface[keyof ConfigInterface]>;

    for (const key of CONFIG_KEYS) {
        const envKeys = ENV_VALUE_ALIASES[key];
        const value = envKeys
            .map((envKey) => process.env[envKey])
            .find((entry) => entry !== undefined && entry !== '');

        if (value === undefined) {
            continue;
        }

        switch (key) {
            case 'LAST_BLOCK_NUMBER':
            case 'BLOCK_CHECK_INTERVAL':
            case 'BLOCKS_BEHIND_WARNING':
            case 'CATCH_UP_BATCH_SIZE':
            case 'CATCH_UP_DELAY_MS':
            case 'API_PORT':
                envRecord[key] = parseNumber(value, Config[key]) as ConfigInterface[typeof key];
                break;

            case 'RESUME_FROM_STATE':
            case 'API_ENABLED':
            case 'DEBUG_MODE':
                envRecord[key] = parseBoolean(value) as ConfigInterface[typeof key];
                break;

            case 'API_NODES':
                envRecord[key] = parseStringArray(value, Config.API_NODES) as ConfigInterface[typeof key];
                break;

            default:
                envRecord[key] = value as ConfigInterface[typeof key];
                break;
        }
    }

    return envConfig;
}

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
    if (config.env) {
        loadEnv(config.env);
    }

    const envConfig = config.env ? readEnvConfig() : {};
    const normalized = normalizeConfigInput(config);
    const merged = {
        ...Config,
        ...envConfig,
        ...normalized,
    };
    const apiNodes = Array.isArray(merged.API_NODES) ? [...merged.API_NODES] : [...Config.API_NODES];

    return {
        ...merged,
        API_NODES: apiNodes,
    };
}
