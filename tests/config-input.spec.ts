import { createConfig, normalizeConfigInput } from '../src/config';
import { Streamer } from '../src/streamer';

describe('Config input aliases', () => {
    test('maps camelCase keys to canonical config keys', () => {
        const normalized = normalizeConfigInput({
            activeKey: 'active',
            postingKey: 'posting',
            username: 'alice',
            jsonId: 'builder',
            payloadIdentifier: 'payload',
            blockCheckInterval: 1500,
            blocksBehindWarning: 30,
            resumeFromState: false,
            catchUpBatchSize: 10,
            catchUpDelayMs: 25,
            apiNodes: ['https://api.hive.blog'],
            apiEnabled: true,
            apiPort: 5050,
            debugMode: false
        });

        expect(normalized.ACTIVE_KEY).toBe('active');
        expect(normalized.POSTING_KEY).toBe('posting');
        expect(normalized.USERNAME).toBe('alice');
        expect(normalized.JSON_ID).toBe('builder');
        expect(normalized.PAYLOAD_IDENTIFIER).toBe('payload');
        expect(normalized.BLOCK_CHECK_INTERVAL).toBe(1500);
        expect(normalized.BLOCKS_BEHIND_WARNING).toBe(30);
        expect(normalized.RESUME_FROM_STATE).toBe(false);
        expect(normalized.CATCH_UP_BATCH_SIZE).toBe(10);
        expect(normalized.CATCH_UP_DELAY_MS).toBe(25);
        expect(normalized.API_NODES).toEqual(['https://api.hive.blog']);
        expect(normalized.API_ENABLED).toBe(true);
        expect(normalized.API_PORT).toBe(5050);
        expect(normalized.DEBUG_MODE).toBe(false);
    });

    test('canonical keys override camelCase aliases when both are supplied', () => {
        const normalized = normalizeConfigInput({
            JSON_ID: 'canonical-id',
            jsonId: 'alias-id'
        });

        expect(normalized.JSON_ID).toBe('canonical-id');
    });

    test('createConfig merges aliases with defaults', () => {
        const config = createConfig({
            jsonId: 'custom-json-id',
            apiEnabled: true,
            apiPort: 5050,
            debugMode: false
        });

        expect(config.JSON_ID).toBe('custom-json-id');
        expect(config.API_ENABLED).toBe(true);
        expect(config.API_PORT).toBe(5050);
        expect(config.DEBUG_MODE).toBe(false);
        expect(Array.isArray(config.API_NODES)).toBe(true);
    });

    test('Streamer constructor accepts camelCase config keys', async () => {
        const sut = new Streamer({
            username: 'builder-user',
            postingKey: 'posting-key',
            activeKey: 'active-key',
            jsonId: 'custom-id',
            apiEnabled: true,
            apiPort: 5050
        });

        expect(sut['config'].JSON_ID).toBe('custom-id');
        expect(sut['config'].API_ENABLED).toBe(true);
        expect(sut['config'].API_PORT).toBe(5050);
        expect(sut['username']).toBe('builder-user');
        expect(sut['postingKey']).toBe('posting-key');
        expect(sut['activeKey']).toBe('active-key');

        await sut.stop();
    });

    test('Streamer.setConfig accepts camelCase config keys', async () => {
        const sut = new Streamer();

        sut.setConfig({
            username: 'updated-user',
            postingKey: 'updated-posting',
            activeKey: 'updated-active',
            blockCheckInterval: 333,
            apiEnabled: true,
            apiPort: 5051,
            debugMode: false
        });

        expect(sut['config'].BLOCK_CHECK_INTERVAL).toBe(333);
        expect(sut['config'].API_ENABLED).toBe(true);
        expect(sut['config'].API_PORT).toBe(5051);
        expect(sut['config'].DEBUG_MODE).toBe(false);
        expect(sut['username']).toBe('updated-user');
        expect(sut['postingKey']).toBe('updated-posting');
        expect(sut['activeKey']).toBe('updated-active');

        await sut.stop();
    });

    test('blockProvider in ConfigInput is passed to Streamer', async () => {
        const mockProvider = {
            getDynamicGlobalProperties: jest.fn(),
            getBlock: jest.fn(),
        };

        const sut = new Streamer({ blockProvider: mockProvider as any });

        expect(sut.getBlockProvider()).toBe(mockProvider);
        await sut.stop();
    });

    test('blockProvider is not included in normalized config keys', () => {
        const normalized = normalizeConfigInput({
            jsonId: 'test',
            blockProvider: { getDynamicGlobalProperties: jest.fn(), getBlock: jest.fn() } as any,
        });

        // blockProvider should not appear in the normalized config
        // since it's extracted separately in the Streamer constructor
        expect((normalized as any).blockProvider).toBeUndefined();
    });
});
