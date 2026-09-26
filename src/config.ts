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
    /** `irreversible` (default) only processes blocks at or below the last irreversible block; `head` follows the head block and handles forks. */
    STREAM_MODE: StreamMode;
    /** `block` (default) persists the cursor after every block; `interval` persists at most every CHECKPOINT_INTERVAL_MS. */
    CHECKPOINT_MODE: CheckpointMode;
    CHECKPOINT_INTERVAL_MS: number;
    /** Records every dispatched contract action so replayed blocks never execute it twice. */
    IDEMPOTENCY_ENABLED: boolean;
    /** How many blocks of idempotency records to keep (default ~7 days). */
    IDEMPOTENCY_RETENTION_BLOCKS: number;
    /** What to do when a contract action or adapter write fails: `skip` (log and continue), `halt` (stop the streamer), `retry` (retry with backoff, then halt). */
    ERROR_POLICY: ErrorPolicy;
    ERROR_MAX_RETRIES: number;
    ERROR_RETRY_DELAY_MS: number;
    /** Upper bound for exponential backoff when block fetching fails. */
    RETRY_MAX_DELAY_MS: number;
    /** Per-request timeout for Hive API calls before failing over to the next node. */
    API_TIMEOUT_MS: number;
    /** How far back (in blocks) the streamer searches for a common ancestor after a fork. */
    MAX_FORK_DEPTH: number;
}

export type StreamMode = 'irreversible' | 'head';
export type CheckpointMode = 'block' | 'interval';
export type ErrorPolicy = 'skip' | 'halt' | 'retry';

import { config as loadDotenv } from 'dotenv';
import { BlockProvider } from './providers/block-provider';
import { DEFAULT_CONTRACT_JSON_ID, DEFAULT_CONTRACT_PAYLOAD_IDENTIFIER } from './defaults';
import type { Client } from '@hiveio/dhive';
import type { Logger } from './logger';
import type { StreamerHooks } from './hooks';

export interface EnvConfigOptions {
    path?: string | string[];
    override?: boolean;
}

export interface ConfigInput extends Partial<ConfigInterface> {
    blockProvider?: BlockProvider;
    client?: Client;
    logger?: Logger;
    hooks?: StreamerHooks;
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
    streamMode?: ConfigInterface['STREAM_MODE'];
    checkpointMode?: ConfigInterface['CHECKPOINT_MODE'];
    checkpointIntervalMs?: ConfigInterface['CHECKPOINT_INTERVAL_MS'];
    idempotency?: ConfigInterface['IDEMPOTENCY_ENABLED'];
    idempotencyEnabled?: ConfigInterface['IDEMPOTENCY_ENABLED'];
    idempotencyRetentionBlocks?: ConfigInterface['IDEMPOTENCY_RETENTION_BLOCKS'];
    errorPolicy?: ConfigInterface['ERROR_POLICY'];
    errorMaxRetries?: ConfigInterface['ERROR_MAX_RETRIES'];
    errorRetryDelayMs?: ConfigInterface['ERROR_RETRY_DELAY_MS'];
    retryMaxDelayMs?: ConfigInterface['RETRY_MAX_DELAY_MS'];
    apiTimeoutMs?: ConfigInterface['API_TIMEOUT_MS'];
    maxForkDepth?: ConfigInterface['MAX_FORK_DEPTH'];
}

type ConfigAliasKey = keyof Omit<ConfigInput, keyof ConfigInterface | 'blockProvider' | 'client' | 'logger' | 'hooks' | 'env'>;

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
    'STREAM_MODE',
    'CHECKPOINT_MODE',
    'CHECKPOINT_INTERVAL_MS',
    'IDEMPOTENCY_ENABLED',
    'IDEMPOTENCY_RETENTION_BLOCKS',
    'ERROR_POLICY',
    'ERROR_MAX_RETRIES',
    'ERROR_RETRY_DELAY_MS',
    'RETRY_MAX_DELAY_MS',
    'API_TIMEOUT_MS',
    'MAX_FORK_DEPTH',
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
    streamMode: 'STREAM_MODE',
    checkpointMode: 'CHECKPOINT_MODE',
    checkpointIntervalMs: 'CHECKPOINT_INTERVAL_MS',
    idempotency: 'IDEMPOTENCY_ENABLED',
    idempotencyEnabled: 'IDEMPOTENCY_ENABLED',
    idempotencyRetentionBlocks: 'IDEMPOTENCY_RETENTION_BLOCKS',
    errorPolicy: 'ERROR_POLICY',
    errorMaxRetries: 'ERROR_MAX_RETRIES',
    errorRetryDelayMs: 'ERROR_RETRY_DELAY_MS',
    retryMaxDelayMs: 'RETRY_MAX_DELAY_MS',
    apiTimeoutMs: 'API_TIMEOUT_MS',
    maxForkDepth: 'MAX_FORK_DEPTH',
};

