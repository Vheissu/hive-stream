import { HiveProvider } from '../../src/providers/hive-provider';

jest.mock('@hiveio/dhive', () => {
    const mockGetDynamicGlobalProperties = jest.fn().mockResolvedValue({
        head_block_number: 12345,
        time: '2024-01-01T00:00:00',
    });
    const mockGetBlock = jest.fn().mockResolvedValue({
        block_id: 'abc123',
        previous: 'abc122',
        timestamp: '2024-01-01T00:00:00',
        transactions: [],
        transaction_ids: [],
    });

    return {
        Client: jest.fn().mockImplementation(() => ({
            database: {
                getDynamicGlobalProperties: mockGetDynamicGlobalProperties,
                getBlock: mockGetBlock,
            },
        })),
    };
});

describe('HiveProvider', () => {
    let provider: HiveProvider;

    beforeEach(() => {
        provider = new HiveProvider({ apiNodes: ['https://api.hive.blog'] });
    });

    test('delegates getDynamicGlobalProperties to dhive', async () => {
        const props = await provider.getDynamicGlobalProperties();

        expect(props.head_block_number).toBe(12345);
        expect(props.time).toBe('2024-01-01T00:00:00');
    });

    test('delegates getBlock to dhive', async () => {
        const block = await provider.getBlock(12345);

        expect(block).not.toBeNull();
        expect(block!.block_id).toBe('abc123');
        expect(block!.previous).toBe('abc122');
    });

    test('updateClient replaces internal client', async () => {
        const { Client } = require('@hiveio/dhive');

        provider.updateClient(['https://rpc.ausbit.dev']);

        expect(Client).toHaveBeenCalledWith(['https://rpc.ausbit.dev']);
    });

    test('getClient exposes dhive Client', () => {
        const client = provider.getClient();

        expect(client).toBeDefined();
        expect(client.database).toBeDefined();
        expect(typeof client.database.getDynamicGlobalProperties).toBe('function');
    });
});
