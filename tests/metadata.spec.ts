import { TimeAction } from '../src/actions';
import { Config } from '../src/config';
import { HIVE_STREAM_METADATA, getHiveStreamMetadata } from '../src/metadata';

describe('metadata exports', () => {
    test('returns a stable frozen metadata object', () => {
        const meta = getHiveStreamMetadata();

        expect(meta).toBe(HIVE_STREAM_METADATA);
        expect(Object.isFrozen(meta)).toBe(true);
        expect(Object.isFrozen(meta.config)).toBe(true);
        expect(Object.isFrozen(meta.subscriptions)).toBe(true);
        expect(Object.isFrozen(meta.writeOperations)).toBe(true);
    });

    test('includes config defaults aligned with Config source', () => {
        const map = new Map(HIVE_STREAM_METADATA.config.options.map((option) => [option.key, option.defaultValue]));
        const builderMap = new Map(HIVE_STREAM_METADATA.config.options.map((option) => [option.key, option.builderKey]));

        expect(map.get('JSON_ID')).toBe(Config.JSON_ID);
        expect(map.get('PAYLOAD_IDENTIFIER')).toBe(Config.PAYLOAD_IDENTIFIER);
        expect(map.get('HIVE_ENGINE_ID')).toBe(Config.HIVE_ENGINE_ID);
        expect(map.get('BLOCK_CHECK_INTERVAL')).toBe(Config.BLOCK_CHECK_INTERVAL);
        expect(map.get('API_ENABLED')).toBe(Config.API_ENABLED);
        expect(map.get('API_PORT')).toBe(Config.API_PORT);
        expect(builderMap.get('JSON_ID')).toBe('jsonId');
        expect(builderMap.get('PAYLOAD_IDENTIFIER')).toBe('payloadIdentifier');
        expect(builderMap.get('BLOCK_CHECK_INTERVAL')).toBe('blockCheckInterval');
        expect(builderMap.get('API_ENABLED')).toBe('apiEnabled');
        expect(builderMap.get('API_PORT')).toBe('apiPort');
    });

    test('includes expected subscription metadata', () => {
        const transfer = HIVE_STREAM_METADATA.subscriptions.find((item) => item.method === 'onTransfer');
        const customJsonId = HIVE_STREAM_METADATA.subscriptions.find((item) => item.method === 'onCustomJsonId');

        expect(transfer).toBeDefined();
        expect(transfer?.accountFilterBuiltIn).toBe(true);

        expect(customJsonId).toBeDefined();
        expect(customJsonId?.idFilterBuiltIn).toBe(true);
    });

    test('exposes valid time action values from TimeAction source', () => {
        expect(HIVE_STREAM_METADATA.timeAction.validValues).toEqual(TimeAction.getValidTimeValues());
    });

    test('lists contract triggers and supported operations', () => {
        expect(HIVE_STREAM_METADATA.contracts.payload.supportedTriggers).toEqual([
            'custom_json',
            'transfer',
            'time',
            'escrow_transfer',
            'escrow_approve',
            'escrow_dispute',
            'escrow_release',
            'recurrent_transfer'
        ]);

        expect(HIVE_STREAM_METADATA.contracts.payload.supportedOperations).toEqual([
            'transfer',
            'custom_json',
            'escrow_transfer',
            'recurrent_transfer'
        ]);
    });
});