export const Config: ConfigInterface = {
    ACTIVE_KEY: '',
    POSTING_KEY: '',

    JSON_ID: DEFAULT_CONTRACT_JSON_ID,

    HIVE_ENGINE_API: 'https://api.hive-engine.com/rpc',
    HIVE_ENGINE_ID: 'ssc-mainnet-hive',

    APP_NAME: 'hive-stream',

    PAYLOAD_IDENTIFIER: DEFAULT_CONTRACT_PAYLOAD_IDENTIFIER,

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

    STREAM_MODE: 'irreversible',
    CHECKPOINT_MODE: 'block',
    CHECKPOINT_INTERVAL_MS: 5000,
    IDEMPOTENCY_ENABLED: true,
    IDEMPOTENCY_RETENTION_BLOCKS: 201600,
    ERROR_POLICY: 'skip',
    ERROR_MAX_RETRIES: 3,
    ERROR_RETRY_DELAY_MS: 500,
    RETRY_MAX_DELAY_MS: 30000,
    API_TIMEOUT_MS: 10000,
    MAX_FORK_DEPTH: 20,
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
    STREAM_MODE: ['STREAM_MODE'],
    CHECKPOINT_MODE: ['CHECKPOINT_MODE'],
    CHECKPOINT_INTERVAL_MS: ['CHECKPOINT_INTERVAL_MS'],
    IDEMPOTENCY_ENABLED: ['IDEMPOTENCY_ENABLED'],
    IDEMPOTENCY_RETENTION_BLOCKS: ['IDEMPOTENCY_RETENTION_BLOCKS'],
    ERROR_POLICY: ['ERROR_POLICY'],
    ERROR_MAX_RETRIES: ['ERROR_MAX_RETRIES'],
    ERROR_RETRY_DELAY_MS: ['ERROR_RETRY_DELAY_MS'],
    RETRY_MAX_DELAY_MS: ['RETRY_MAX_DELAY_MS'],
    API_TIMEOUT_MS: ['API_TIMEOUT_MS'],
    MAX_FORK_DEPTH: ['MAX_FORK_DEPTH'],
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
            case 'CHECKPOINT_INTERVAL_MS':
            case 'IDEMPOTENCY_RETENTION_BLOCKS':
            case 'ERROR_MAX_RETRIES':
            case 'ERROR_RETRY_DELAY_MS':
            case 'RETRY_MAX_DELAY_MS':
            case 'API_TIMEOUT_MS':
            case 'MAX_FORK_DEPTH':
                envRecord[key] = parseNumber(value, Config[key]) as ConfigInterface[typeof key];
                break;

            case 'RESUME_FROM_STATE':
            case 'API_ENABLED':
            case 'DEBUG_MODE':
            case 'IDEMPOTENCY_ENABLED':
                envRecord[key] = parseBoolean(value) as ConfigInterface[typeof key];
                break;

            case 'API_NODES':
                envRecord[key] = parseStringArray(value, Config.API_NODES) as ConfigInterface[typeof key];
                break;

            case 'STREAM_MODE':
            case 'CHECKPOINT_MODE':
            case 'ERROR_POLICY':
                envRecord[key] = value.trim().toLowerCase() as ConfigInterface[typeof key];
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
    const apiNodes = Array.isArray(merged.API_NODES) ? [...merged.API_NODES] : merged.API_NODES;

    const result = {
        ...merged,
        API_NODES: apiNodes,
    } as ConfigInterface;

    validateConfig(result);

    return result;
}

export class ConfigValidationError extends Error {
    public readonly problems: string[];

    constructor(problems: string[]) {
        super(`Invalid hive-stream configuration:\n  - ${problems.join('\n  - ')}`);
        this.name = 'ConfigValidationError';
        this.problems = problems;
    }
}

const STREAM_MODES: StreamMode[] = ['irreversible', 'head'];
const CHECKPOINT_MODES: CheckpointMode[] = ['block', 'interval'];
const ERROR_POLICIES: ErrorPolicy[] = ['skip', 'halt', 'retry'];

