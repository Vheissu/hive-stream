/**
 * MongoDB adapter unit tests with mocked MongoClient.
 * These tests verify adapter logic without requiring a running MongoDB instance.
 */

// Mock mongodb before import
const mockCollection = {
    find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
        }),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'id-1' }),
    replaceOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
};

const mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection),
};

const mockMongoClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    db: jest.fn().mockReturnValue(mockDb),
};

jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => mockMongoClient),
    Db: jest.fn(),
}));

import { MongodbAdapter } from '../../src/adapters/mongodb.adapter';

describe('MongodbAdapter', () => {
    let adapter: MongodbAdapter;

    beforeEach(() => {
        jest.clearAllMocks();
        adapter = new MongodbAdapter('mongodb://localhost:27017', 'testdb');
    });

    describe('constructor', () => {
        test('capabilities.sql is false', () => {
            expect(adapter.capabilities.sql).toBe(false);
        });
    });

    describe('create()', () => {
        test('connects to MongoDB', async () => {
            const result = await adapter.create();
            expect(result).toBe(true);
            expect(mockMongoClient.connect).toHaveBeenCalled();
            expect(mockMongoClient.db).toHaveBeenCalledWith('testdb');
        });
    });

    describe('getDbInstance()', () => {
        test('returns db instance', async () => {
            const db = await adapter.getDbInstance();
            expect(db).toBe(mockDb);
        });

        test('reuses existing connection', async () => {
            await adapter.getDbInstance();
            await adapter.getDbInstance();
            // connect called only once because db is cached
            expect(mockMongoClient.connect).toHaveBeenCalledTimes(1);
        });
    });

    describe('destroy()', () => {
        test('closes client connection', async () => {
            await adapter.create();
            const result = await adapter.destroy();
            expect(result).toBe(true);
            expect(mockMongoClient.close).toHaveBeenCalled();
        });
    });

    describe('loadState()', () => {
        test('loads state from params collection', async () => {
            mockCollection.findOne.mockResolvedValueOnce({ lastBlockNumber: 500 });
            await adapter.create();
            const state = await adapter.loadState();
            expect(state).toEqual({ lastBlockNumber: 500 });
            expect(mockDb.collection).toHaveBeenCalledWith('params');
        });

        test('returns null when no state exists', async () => {
            mockCollection.findOne.mockResolvedValueOnce(null);
            await adapter.create();
            const state = await adapter.loadState();
            expect(state).toBeNull();
        });
    });

    describe('saveState()', () => {
        test('saves state with upsert', async () => {
            await adapter.create();
            const result = await adapter.saveState({ lastBlockNumber: 100, actions: [] });

            expect(result).toBe(true);
            expect(mockCollection.replaceOne).toHaveBeenCalledWith(
                {},
                { lastBlockNumber: 100, actions: [] },
                { upsert: true }
            );
        });

        test('defaults actions to empty array', async () => {
            await adapter.create();
            await adapter.saveState({ lastBlockNumber: 100 });

            const savedData = mockCollection.replaceOne.mock.calls[0][1];
            expect(savedData.actions).toEqual([]);
        });
    });

    describe('processOperation()', () => {
        test('stores block context', async () => {
            await adapter.create();
            await adapter.processOperation(['transfer', {}], 42, 'block-42', 'block-41', 'trx-1', new Date());
            // Context is stored internally, verified through processTransfer
        });
    });

    describe('processTransfer()', () => {
        test('inserts transfer into transfers collection', async () => {
            await adapter.create();
            await adapter.processOperation(['transfer', {}], 10, 'b-10', 'b-9', 'trx-t1', new Date());

            const result = await adapter.processTransfer(
                {},
                { contract: 'token', action: 'transfer', payload: { amount: '1' } },
                { sender: 'alice', amount: '1.000 HIVE' } as any
            );

            expect(result).toBe(true);
            expect(mockDb.collection).toHaveBeenCalledWith('transfers');
            expect(mockCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
                sender: 'alice',
                amount: '1.000 HIVE',
                contractName: 'token',
                contractAction: 'transfer',
                blockNumber: 10,
                blockId: 'b-10',
            }));
        });

        test('metadata overrides context values', async () => {
            await adapter.create();
            await adapter.processOperation(['transfer', {}], 10, 'b-10', 'b-9', 'trx-ctx', new Date());

            await adapter.processTransfer(
                {},
                { contract: 'c', action: 'a', payload: {} },
                { sender: 'alice', amount: '1 HIVE', transactionId: 'trx-override', blockId: 'b-override', blockNumber: 99 } as any
            );

            expect(mockCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
                id: 'trx-override',
                blockId: 'b-override',
                blockNumber: 99,
            }));
        });
    });

    describe('processCustomJson()', () => {
        test('inserts custom JSON into customJson collection', async () => {
            await adapter.create();
            await adapter.processOperation(['custom_json', {}], 20, 'b-20', 'b-19', 'trx-j1', new Date());

            const result = await adapter.processCustomJson(
                {},
                { contract: 'nft', action: 'mint', payload: {} },
                { sender: 'bob', isSignedWithActiveKey: true } as any
            );

            expect(result).toBe(true);
            expect(mockDb.collection).toHaveBeenCalledWith('customJson');
            expect(mockCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({
                sender: 'bob',
                isSignedWithActiveKey: true,
                contractName: 'nft',
                contractAction: 'mint',
                blockNumber: 20,
            }));
        });
    });

    describe('find()', () => {
        test('queries collection and returns documents', async () => {
            const docs = [{ a: 1 }, { a: 2 }];
            mockCollection.find.mockReturnValueOnce({
                toArray: jest.fn().mockResolvedValue(docs),
            });
            await adapter.create();

            const result = await adapter.find('myTable', { key: 'val' });
            expect(result).toEqual(docs);
            expect(mockDb.collection).toHaveBeenCalledWith('myTable');
            expect(mockCollection.find).toHaveBeenCalledWith({ key: 'val' });
        });

        test('returns empty array for no results', async () => {
            mockCollection.find.mockReturnValueOnce({
                toArray: jest.fn().mockResolvedValue([]),
            });
            await adapter.create();

            const result = await adapter.find('table', {});
            expect(result).toEqual([]);
        });
    });

    describe('findOne()', () => {
        test('queries and returns single document', async () => {
            mockCollection.findOne.mockResolvedValueOnce({ id: '1', name: 'test' });
            await adapter.create();

            const result = await adapter.findOne('table', { id: '1' });
            expect(result).toEqual({ id: '1', name: 'test' });
        });

        test('returns null when not found', async () => {
            mockCollection.findOne.mockResolvedValueOnce(null);
            await adapter.create();

            const result = await adapter.findOne('table', { id: 'nonexistent' });
            expect(result).toBeNull();
        });
    });

    describe('insert()', () => {
        test('inserts document into collection', async () => {
            await adapter.create();
            const result = await adapter.insert('items', { name: 'test' });
            expect(result).toBe(true);
            expect(mockDb.collection).toHaveBeenCalledWith('items');
            expect(mockCollection.insertOne).toHaveBeenCalledWith({ name: 'test' });
        });
    });

    describe('replace()', () => {
        test('replaces document with upsert', async () => {
            await adapter.create();
            const data = { name: 'updated' };
            const result = await adapter.replace('items', { name: 'old' }, data);
            expect(result).toBe(data);
            expect(mockCollection.replaceOne).toHaveBeenCalledWith(
                { name: 'old' },
                data,
                { upsert: true }
            );
        });
    });

    describe('query()', () => {
        test('throws unsupported error', async () => {
            await adapter.create();
            await expect(adapter.query('SELECT 1')).rejects.toThrow('not supported in MongoDB');
        });
    });

    describe('addEvent()', () => {
        test('inserts event into events collection', async () => {
            await adapter.create();
            const result = await adapter.addEvent('2024-06-01', 'token', 'create', {} as any, { data: 'test' });
            expect(result).toBe(true);
            expect(mockDb.collection).toHaveBeenCalledWith('events');
            expect(mockCollection.insertOne).toHaveBeenCalledWith({
                date: '2024-06-01',
                contract: 'token',
                action: 'create',
                payload: {},
                data: { data: 'test' },
            });
        });
    });

    describe('getEvents()', () => {
        test('returns sorted events', async () => {
            const events = [{ contract: 'a' }, { contract: 'b' }];
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue(events),
                }),
            });
            await adapter.create();

            const result = await adapter.getEvents();
            expect(result).toEqual(events);
        });

        test('returns empty array for no events', async () => {
            await adapter.create();
            const result = await adapter.getEvents();
            expect(result).toEqual([]);
        });
    });

    describe('getEventsByContract()', () => {
        test('queries events by contract', async () => {
            const events = [{ contract: 'token' }];
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue(events),
                }),
            });
            await adapter.create();

            const result = await adapter.getEventsByContract('token');
            expect(result).toEqual(events);
            expect(mockCollection.find).toHaveBeenCalledWith({ contract: 'token' });
        });
    });

    describe('getEventsByAccount()', () => {
        test('queries events by account with $or', async () => {
            const events = [{ data: { sender: 'alice' } }];
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue(events),
                }),
            });
            await adapter.create();

            const result = await adapter.getEventsByAccount('alice');
            expect(result).toEqual(events);
            expect(mockCollection.find).toHaveBeenCalledWith({
                $or: [
                    { 'data.sender': 'alice' },
                    { 'data.account': 'alice' },
                    { 'payload.sender': 'alice' },
                    { 'payload.account': 'alice' },
                ],
            });
        });
    });

    describe('getTransfers()', () => {
        test('returns sorted transfers', async () => {
            const transfers = [{ sender: 'alice' }];
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue(transfers),
                }),
            });
            await adapter.create();

            const result = await adapter.getTransfers();
            expect(result).toEqual(transfers);
            expect(mockDb.collection).toHaveBeenCalledWith('transfers');
        });

        test('returns empty array for no transfers', async () => {
            await adapter.create();
            const result = await adapter.getTransfers();
            expect(result).toEqual([]);
        });
    });

    describe('getTransfersByContract()', () => {
        test('queries transfers by contractName', async () => {
            const transfers = [{ contractName: 'token' }];
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue(transfers),
                }),
            });
            await adapter.create();

            await adapter.getTransfersByContract('token');
            expect(mockCollection.find).toHaveBeenCalledWith({ contractName: 'token' });
        });
    });

    describe('getTransfersByAccount()', () => {
        test('queries transfers by sender', async () => {
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([{ sender: 'alice' }]),
                }),
            });
            await adapter.create();

            await adapter.getTransfersByAccount('alice');
            expect(mockCollection.find).toHaveBeenCalledWith({ sender: 'alice' });
        });
    });

    describe('getTransfersByBlockid()', () => {
        test('queries transfers by blockId', async () => {
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([{ blockId: 'b-1' }]),
                }),
            });
            await adapter.create();

            await adapter.getTransfersByBlockid('b-1');
            expect(mockCollection.find).toHaveBeenCalledWith({ blockId: 'b-1' });
        });
    });

    describe('getJson()', () => {
        test('returns custom json entries', async () => {
            const jsons = [{ contractName: 'nft' }];
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue(jsons),
                }),
            });
            await adapter.create();

            const result = await adapter.getJson();
            expect(result).toEqual(jsons);
            expect(mockDb.collection).toHaveBeenCalledWith('customJson');
        });
    });

    describe('getJsonByContract()', () => {
        test('queries custom json by contractName', async () => {
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([{ contractName: 'nft' }]),
                }),
            });
            await adapter.create();

            await adapter.getJsonByContract('nft');
            expect(mockCollection.find).toHaveBeenCalledWith({ contractName: 'nft' });
        });
    });

    describe('getJsonByAccount()', () => {
        test('queries custom json by sender', async () => {
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([{ sender: 'alice' }]),
                }),
            });
            await adapter.create();

            await adapter.getJsonByAccount('alice');
            expect(mockCollection.find).toHaveBeenCalledWith({ sender: 'alice' });
        });
    });

    describe('getJsonByBlockid()', () => {
        test('queries custom json by blockId', async () => {
            mockCollection.find.mockReturnValueOnce({
                sort: jest.fn().mockReturnValue({
                    toArray: jest.fn().mockResolvedValue([{ blockId: 'b-1' }]),
                }),
            });
            await adapter.create();

            await adapter.getJsonByBlockid('b-1');
            expect(mockCollection.find).toHaveBeenCalledWith({ blockId: 'b-1' });
        });
    });

    describe('loadActions()', () => {
        test('returns empty array when no state', async () => {
            mockCollection.findOne.mockResolvedValue(null);
            await adapter.create();
            const actions = await adapter.loadActions();
            expect(actions).toEqual([]);
        });

        test('returns empty array when state has no actions', async () => {
            mockCollection.findOne.mockResolvedValueOnce({ lastBlockNumber: 1 });
            await adapter.create();
            const actions = await adapter.loadActions();
            expect(actions).toEqual([]);
        });
    });
});
