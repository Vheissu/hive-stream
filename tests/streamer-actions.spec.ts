import { TimeAction } from '../src/actions';
import { Streamer } from '../src/streamer';

describe('Streamer Time-based Actions', () => {
    let streamer: Streamer;
    let mockAdapter: any;
    let mockContract: any;

    beforeEach(() => {
        mockAdapter = {
            create: jest.fn().mockResolvedValue(true),
            destroy: jest.fn().mockResolvedValue(true),
            loadActions: jest.fn().mockResolvedValue([]),
            loadState: jest.fn().mockResolvedValue({ lastBlockNumber: 0, actions: [] }),
            saveState: jest.fn().mockResolvedValue(true),
            processBlock: jest.fn().mockResolvedValue(true),
            processOperation: jest.fn().mockResolvedValue(true),
            processTransfer: jest.fn().mockResolvedValue(true),
            processCustomJson: jest.fn().mockResolvedValue(true),
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            insert: jest.fn().mockResolvedValue(true),
            replace: jest.fn().mockResolvedValue(true)
        };

        mockContract = {
            testMethod: jest.fn(),
            asyncTestMethod: jest.fn().mockResolvedValue(true),
            create: jest.fn(),
            destroy: jest.fn()
        };

        streamer = new Streamer({
            JSON_ID: 'testing',
            DEBUG_MODE: false
        });

        streamer.registerAdapter(mockAdapter);
        streamer.registerContract('testcontract', mockContract);
    });

    afterEach(async () => {
        await streamer.stop();
    });

    describe('Action Registration', () => {
        test('Should register a new action successfully', async () => {
            const action = new TimeAction('1m', 'test-action', 'testcontract', 'testMethod');
            
            await streamer.registerAction(action);
            
            const actions = streamer.getActions();
            expect(actions).toHaveLength(1);
            expect(actions[0].id).toBe('test-action');
            expect(mockAdapter.saveState).toHaveBeenCalled();
        });

        test('Should not register duplicate action IDs', async () => {
            const action1 = new TimeAction('1m', 'test-action', 'testcontract', 'testMethod');
            const action2 = new TimeAction('5m', 'test-action', 'testcontract', 'testMethod');
            
            await streamer.registerAction(action1);
            await streamer.registerAction(action2);
            
            const actions = streamer.getActions();
            expect(actions).toHaveLength(1);
            expect(actions[0].timeValue).toBe('1m'); // First one should remain
        });

        test('Should throw error when registering action for non-existent contract', async () => {
            const action = new TimeAction('1m', 'test-action', 'nonexistent', 'testMethod');
            
            await expect(streamer.registerAction(action)).rejects.toThrow(
                'Contract \'nonexistent\' not found for action \'test-action\''
            );
        });

        test('Should throw error when registering action for non-existent method', async () => {
            const action = new TimeAction('1m', 'test-action', 'testcontract', 'nonexistentMethod');
            
            await expect(streamer.registerAction(action)).rejects.toThrow(
                'Method \'nonexistentMethod\' not found in contract \'testcontract\' for action \'test-action\''
            );
        });
    });

    describe('Action Management', () => {
        beforeEach(async () => {
            const action1 = new TimeAction('1m', 'action1', 'testcontract', 'testMethod');
            const action2 = new TimeAction('5m', 'action2', 'testcontract', 'testMethod');
            await streamer.registerAction(action1);
            await streamer.registerAction(action2);
        });

        test('Should remove action by ID', async () => {
            const result = await streamer.removeAction('action1');
            
            expect(result).toBe(true);
            expect(streamer.getActions()).toHaveLength(1);
            expect(streamer.getAction('action1')).toBeUndefined();
            expect(mockAdapter.saveState).toHaveBeenCalled();
        });

        test('Should return false when removing non-existent action', async () => {
            const result = await streamer.removeAction('nonexistent');
            
            expect(result).toBe(false);
            expect(streamer.getActions()).toHaveLength(2);
        });

        test('Should get action by ID', () => {
            const action = streamer.getAction('action1');
            
            expect(action).toBeDefined();
            expect(action?.id).toBe('action1');
        });

        test('Should return undefined for non-existent action', () => {
            const action = streamer.getAction('nonexistent');
            
            expect(action).toBeUndefined();
        });

        test('Should enable and disable actions', async () => {
            const action = streamer.getAction('action1');
            expect(action?.enabled).toBe(true);
            
            const result1 = await streamer.setActionEnabled('action1', false);
            expect(result1).toBe(true);
            expect(action?.enabled).toBe(false);
            
            const result2 = await streamer.setActionEnabled('action1', true);
            expect(result2).toBe(true);
            expect(action?.enabled).toBe(true);
        });

        test('Should reset action date', async () => {
            const action = streamer.getAction('action1');
            const originalDate = action?.date;
            
            // Wait a bit to ensure time difference
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const result = await streamer.resetAction('action1');
            
            expect(result).toBe(true);
            expect(action?.date.getTime()).toBeGreaterThan(originalDate?.getTime() || 0);
            expect(mockAdapter.saveState).toHaveBeenCalled();
        });
    });

    describe('Action Execution', () => {
        let testAction: TimeAction;

        beforeEach(async () => {
            testAction = new TimeAction('1m', 'test-action', 'testcontract', 'testMethod', { testData: 'value' });
            await streamer.registerAction(testAction);
            
            // Mock the blockchain time to be in the future to trigger execution
            streamer['latestBlockchainTime'] = new Date(Date.now() + 120000); // 2 minutes in future
        });

        test('Should execute action when time threshold is met', async () => {
            // Set action date to past to trigger execution
            testAction.date = new Date(Date.now() - 120000); // 2 minutes ago
            
            await streamer['processActions']();
            
            expect(mockContract.testMethod).toHaveBeenCalledWith({ testData: 'value' });
            expect(testAction.executionCount).toBe(1);
            expect(testAction.lastExecution).toBeInstanceOf(Date);
        });

        test('Should not execute action when time threshold is not met', async () => {
            // Reset the action date to be very recent to ensure it doesn't execute
            testAction.date = new Date(Date.now() - 10000); // Only 10 seconds ago (less than 1 minute)
            
            // Also ensure blockchain time is current, not in the future
            streamer['latestBlockchainTime'] = new Date();
            
            await streamer['processActions']();
            
            expect(mockContract.testMethod).not.toHaveBeenCalled();
            expect(testAction.executionCount).toBe(0);
        });

        test('Should not execute disabled actions', async () => {
            testAction.date = new Date(Date.now() - 120000); // 2 minutes ago
            testAction.disable();
            
            await streamer['processActions']();
            
            expect(mockContract.testMethod).not.toHaveBeenCalled();
        });

        test('Should not execute actions that have reached max executions', async () => {
            testAction.date = new Date(Date.now() - 120000); // 2 minutes ago
            testAction.maxExecutions = 1;
            testAction.executionCount = 1;
            
            await streamer['processActions']();
            
            expect(mockContract.testMethod).not.toHaveBeenCalled();
        });

        test('Should handle contract method errors gracefully', async () => {
            mockContract.testMethod.mockImplementation(() => {
                throw new Error('Contract method error');
            });
            
            testAction.date = new Date(Date.now() - 120000); // 2 minutes ago
            
            // Should not throw, but log error
            await expect(streamer['processActions']()).resolves.toBeUndefined();
            
            expect(mockContract.testMethod).toHaveBeenCalled();
            // Action should not increment execution count on error
            expect(testAction.executionCount).toBe(0);
        });

        test('Should clean up completed actions', async () => {
            testAction.maxExecutions = 1;
            testAction.date = new Date(Date.now() - 120000); // 2 minutes ago
            
            await streamer['processActions']();
            
            expect(mockContract.testMethod).toHaveBeenCalled();
            expect(streamer.getActions()).toHaveLength(0); // Action should be removed
        });
    });

    describe('Action Frequencies', () => {
        const testCases = [
            { timeValue: '3s', expectedSeconds: 3 },
            { timeValue: '30s', expectedSeconds: 30 },
            { timeValue: '1m', expectedSeconds: 60 },
            { timeValue: 'minute', expectedSeconds: 60 },
            { timeValue: '15m', expectedSeconds: 900 },
            { timeValue: '1h', expectedSeconds: 3600 },
            { timeValue: 'hourly', expectedSeconds: 3600 },
            { timeValue: '24h', expectedSeconds: 86400 },
            { timeValue: 'daily', expectedSeconds: 86400 },
            { timeValue: 'week', expectedSeconds: 604800 }
        ];

        testCases.forEach(({ timeValue, expectedSeconds }) => {
            test(`Should execute ${timeValue} action after ${expectedSeconds} seconds`, async () => {
                const action = new TimeAction(timeValue, `test-${timeValue}`, 'testcontract', 'testMethod');
                action.date = new Date(Date.now() - (expectedSeconds * 1000 + 1000)); // Past the threshold
                
                await streamer.registerAction(action);
                
                // Mock blockchain time
                streamer['latestBlockchainTime'] = new Date();
                
                await streamer['processActions']();
                
                expect(mockContract.testMethod).toHaveBeenCalled();
                expect(action.executionCount).toBe(1);
            });
        });
    });
});