function isHttpUrl(value: unknown): boolean {
    if (typeof value !== 'string' || !value.trim()) {
        return false;
    }

    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Validates a resolved configuration and throws a ConfigValidationError
 * listing every problem at once, so misconfiguration fails fast at
 * construction instead of surfacing as a stalled stream later.
 */
export function validateConfig(config: ConfigInterface): void {
    const problems: string[] = [];

    const checkInteger = (key: keyof ConfigInterface, min: number, max: number = Number.MAX_SAFE_INTEGER) => {
        const value = config[key] as unknown;

        if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
            const range = max === Number.MAX_SAFE_INTEGER ? `>= ${min}` : `between ${min} and ${max}`;
            problems.push(`${key} must be an integer ${range} (received ${JSON.stringify(value)})`);
        }
    };

    const checkEnum = <T extends string>(key: keyof ConfigInterface, allowed: T[]) => {
        const value = config[key] as unknown;

        if (!allowed.includes(value as T)) {
            problems.push(`${key} must be one of ${allowed.map((entry) => `'${entry}'`).join(', ')} (received ${JSON.stringify(value)})`);
        }
    };

    const checkBoolean = (key: keyof ConfigInterface) => {
        if (typeof config[key] !== 'boolean') {
            problems.push(`${key} must be a boolean (received ${JSON.stringify(config[key])})`);
        }
    };

    const checkNonEmptyString = (key: keyof ConfigInterface) => {
        const value = config[key] as unknown;

        if (typeof value !== 'string' || !value.trim()) {
            problems.push(`${key} must be a non-empty string`);
        }
    };

    checkInteger('LAST_BLOCK_NUMBER', 0);
    checkInteger('BLOCK_CHECK_INTERVAL', 1);
    checkInteger('BLOCKS_BEHIND_WARNING', 0);
    checkInteger('CATCH_UP_BATCH_SIZE', 1);
    checkInteger('CATCH_UP_DELAY_MS', 0);
    checkInteger('API_PORT', 0, 65535);
    checkInteger('CHECKPOINT_INTERVAL_MS', 1);
    checkInteger('IDEMPOTENCY_RETENTION_BLOCKS', 1);
    checkInteger('ERROR_MAX_RETRIES', 0);
    checkInteger('ERROR_RETRY_DELAY_MS', 0);
    checkInteger('RETRY_MAX_DELAY_MS', 1);
    checkInteger('API_TIMEOUT_MS', 1);
    checkInteger('MAX_FORK_DEPTH', 1);

    checkBoolean('RESUME_FROM_STATE');
    checkBoolean('API_ENABLED');
    checkBoolean('DEBUG_MODE');
    checkBoolean('IDEMPOTENCY_ENABLED');

    checkEnum('STREAM_MODE', STREAM_MODES);
    checkEnum('CHECKPOINT_MODE', CHECKPOINT_MODES);
    checkEnum('ERROR_POLICY', ERROR_POLICIES);

    checkNonEmptyString('JSON_ID');
    checkNonEmptyString('PAYLOAD_IDENTIFIER');
    checkNonEmptyString('HIVE_ENGINE_ID');

    if (!isHttpUrl(config.HIVE_ENGINE_API)) {
        problems.push(`HIVE_ENGINE_API must be an http(s) URL (received ${JSON.stringify(config.HIVE_ENGINE_API)})`);
    }

    if (!Array.isArray(config.API_NODES) || config.API_NODES.length === 0) {
        problems.push('API_NODES must be a non-empty array of http(s) URLs');
    } else {
        for (const node of config.API_NODES) {
            if (!isHttpUrl(node)) {
                problems.push(`API_NODES contains an invalid URL: ${JSON.stringify(node)}`);
            }
        }
    }

    for (const key of ['ACTIVE_KEY', 'POSTING_KEY', 'USERNAME', 'APP_NAME'] as const) {
        if (config[key] !== undefined && config[key] !== null && typeof config[key] !== 'string') {
            problems.push(`${key} must be a string`);
        }
    }

    if (problems.length > 0) {
        throw new ConfigValidationError(problems);
    }
}

/**
 * Typed identity helper for keeping configuration in its own module:
 *
 * ```ts
 * export default defineConfig({ username: 'myapp', streamMode: 'irreversible' });
 * ```
 */
export function defineConfig(config: ConfigInput): ConfigInput {
    return config;
}

