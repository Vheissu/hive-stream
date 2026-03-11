import { HafProvider, HAF_OP_TYPES } from '../../src/providers/haf-provider';

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockEnd = jest.fn().mockResolvedValue(undefined);

jest.mock('pg', () => ({
    Client: jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        query: mockQuery,
        end: mockEnd,
    })),
}));

describe('HafProvider', () => {
    let provider: HafProvider;

    beforeEach(() => {
        jest.clearAllMocks();
        provider = new HafProvider();
    });

    describe('create()', () => {
        test('connects with default HafSQL config', async () => {
            const { Client: PgClient } = require('pg');

            await provider.create();

            expect(PgClient).toHaveBeenCalledWith(expect.objectContaining({
                host: 'hafsql-sql.mahdiyari.info',
                port: 5432,
                user: 'hafsql_public',
                password: 'hafsql_public',
                database: 'haf_block_log',
            }));
            expect(mockConnect).toHaveBeenCalled();
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('statement_timeout'));
        });

        test('applies custom connection params', async () => {
            const { Client: PgClient } = require('pg');
            jest.clearAllMocks();

            const custom = new HafProvider({
                host: 'localhost',
                port: 5433,
                user: 'myuser',
                password: 'mypass',
                database: 'mydb',
            });

            await custom.create();

            expect(PgClient).toHaveBeenCalledWith(expect.objectContaining({
                host: 'localhost',
                port: 5433,
                user: 'myuser',
                password: 'mypass',
                database: 'mydb',
            }));
        });

        test('creates HAF context when useHafContext is true', async () => {
            jest.clearAllMocks();

            const hafProvider = new HafProvider({
                useHafContext: true,
                hafAppName: 'test_app',
            });

            await hafProvider.create();

            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT hive.app_create_context($1)',
                ['test_app']
            );
        });
    });

    describe('getDynamicGlobalProperties()', () => {
        test('queries blocks_view and returns head_block_number and time', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] }); // statement_timeout
            await provider.create();

            mockQuery.mockResolvedValueOnce({
                rows: [{ head_block_number: 90000000, time: '2024-06-01T12:00:00' }],
            });

            const props = await provider.getDynamicGlobalProperties();

            expect(props.head_block_number).toBe(90000000);
            expect(props.time).toBe('2024-06-01T12:00:00');
        });

        test('throws when no blocks found', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] }); // statement_timeout
            await provider.create();

            mockQuery.mockResolvedValueOnce({ rows: [] });

            await expect(provider.getDynamicGlobalProperties()).rejects.toThrow('No blocks found');
        });
    });

    describe('getBlock()', () => {
        beforeEach(async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] }); // statement_timeout
            await provider.create();
        });

        test('reconstructs BlockData from operations_view rows', async () => {
            // Block metadata (uses encode(hash/prev, 'hex') in real query)
            mockQuery.mockResolvedValueOnce({
                rows: [{ num: 100, hash: 'block-hash-100', prev: 'block-hash-99', created_at: '2024-01-01T00:00:00' }],
            });
            // Operations (no trx_hash column in operations_view)
            mockQuery.mockResolvedValueOnce({
                rows: [
                    { op_type_id: 2, body: { value: { from: 'alice', to: 'bob', amount: '1.000 HIVE' } }, trx_in_block: 0, op_pos: 0 },
                    { op_type_id: 18, body: { value: { id: 'test', json: '{}' } }, trx_in_block: 0, op_pos: 1 },
                    { op_type_id: 2, body: { value: { from: 'charlie', to: 'dave', amount: '2.000 HIVE' } }, trx_in_block: 1, op_pos: 0 },
                ],
            });
            // Transaction hashes from transactions_view
            mockQuery.mockResolvedValueOnce({
                rows: [
                    { trx_in_block: 0, trx_hash: 'trx-1' },
                    { trx_in_block: 1, trx_hash: 'trx-2' },
                ],
            });

            const block = await provider.getBlock(100);

            expect(block).not.toBeNull();
            expect(block!.block_id).toBe('block-hash-100');
            expect(block!.previous).toBe('block-hash-99');
            expect(block!.timestamp).toBe('2024-01-01T00:00:00');
            expect(block!.transactions).toHaveLength(2);
            expect(block!.transaction_ids).toEqual(['trx-1', 'trx-2']);

            // First transaction has 2 operations
            expect(block!.transactions[0].operations).toHaveLength(2);
            expect(block!.transactions[0].operations[0][0]).toBe('transfer');
            expect(block!.transactions[0].operations[1][0]).toBe('custom_json');

            // Second transaction has 1 operation
            expect(block!.transactions[1].operations).toHaveLength(1);
            expect(block!.transactions[1].operations[0][0]).toBe('transfer');
        });

        test('returns null for non-existent block', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const block = await provider.getBlock(999999999);

            expect(block).toBeNull();
        });
    });

    describe('destroy()', () => {
        test('disconnects pg client', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] }); // statement_timeout
            await provider.create();

            await provider.destroy();

            expect(mockEnd).toHaveBeenCalled();
        });

        test('removes HAF context when useHafContext is true', async () => {
            jest.clearAllMocks();
            const hafProvider = new HafProvider({
                useHafContext: true,
                hafAppName: 'test_app',
            });

            await hafProvider.create();
            jest.clearAllMocks();

            await hafProvider.destroy();

            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT hive.app_remove_context($1)',
                ['test_app']
            );
            expect(mockEnd).toHaveBeenCalled();
        });
    });

    describe('HAF_OP_TYPES', () => {
        test('maps known operation type IDs to names', () => {
            expect(HAF_OP_TYPES[2]).toBe('transfer');
            expect(HAF_OP_TYPES[18]).toBe('custom_json');
            expect(HAF_OP_TYPES[0]).toBe('vote');
            expect(HAF_OP_TYPES[1]).toBe('comment');
            expect(HAF_OP_TYPES[27]).toBe('escrow_transfer');
            expect(HAF_OP_TYPES[49]).toBe('recurrent_transfer');
        });
    });

    describe('amount normalization', () => {
        beforeEach(async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] }); // statement_timeout
            await provider.create();
        });

        test('converts HAF structured amount to dhive-style string', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: [{ num: 200, hash: 'aaa', prev: 'bbb', created_at: '2024-01-01T00:00:00' }],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{
                    op_type_id: 2,
                    body: {
                        value: {
                            from: 'alice',
                            to: 'bob',
                            memo: 'test',
                            amount: { nai: '@@000000021', amount: '100000', precision: 3 }
                        }
                    },
                    trx_in_block: 0,
                }],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{ trx_in_block: 0, trx_hash: 'trx-abc' }],
            });

            const block = await provider.getBlock(200);
            const transferOp = block!.transactions[0].operations[0];

            expect(transferOp[0]).toBe('transfer');
            expect(transferOp[1].amount).toBe('100.000 HBD');
            expect(transferOp[1].from).toBe('alice');
            expect(transferOp[1].to).toBe('bob');
        });

        test('converts HIVE amount correctly', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: [{ num: 201, hash: 'ccc', prev: 'ddd', created_at: '2024-01-01T00:00:00' }],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{
                    op_type_id: 2,
                    body: {
                        value: {
                            from: 'alice',
                            to: 'bob',
                            memo: '',
                            amount: { nai: '@@000000013', amount: '5000', precision: 3 }
                        }
                    },
                    trx_in_block: 0,
                }],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{ trx_in_block: 0, trx_hash: 'trx-def' }],
            });

            const block = await provider.getBlock(201);
            const transferOp = block!.transactions[0].operations[0];

            expect(transferOp[1].amount).toBe('5.000 HIVE');
        });

        test('converts VESTS amount correctly', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: [{ num: 202, hash: 'eee', prev: 'fff', created_at: '2024-01-01T00:00:00' }],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{
                    op_type_id: 4, // withdraw_vesting
                    body: {
                        value: {
                            account: 'alice',
                            vesting_shares: { nai: '@@000000037', amount: '1000000000', precision: 6 }
                        }
                    },
                    trx_in_block: 0,
                }],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{ trx_in_block: 0, trx_hash: 'trx-ghi' }],
            });

            const block = await provider.getBlock(202);
            const op = block!.transactions[0].operations[0];

            expect(op[0]).toBe('withdraw_vesting');
            expect(op[1].vesting_shares).toBe('1000.000000 VESTS');
        });

        test('leaves string amounts unchanged', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: [{ num: 203, hash: 'ggg', prev: 'hhh', created_at: '2024-01-01T00:00:00' }],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{
                    op_type_id: 2,
                    body: {
                        value: {
                            from: 'alice',
                            to: 'bob',
                            memo: '',
                            amount: '1.000 HIVE'
                        }
                    },
                    trx_in_block: 0,
                }],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{ trx_in_block: 0, trx_hash: 'trx-jkl' }],
            });

            const block = await provider.getBlock(203);
            const transferOp = block!.transactions[0].operations[0];

            expect(transferOp[1].amount).toBe('1.000 HIVE');
        });
    });

    describe('virtual ops filtering', () => {
        beforeEach(async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] }); // statement_timeout
            await provider.create();
        });

        test('filters out virtual ops (trx_in_block = -1)', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: [{ num: 300, hash: 'vvv', prev: 'www', created_at: '2024-01-01T00:00:00' }],
            });
            // The SQL WHERE clause filters trx_in_block >= 0,
            // so virtual ops should never appear in the result set
            mockQuery.mockResolvedValueOnce({
                rows: [
                    { op_type_id: 18, body: { value: { id: 'test', json: '{}', required_auths: [], required_posting_auths: ['alice'] } }, trx_in_block: 0 },
                ],
            });
            mockQuery.mockResolvedValueOnce({
                rows: [{ trx_in_block: 0, trx_hash: 'trx-real' }],
            });

            const block = await provider.getBlock(300);

            expect(block!.transactions).toHaveLength(1);
            expect(block!.transactions[0].operations[0][0]).toBe('custom_json');

            // Verify the SQL included the filter
            const opsCall = mockQuery.mock.calls.find((call: any[]) =>
                typeof call[0] === 'string' && call[0].includes('operations_view')
            );
            expect(opsCall?.[0]).toContain('trx_in_block >= 0');
        });
    });

    describe('reconnect after destroy', () => {
        test('create() works after destroy()', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] }); // statement_timeout
            await provider.create();
            await provider.destroy();

            // After destroy, create should build a fresh pg client
            mockQuery.mockResolvedValueOnce({ rows: [] }); // statement_timeout for new connection
            await provider.create();

            expect(mockConnect).toHaveBeenCalledTimes(2);
        });
    });
});
