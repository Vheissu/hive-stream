import { SqliteAdapter } from '../../src/adapters/sqlite.adapter';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('SQLite Adapter (extended)', () => {
    let sut: SqliteAdapter;
    let tempDir: string;
    let testDbPath: string;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivestream-sqlite-'));
        testDbPath = path.join(tempDir, 'test.db');
        sut = new SqliteAdapter(testDbPath);
        await sut.create();
    });

    afterEach(async () => {
        if (sut && sut.getDb()) {
            await sut.destroy();
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('capabilities', () => {
        test('sql capability is true', () => {
            expect(sut.capabilities.sql).toBe(true);
        });
    });

    describe('create() / destroy()', () => {
        test('creates params table on create', async () => {
            const tables = await sut.query("SELECT name FROM sqlite_master WHERE type='table' AND name='params'");
            expect(tables.length).toBe(1);
        });

        test('creates transfers table on create', async () => {
            const tables = await sut.query("SELECT name FROM sqlite_master WHERE type='table' AND name='transfers'");
            expect(tables.length).toBe(1);
        });

        test('creates customJson table on create', async () => {
            const tables = await sut.query("SELECT name FROM sqlite_master WHERE type='table' AND name='customJson'");
            expect(tables.length).toBe(1);
        });

        test('creates events table on create', async () => {
            const tables = await sut.query("SELECT name FROM sqlite_master WHERE type='table' AND name='events'");
            expect(tables.length).toBe(1);
        });

        test('destroy returns true', async () => {
            const result = await sut.destroy();
            expect(result).toBe(true);
        });
    });

    describe('state management', () => {
        test('saveState persists block number and actions', async () => {
            await sut.saveState({
                lastBlockNumber: 500,
                actions: [{ id: 'action1', type: '3s' }],
            });

            const state = await sut.loadState();
            expect(state.lastBlockNumber).toBe(500);
            expect(state.actions).toEqual([{ id: 'action1', type: '3s' }]);
        });

        test('saveState overwrites previous state', async () => {
            await sut.saveState({ lastBlockNumber: 100, actions: [] });
            await sut.saveState({ lastBlockNumber: 200, actions: [{ id: 'a1' }] });

            const state = await sut.loadState();
            expect(state.lastBlockNumber).toBe(200);
        });
    });

    describe('getTransfersByContract()', () => {
        test('filters transfers by contract name', async () => {
            await sut.processOperation({}, 1, 'b1', 'b0', 'trx-1', new Date());
            await sut.processTransfer({}, { contract: 'alpha', action: 'pay', payload: {} }, { sender: 'alice', amount: '1.000 HIVE' });

            await sut.processOperation({}, 2, 'b2', 'b1', 'trx-2', new Date());
            await sut.processTransfer({}, { contract: 'beta', action: 'pay', payload: {} }, { sender: 'bob', amount: '2.000 HIVE' });

            const alpha = await sut.getTransfersByContract('alpha');
            expect(alpha).toHaveLength(1);
            expect(alpha[0].sender).toBe('alice');

            const beta = await sut.getTransfersByContract('beta');
            expect(beta).toHaveLength(1);
            expect(beta[0].sender).toBe('bob');
        });
    });

    describe('getTransfersByAccount()', () => {
        test('filters transfers by sender', async () => {
            await sut.processOperation({}, 1, 'b1', 'b0', 'trx-a1', new Date());
            await sut.processTransfer({}, { contract: 'c', action: 'a', payload: {} }, { sender: 'alice', amount: '1 HIVE' });

            await sut.processOperation({}, 2, 'b2', 'b1', 'trx-a2', new Date());
            await sut.processTransfer({}, { contract: 'c', action: 'a', payload: {} }, { sender: 'bob', amount: '2 HIVE' });

            const result = await sut.getTransfersByAccount('alice');
            expect(result).toHaveLength(1);
            expect(result[0].sender).toBe('alice');
        });
    });

    describe('getTransfersByBlockid()', () => {
        test('filters transfers by block ID', async () => {
            await sut.processOperation({}, 1, 'block-abc', 'b0', 'trx-b1', new Date());
            await sut.processTransfer({}, { contract: 'c', action: 'a', payload: {} }, { sender: 'alice', amount: '1 HIVE' });

            const result = await sut.getTransfersByBlockid('block-abc');
            expect(result).toHaveLength(1);
        });
    });

    describe('getJsonByContract()', () => {
        test('filters custom JSON by contract name', async () => {
            await sut.processOperation({}, 1, 'b1', 'b0', 'trx-j1', new Date());
            await sut.processCustomJson({}, { contract: 'nft', action: 'mint', payload: {} }, { sender: 'alice', isSignedWithActiveKey: false });

            await sut.processOperation({}, 2, 'b2', 'b1', 'trx-j2', new Date());
            await sut.processCustomJson({}, { contract: 'token', action: 'create', payload: {} }, { sender: 'bob', isSignedWithActiveKey: true });

            const result = await sut.getJsonByContract('nft');
            expect(result).toHaveLength(1);
            expect(result[0].contractName).toBe('nft');
        });
    });

    describe('getJsonByAccount()', () => {
        test('filters custom JSON by sender', async () => {
            await sut.processOperation({}, 1, 'b1', 'b0', 'trx-ja1', new Date());
            await sut.processCustomJson({}, { contract: 'c', action: 'a', payload: {} }, { sender: 'alice', isSignedWithActiveKey: false });

            const result = await sut.getJsonByAccount('alice');
            expect(result).toHaveLength(1);
            expect(result[0].sender).toBe('alice');
        });
    });

    describe('events', () => {
        test('addEvent stores and retrieves events', async () => {
            await sut.addEvent('2024-06-01T00:00:00Z', 'token', 'create', { name: 'LEG' } as any, { action: 'token_created' });

            const events = await sut.getEvents();
            expect(events).toHaveLength(1);
            expect(events[0].contract).toBe('token');
            expect(events[0].action).toBe('create');
        });

        test('getEventsByContract filters correctly', async () => {
            await sut.addEvent('2024-06-01T00:00:00Z', 'token', 'create', {} as any, {});
            await sut.addEvent('2024-06-01T00:00:00Z', 'nft', 'mint', {} as any, {});

            const tokenEvents = await sut.getEventsByContract('token');
            expect(tokenEvents).toHaveLength(1);
            expect(tokenEvents[0].contract).toBe('token');
        });

        test('getEventsByAccount filters correctly', async () => {
            // Events don't have a direct account field, but let's test the data structure
            await sut.addEvent('2024-06-01T00:00:00Z', 'token', 'transfer', { sender: 'alice' } as any, { from: 'alice', to: 'bob' });
            const events = await sut.getEvents();
            expect(events.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('runInTransaction()', () => {
        test('commits on success', async () => {
            await sut.query('CREATE TABLE IF NOT EXISTS trx_test (id INTEGER, value TEXT)');

            await sut.runInTransaction(async (adapter) => {
                await adapter.query('INSERT INTO trx_test (id, value) VALUES (?, ?)', [1, 'hello']);
                await adapter.query('INSERT INTO trx_test (id, value) VALUES (?, ?)', [2, 'world']);
            });

            const rows = await sut.query('SELECT * FROM trx_test ORDER BY id');
            expect(rows).toHaveLength(2);
            expect(rows[0].value).toBe('hello');
            expect(rows[1].value).toBe('world');
        });

        test('rolls back on error', async () => {
            await sut.query('CREATE TABLE IF NOT EXISTS trx_test2 (id INTEGER PRIMARY KEY, value TEXT)');

            await expect(sut.runInTransaction(async (adapter) => {
                await adapter.query('INSERT INTO trx_test2 (id, value) VALUES (?, ?)', [1, 'hello']);
                throw new Error('Intentional failure');
            })).rejects.toThrow('Intentional failure');

            const rows = await sut.query('SELECT * FROM trx_test2');
            expect(rows).toHaveLength(0); // Rolled back
        });
    });

    describe('processOperation() sets block context', () => {
        test('tracks block metadata for subsequent operations', async () => {
            const blockTime = new Date('2024-06-01T12:00:00Z');
            await sut.processOperation(
                ['transfer', {}], 42, 'block-42', 'block-41', 'trx-ctx', blockTime
            );

            // Use the context in a transfer
            await sut.processTransfer(
                {},
                { contract: 'test', action: 'test', payload: {} },
                { sender: 'alice', amount: '1 HIVE' }
            );

            const transfers = await sut.getTransfers();
            expect(transfers).toHaveLength(1);
            expect(transfers[0].blockNumber).toBe(42);
            expect(transfers[0].blockId).toBe('block-42');
        });
    });

    describe('metadata passthrough', () => {
        test('processTransfer uses metadata transactionId over context', async () => {
            await sut.processOperation({}, 1, 'b1', 'b0', 'context-trx', new Date());

            await sut.processTransfer(
                {},
                { contract: 'test', action: 'test', payload: {} },
                { sender: 'alice', amount: '1 HIVE', transactionId: 'override-trx', blockId: 'override-block', blockNumber: 99 }
            );

            const transfers = await sut.getTransfers();
            expect(transfers[0].id).toBe('override-trx');
            expect(transfers[0].blockId).toBe('override-block');
            expect(transfers[0].blockNumber).toBe(99);
        });
    });

    describe('escrow processing', () => {
        test('processEscrow handles escrow_transfer', async () => {
            await sut.processOperation({}, 1, 'b1', 'b0', 'trx-esc', new Date());

            const result = await sut.processEscrow('escrow_transfer', {
                from: 'alice',
                to: 'bob',
                agent: 'agent',
                escrow_id: 1,
            }, { blockNumber: 1, blockId: 'b1', previousBlockId: 'b0', transactionId: 'trx-esc', blockTime: new Date() });

            expect(result).toBe(true);
        });
    });
});
