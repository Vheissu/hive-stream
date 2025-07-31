import { SqliteAdapter } from "../../src/adapters/sqlite.adapter";
import fs from 'fs';
import path from 'path';

describe('SQLite Adapter', () => {
    let sut: SqliteAdapter;
    let testDbPath: string;

    beforeEach(async () => {
        testDbPath = path.resolve(__dirname, `../../src/adapters/hive-stream-test-basic-${Date.now()}-${Math.random()}.db`);
        
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        
        sut = new SqliteAdapter(testDbPath);
        await sut.create();
    });

    afterEach(async () => {
        if (sut && sut.getDb()) {
            await sut.destroy();
        }
        
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    test('find method returns values', async () => {
        // Create a test table
        await sut.db.schema.createTableIfNotExists('USERS', table => {
            table.integer('id');
            table.string('name');
        });
        
        // Insert test data
        await sut.db('USERS').insert({ id: 1, name: 'John' });
        
        const result = await sut.find('USERS', { id: 1, name: 'John' });

        expect(result).toEqual([{ id: 1, name: 'John' }]);
    });

    test('findOne method returns value', async () => {
        // Create a test table
        await sut.db.schema.createTableIfNotExists('USERS', table => {
            table.integer('id');
            table.string('name');
            table.string('email');
        });
        
        // Insert test data
        await sut.db('USERS').insert({ id: 1, name: 'John', email: 'john@hotmail.com' });
        
        const result = await sut.findOne('USERS', { id: 1, name: 'John', email: 'john@hotmail.com' });

        expect(result).toEqual({ id: 1, name: 'John', email: 'john@hotmail.com' });
    });

    test('replace method replaces value', async () => {
        // Create a test table
        await sut.db.schema.createTableIfNotExists('USERS', table => {
            table.integer('id').primary();
            table.string('name');
        });
        
        // Insert initial data
        await sut.db('USERS').insert({ id: 1, name: 'John' });
        
        const result = await sut.replace('USERS', { id: 1 }, { id: 1, name: 'Johnny' });

        expect(result).toEqual({ id: 1, name: 'Johnny' });
        
        // Verify the data was actually replaced
        const updatedRecord = await sut.db('USERS').where({ id: 1 }).first();
        expect(updatedRecord).toEqual({ id: 1, name: 'Johnny' });
    });

    test('insert method inserts values', async () => {
        // Create a test table
        await sut.db.schema.createTableIfNotExists('USERS', table => {
            table.integer('id');
            table.string('name');
        });
        
        const result = await sut.insert('USERS', { id: 1, name: 'Alice' });
        
        expect(result).toBe(true);
        
        // Verify the data was actually inserted
        const insertedRecord = await sut.db('USERS').where({ id: 1 }).first();
        expect(insertedRecord).toEqual({ id: 1, name: 'Alice' });
    });

    test('loadState and saveState work correctly', async () => {
        const testData = {
            lastBlockNumber: 12345,
            actions: [{ id: 'test-action', type: 'test' }]
        };
        
        // Save state
        const saveResult = await sut.saveState(testData);
        expect(saveResult).toBe(true);
        
        // Load state
        const loadedState = await sut.loadState();
        expect(loadedState?.lastBlockNumber).toBe(12345);
        expect(loadedState?.actions).toEqual([{ id: 'test-action', type: 'test' }]);
    });

    test('processTransfer works correctly', async () => {
        const mockPayload = {
            name: 'test-contract',
            action: 'transfer',
            payload: { amount: '100', recipient: 'bob' }
        };
        
        const mockMetadata = {
            sender: 'alice',
            amount: '100 HIVE'
        };
        
        // Set up transaction context
        await sut.processOperation({}, 12345, 'block123', 'prevblock', 'tx123', new Date());
        
        const result = await sut.processTransfer({}, mockPayload, mockMetadata);
        expect(result).toBe(true);
        
        // Verify the transfer was stored
        const transfers = await sut.getTransfers();
        expect(transfers).toHaveLength(1);
        expect(transfers[0].sender).toBe('alice');
        expect(transfers[0].contractName).toBe('test-contract');
    });

    test('processCustomJson works correctly', async () => {
        const mockPayload = {
            name: 'test-contract',
            action: 'custom',
            payload: { data: 'test' }
        };
        
        const mockMetadata = {
            sender: 'alice',
            isSignedWithActiveKey: true
        };
        
        // Set up transaction context
        await sut.processOperation({}, 12345, 'block123', 'prevblock', 'tx123', new Date());
        
        const result = await sut.processCustomJson({}, mockPayload, mockMetadata);
        expect(result).toBe(true);
        
        // Verify the custom JSON was stored
        const customJson = await sut.getJson();
        expect(customJson).toHaveLength(1);
        expect(customJson[0].sender).toBe('alice');
        expect(customJson[0].contractName).toBe('test-contract');
        expect(customJson[0].isSignedWithActiveKey).toBe(1);
    });

    test('query method executes raw SQL', async () => {
        // Create a test table
        await sut.db.schema.createTableIfNotExists('USERS', table => {
            table.integer('id');
            table.string('name');
        });
        
        // Insert test data
        await sut.db('USERS').insert({ id: 1, name: 'Alice' });
        await sut.db('USERS').insert({ id: 2, name: 'Bob' });
        
        // Test raw SQL query
        const result = await sut.query('SELECT * FROM USERS WHERE name = ?', ['Alice']);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Alice');
        expect(result[0].id).toBe(1);
    });
});