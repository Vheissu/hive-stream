import {
    Config,
    ConfigValidationError,
    createConfig,
    defineConfig,
    normalizeConfigInput,
    Streamer,
    validateConfig
} from '../../src';

describe('Config defaults for 4.0', () => {
    test('streams irreversible blocks and checkpoints every block by default', () => {
        const config = createConfig();

        expect(config.STREAM_MODE).toBe('irreversible');
        expect(config.CHECKPOINT_MODE).toBe('block');
        expect(config.IDEMPOTENCY_ENABLED).toBe(true);
        expect(config.ERROR_POLICY).toBe('skip');
        expect(config.API_TIMEOUT_MS).toBe(10000);
    });

    test('camelCase aliases map to the new options', () => {
        const normalized = normalizeConfigInput({
            streamMode: 'head',
            checkpointMode: 'interval',
            checkpointIntervalMs: 2500,
            idempotency: false,
            idempotencyRetentionBlocks: 1000,
            errorPolicy: 'halt',
            errorMaxRetries: 5,
            errorRetryDelayMs: 10,
            retryMaxDelayMs: 2000,
            apiTimeoutMs: 3000,
            maxForkDepth: 7
        });

        expect(normalized).toMatchObject({
            STREAM_MODE: 'head',
            CHECKPOINT_MODE: 'interval',
            CHECKPOINT_INTERVAL_MS: 2500,
            IDEMPOTENCY_ENABLED: false,
            IDEMPOTENCY_RETENTION_BLOCKS: 1000,
            ERROR_POLICY: 'halt',
            ERROR_MAX_RETRIES: 5,
            ERROR_RETRY_DELAY_MS: 10,
            RETRY_MAX_DELAY_MS: 2000,
            API_TIMEOUT_MS: 3000,
            MAX_FORK_DEPTH: 7
        });
    });

    test('reads the new options from environment variables', () => {
        const keys = ['STREAM_MODE', 'CHECKPOINT_MODE', 'ERROR_POLICY', 'IDEMPOTENCY_ENABLED', 'ERROR_MAX_RETRIES'];
        const previous = keys.map((key) => process.env[key]);

        process.env.STREAM_MODE = 'HEAD';
        process.env.CHECKPOINT_MODE = 'interval';
        process.env.ERROR_POLICY = 'retry';
        process.env.IDEMPOTENCY_ENABLED = 'false';
        process.env.ERROR_MAX_RETRIES = '2';

        try {
            const config = createConfig({ env: { path: '/nonexistent/.env' } });

            expect(config.STREAM_MODE).toBe('head');
            expect(config.CHECKPOINT_MODE).toBe('interval');
            expect(config.ERROR_POLICY).toBe('retry');
            expect(config.IDEMPOTENCY_ENABLED).toBe(false);
            expect(config.ERROR_MAX_RETRIES).toBe(2);
        } finally {
            keys.forEach((key, index) => {
                if (previous[index] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = previous[index];
                }
            });
        }
    });

    test('defineConfig is a typed identity helper', () => {
        const input = { username: 'myapp', streamMode: 'head' as const };
        expect(defineConfig(input)).toBe(input);
    });
});

describe('Config validation', () => {
    test('accepts the defaults', () => {
        expect(() => validateConfig({ ...Config })).not.toThrow();
    });

    test('rejects non-positive intervals and batch sizes', () => {
        expect(() => createConfig({ blockCheckInterval: 0 })).toThrow(/BLOCK_CHECK_INTERVAL must be an integer >= 1/);
        expect(() => createConfig({ catchUpBatchSize: -5 })).toThrow(/CATCH_UP_BATCH_SIZE/);
        expect(() => createConfig({ checkpointIntervalMs: 0 })).toThrow(/CHECKPOINT_INTERVAL_MS/);
    });

    test('rejects negative and fractional numbers', () => {
        expect(() => createConfig({ lastBlockNumber: -1 })).toThrow(/LAST_BLOCK_NUMBER/);
        expect(() => createConfig({ errorMaxRetries: 1.5 })).toThrow(/ERROR_MAX_RETRIES/);
        expect(() => createConfig({ apiPort: 70000 })).toThrow(/API_PORT must be an integer between 0 and 65535/);
    });

    test('rejects an empty or malformed API node list', () => {
        expect(() => createConfig({ apiNodes: [] })).toThrow(/API_NODES must be a non-empty array/);
        expect(() => createConfig({ apiNodes: ['not a url'] })).toThrow(/API_NODES contains an invalid URL/);
        expect(() => createConfig({ apiNodes: ['ftp://api.hive.blog'] })).toThrow(/invalid URL/);
        expect(() => createConfig({ hiveEngineApi: 'nope' })).toThrow(/HIVE_ENGINE_API/);
    });

    test('rejects unknown enum values', () => {
        expect(() => createConfig({ streamMode: 'fast' as any })).toThrow(/STREAM_MODE must be one of 'irreversible', 'head'/);
        expect(() => createConfig({ errorPolicy: 'ignore' as any })).toThrow(/ERROR_POLICY/);
        expect(() => createConfig({ checkpointMode: 'never' as any })).toThrow(/CHECKPOINT_MODE/);
    });

    test('reports every problem at once', () => {
        try {
            createConfig({ blockCheckInterval: 0, apiNodes: [], jsonId: '' });
            throw new Error('expected validation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigValidationError);
            expect((error as ConfigValidationError).problems).toHaveLength(3);
        }
    });

    test('the Streamer constructor fails fast on bad config', () => {
        expect(() => new Streamer({ apiNodes: [] })).toThrow(ConfigValidationError);
    });

    test('setConfig validates too and leaves the previous config intact', () => {
        const streamer = new Streamer({ blockCheckInterval: 500 });

        expect(() => streamer.setConfig({ blockCheckInterval: -1 })).toThrow(ConfigValidationError);
        expect(streamer.getConfig().BLOCK_CHECK_INTERVAL).toBe(500);
    });
});
