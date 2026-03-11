import { HafClient } from '../../src/providers/haf-client';

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

describe('HafClient', () => {
    let client: HafClient;

    beforeEach(async () => {
        jest.clearAllMocks();
        client = new HafClient();
    });

    describe('connect() / disconnect()', () => {
        test('connect establishes pg connection and sets timeout', async () => {
            await client.connect();

            expect(mockConnect).toHaveBeenCalled();
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('statement_timeout'));
        });

        test('disconnect ends pg connection', async () => {
            await client.connect();
            await client.disconnect();

            expect(mockEnd).toHaveBeenCalled();
        });

        test('disconnect is safe to call when not connected', async () => {
            await client.disconnect();

            expect(mockEnd).not.toHaveBeenCalled();
        });
    });

    describe('query()', () => {
        test('passes parameterized SQL correctly', async () => {
            await client.connect();

            mockQuery.mockResolvedValueOnce({
                rows: [{ count: 42 }],
            });

            const result = await client.query('SELECT count(*) FROM table WHERE id = $1', [5]);

            expect(mockQuery).toHaveBeenCalledWith('SELECT count(*) FROM table WHERE id = $1', [5]);
            expect(result).toEqual([{ count: 42 }]);
        });
    });

    describe('getTransfers()', () => {
        test('builds correct query with all options', async () => {
            await client.connect();
            mockQuery.mockResolvedValueOnce({ rows: [] });

            await client.getTransfers({
                accounts: ['alice', 'bob'],
                fromDate: '2024-01-01',
                toDate: '2024-06-01',
                symbol: 'HIVE',
            });

            const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
            const sql = lastCall[0] as string;
            const params = lastCall[1] as any[];

            expect(sql).toContain('hafsql.operation_transfer_table');
            expect(sql).toContain('from_account');
            expect(sql).toContain('to_account');
            expect(sql).toContain('ANY($1)');
            expect(sql).toContain('t.symbol = $4');
            expect(params[0]).toEqual(['alice', 'bob']);
            expect(params[3]).toBe('HIVE');
        });

        test('works with accounts only', async () => {
            await client.connect();
            mockQuery.mockResolvedValueOnce({ rows: [] });

            await client.getTransfers({ accounts: ['alice'] });

            const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
            const sql = lastCall[0] as string;
            const params = lastCall[1] as any[];

            expect(sql).toContain('ANY($1)');
            expect(params).toEqual([['alice']]);
        });
    });

    describe('getAccountBalances()', () => {
        test('builds correct query', async () => {
            await client.connect();
            mockQuery.mockResolvedValueOnce({
                rows: [{ account: 'alice', nai: '@@000000021', balance: '1000.000' }],
            });

            const result = await client.getAccountBalances(['alice']);

            const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
            const sql = lastCall[0] as string;

            expect(sql).toContain('hafbe_bal.current_account_balances');
            expect(sql).toContain('hafsql.accounts');
            expect(result).toEqual([{ account: 'alice', nai: '@@000000021', balance: '1000.000' }]);
        });
    });

    describe('getBlockAtTime()', () => {
        test('returns block number for timestamp', async () => {
            await client.connect();
            mockQuery.mockResolvedValueOnce({ rows: [{ num: 80000000 }] });

            const blockNum = await client.getBlockAtTime('2024-01-01T00:00:00');

            expect(blockNum).toBe(80000000);
        });

        test('returns null when no block found', async () => {
            await client.connect();
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const blockNum = await client.getBlockAtTime('1970-01-01T00:00:00');

            expect(blockNum).toBeNull();
        });
    });

    describe('getBlockTimestamp()', () => {
        test('returns timestamp for block number', async () => {
            await client.connect();
            mockQuery.mockResolvedValueOnce({ rows: [{ created_at: '2024-06-01T12:00:00' }] });

            const ts = await client.getBlockTimestamp(80000000);

            expect(ts).toBe('2024-06-01T12:00:00');
        });

        test('returns null for non-existent block', async () => {
            await client.connect();
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const ts = await client.getBlockTimestamp(999999999);

            expect(ts).toBeNull();
        });
    });

    describe('getProposalPayouts()', () => {
        test('builds correct query with proposal IDs', async () => {
            await client.connect();
            mockQuery.mockResolvedValueOnce({ rows: [] });

            await client.getProposalPayouts([1, 2, 3]);

            const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
            const sql = lastCall[0] as string;
            const params = lastCall[1] as any[];

            expect(sql).toContain('hafsql.operation_proposal_pay_table');
            expect(sql).toContain('pp.proposal_id');
            expect(sql).toContain('pp.receiver');
            expect(sql).toContain('pp.payment');
            expect(sql).toContain('ANY($1)');
            expect(params).toEqual([[1, 2, 3]]);
        });
    });
});
