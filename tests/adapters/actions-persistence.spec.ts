import { TimeAction } from '../../src/actions';
import { SqliteAdapter } from '../../src/adapters/sqlite.adapter';
import { MongodbAdapter } from '../../src/adapters/mongodb.adapter';
import fs from 'fs';
import path from 'path';

describe('Actions Persistence', () => {
    describe('SqliteAdapter', () => {
        let adapter: SqliteAdapter;
        let testDbPath: string;

        beforeEach(async () => {
            // Create unique database path for each test
            testDbPath = path.resolve(__dirname, `../../src/adapters/hive-stream-test-${Date.now()}-${Math.random()}.db`);
            
            // Clean up any existing test database
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath);
            }
            
            adapter = new SqliteAdapter(testDbPath);
            await adapter.create();
        });

        afterEach(async () => {
            if (adapter && adapter.getDb()) {
                await adapter.destroy();
            }
            
            // Clean up test database
            if (fs.existsSync(testDbPath)) {
                fs.unlinkSync(testDbPath);
            }
        });

        test('Should save and load actions correctly', async () => {
            const testActions = [
                new TimeAction('1m', 'action1', 'contract1', 'method1', { data: 'test1' }),
                new TimeAction('5m', 'action2', 'contract2', 'method2', { data: 'test2' }, new Date('2023-01-01'), false, 5, 10)
            ];
            
            // Serialize actions as they would be in the streamer
            const serializedActions = testActions.map(a => a.toJSON());
            
            const stateData = {
                lastBlockNumber: 12345,
                actions: serializedActions
            };
            
            await adapter.saveState(stateData);
            
            const loadedActions = await adapter.loadActions();
            
            expect(loadedActions).toHaveLength(2);
            
            const action1 = loadedActions.find(a => a.id === 'action1');
            const action2 = loadedActions.find(a => a.id === 'action2');
            
            expect(action1).toBeDefined();
            expect(action1?.timeValue).toBe('1m');
            expect(action1?.contractName).toBe('contract1');
            expect(action1?.contractMethod).toBe('method1');
            expect(action1?.payload).toEqual({ data: 'test1' });
            expect(action1?.enabled).toBe(true);
            expect(action1?.executionCount).toBe(0);
            
            expect(action2).toBeDefined();
            expect(action2?.timeValue).toBe('5m');
            expect(action2?.contractName).toBe('contract2');
            expect(action2?.contractMethod).toBe('method2');
            expect(action2?.payload).toEqual({ data: 'test2' });
            expect(action2?.enabled).toBe(false);
            expect(action2?.executionCount).toBe(5);
            expect(action2?.maxExecutions).toBe(10);
            expect(action2?.date).toEqual(new Date('2023-01-01'));
        });

        test('Should handle empty actions array', async () => {
            const stateData = {
                lastBlockNumber: 12345,
                actions: []
            };
            
            await adapter.saveState(stateData);
            const loadedActions = await adapter.loadActions();
            
            expect(loadedActions).toHaveLength(0);
            expect(Array.isArray(loadedActions)).toBe(true);
        });

        test('Should handle corrupted action data gracefully', async () => {
            const stateData = {
                lastBlockNumber: 12345,
                actions: [
                    { timeValue: '1m', id: 'valid-action', contractName: 'test', contractMethod: 'test' },
                    { invalid: 'data' }, // Invalid action
                    null, // Null action
                    'invalid string' // Invalid type
                ]
            };
            
            await adapter.saveState(stateData);
            const loadedActions = await adapter.loadActions();
            
            // Should only load the valid action
            expect(loadedActions).toHaveLength(1);
            expect(loadedActions[0].id).toBe('valid-action');
        });

        test('Should handle missing state gracefully', async () => {
            const loadedActions = await adapter.loadActions();
            
            expect(loadedActions).toHaveLength(0);
            expect(Array.isArray(loadedActions)).toBe(true);
        });
    });

    // Note: MongoDB tests would require a running MongoDB instance
    // For now, we'll test the serialization logic only
    describe('MongodbAdapter Serialization', () => {
        test('Should serialize actions data correctly for MongoDB', () => {
            const testActions = [
                new TimeAction('1m', 'action1', 'contract1', 'method1', { data: 'test1' }),
                new TimeAction('5m', 'action2', 'contract2', 'method2', { data: 'test2' })
            ];
            
            const serializedActions = testActions.map(a => a.toJSON());
            
            const stateData = {
                lastBlockNumber: 12345,
                actions: serializedActions
            };
            
            // Verify the data structure is valid for MongoDB
            expect(stateData.actions).toHaveLength(2);
            expect(stateData.actions[0]).toHaveProperty('timeValue');
            expect(stateData.actions[0]).toHaveProperty('id');
            expect(stateData.actions[0]).toHaveProperty('contractName');
            expect(stateData.actions[0]).toHaveProperty('contractMethod');
            expect(stateData.actions[0]).toHaveProperty('date');
            expect(typeof stateData.actions[0].date).toBe('string'); // Should be ISO string
        });
    });
});