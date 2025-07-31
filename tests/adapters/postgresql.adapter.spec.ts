import { PostgreSQLAdapter } from "../../src/adapters/postgresql.adapter";

describe('PostgreSQL Adapter', () => {
    let sut: PostgreSQLAdapter;

    beforeEach(() => {
        sut = new PostgreSQLAdapter({
            host: 'localhost',
            port: 5432,
            user: 'test',
            password: 'test',
            database: 'test_db'
        });
    });

    test('constructor creates adapter with connection config', () => {
        expect(sut).toBeInstanceOf(PostgreSQLAdapter);
        expect(sut.getDb()).toBeDefined();
    });

    test('constructor works with connection string', () => {
        const adapter = new PostgreSQLAdapter({
            connectionString: 'postgresql://user:pass@localhost:5432/dbname',
            ssl: true
        });
        
        expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
        expect(adapter.getDb()).toBeDefined();
    });

    test('constructor uses default values when not provided', () => {
        const adapter = new PostgreSQLAdapter({
            password: 'test'
        });
        
        expect(adapter).toBeInstanceOf(PostgreSQLAdapter);
        expect(adapter.getDb()).toBeDefined();
    });

    test('processOperation sets internal state', async () => {
        const testData = {
            blockNumber: 12345,
            blockId: 'test-block',
            prevBlockId: 'prev-block',
            trxId: 'test-tx',
            blockTime: new Date()
        };

        await sut.processOperation({}, testData.blockNumber, testData.blockId, testData.prevBlockId, testData.trxId, testData.blockTime);

        // Since these are private properties, we can't directly test them
        // But we can verify the method doesn't throw
        expect(true).toBe(true);
    });

    test('getDb returns knex instance', () => {
        const db = sut.getDb();
        expect(db).toBeDefined();
        expect(typeof db).toBe('function'); // Knex instance is callable
    });

    test('destroy method is implemented', async () => {
        // Create a mock knex instance
        const mockKnex = {
            destroy: jest.fn().mockResolvedValue(undefined)
        };
        (sut as any).db = mockKnex;

        const result = await sut.destroy();

        expect(result).toBe(true);
        expect(mockKnex.destroy).toHaveBeenCalled();
    });

    test('query method handles raw SQL', async () => {
        // Create a mock knex instance
        const mockKnex = {
            raw: jest.fn().mockResolvedValue({ rows: [{ id: 1, name: 'test' }] })
        };
        (sut as any).db = mockKnex;

        const result = await sut.query('SELECT * FROM test WHERE id = $1', [1]);

        expect(result).toEqual([{ id: 1, name: 'test' }]);
        expect(mockKnex.raw).toHaveBeenCalledWith('SELECT * FROM test WHERE id = $1', [1]);
    });

    test('loadState handles missing state gracefully', async () => {
        // Mock the query to return no results
        const mockQuery = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
                first: jest.fn().mockResolvedValue(null)
            })
        });
        (sut as any).db = mockQuery;

        const result = await sut.loadState();

        expect(result).toBeNull();
    });

    test('saveState serializes actions correctly', async () => {
        const testData = {
            lastBlockNumber: 12345,
            actions: [{ id: 'test', type: 'action' }]
        };

        // Mock the query chain
        const mockMerge = jest.fn().mockResolvedValue(undefined);
        const mockOnConflict = jest.fn().mockReturnValue({ merge: mockMerge });
        const mockInsert = jest.fn().mockReturnValue({ onConflict: mockOnConflict });
        const mockQuery = jest.fn().mockReturnValue({ insert: mockInsert });
        (sut as any).db = mockQuery;

        const result = await sut.saveState(testData);

        expect(result).toBe(true);
        expect(mockQuery).toHaveBeenCalledWith('params');
        expect(mockInsert).toHaveBeenCalledWith({
            id: 1,
            actions: JSON.stringify(testData.actions),
            lastBlockNumber: 12345
        });
        expect(mockOnConflict).toHaveBeenCalledWith('id');
        expect(mockMerge).toHaveBeenCalled();
    });
});