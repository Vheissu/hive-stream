import { TimeAction } from '../src/actions';

describe('TimeAction', () => {
    describe('Constructor and Validation', () => {
        test('Should create a valid TimeAction with required parameters', () => {
            const action = new TimeAction('1m', 'test-action', 'testcontract', 'testmethod');
            
            expect(action.timeValue).toBe('1m');
            expect(action.id).toBe('test-action');
            expect(action.contractName).toBe('testcontract');
            expect(action.contractMethod).toBe('testmethod');
            expect(action.payload).toEqual({});
            expect(action.enabled).toBe(true);
            expect(action.executionCount).toBe(0);
            expect(action.date).toBeInstanceOf(Date);
        });

        test('Should create TimeAction with all optional parameters', () => {
            const testDate = new Date('2023-01-01T00:00:00Z');
            const payload = { test: 'data' };
            
            const action = new TimeAction(
                '1h',
                'test-action',
                'testcontract',
                'testmethod',
                payload,
                testDate,
                false,
                5,
                10,
                'America/New_York'
            );
            
            expect(action.timeValue).toBe('1h');
            expect(action.payload).toEqual(payload);
            expect(action.date).toEqual(testDate);
            expect(action.enabled).toBe(false);
            expect(action.executionCount).toBe(5);
            expect(action.maxExecutions).toBe(10);
            expect(action.timezone).toBe('America/New_York');
        });

        test('Should throw error for invalid timeValue', () => {
            expect(() => {
                new TimeAction('invalid', 'test-action', 'testcontract', 'testmethod');
            }).toThrow('Invalid timeValue \'invalid\'');
        });

        test('Should throw error for empty timeValue', () => {
            expect(() => {
                new TimeAction('', 'test-action', 'testcontract', 'testmethod');
            }).toThrow('timeValue must be a non-empty string');
        });

        test('Should throw error for invalid id format', () => {
            expect(() => {
                new TimeAction('1m', 'test action!', 'testcontract', 'testmethod');
            }).toThrow('id can only contain alphanumeric characters, underscores, and hyphens');
        });

        test('Should throw error for too long id', () => {
            const longId = 'a'.repeat(256);
            expect(() => {
                new TimeAction('1m', longId, 'testcontract', 'testmethod');
            }).toThrow('id must not exceed 255 characters');
        });

        test('Should throw error for empty contractName', () => {
            expect(() => {
                new TimeAction('1m', 'test-action', '', 'testmethod');
            }).toThrow('contractName must be a non-empty string');
        });

        test('Should throw error for empty contractMethod', () => {
            expect(() => {
                new TimeAction('1m', 'test-action', 'testcontract', '');
            }).toThrow('contractMethod must be a non-empty string');
        });

        test('Should throw error for invalid date string', () => {
            expect(() => {
                new TimeAction('1m', 'test-action', 'testcontract', 'testmethod', {}, 'invalid-date');
            }).toThrow('Invalid date string \'invalid-date\'');
        });
    });

    describe('Methods', () => {
        let action: TimeAction;

        beforeEach(() => {
            action = new TimeAction('1m', 'test-action', 'testcontract', 'testmethod');
        });

        test('Should reset date and lastExecution', async () => {
            const originalDate = action.date;
            action.lastExecution = new Date();
            
            // Wait a bit to ensure time difference
            await new Promise(resolve => setTimeout(resolve, 10));
            
            action.reset();
            
            expect(action.date.getTime()).toBeGreaterThan(originalDate.getTime());
            expect(action.lastExecution).toBeUndefined();
        });

        test('Should disable and enable action', () => {
            expect(action.enabled).toBe(true);
            
            action.disable();
            expect(action.enabled).toBe(false);
            
            action.enable();
            expect(action.enabled).toBe(true);
        });

        test('Should track execution count and max executions', () => {
            action.maxExecutions = 3;
            
            expect(action.hasReachedMaxExecutions()).toBe(false);
            
            action.incrementExecutionCount();
            expect(action.executionCount).toBe(1);
            expect(action.lastExecution).toBeInstanceOf(Date);
            expect(action.hasReachedMaxExecutions()).toBe(false);
            
            action.incrementExecutionCount();
            action.incrementExecutionCount();
            expect(action.executionCount).toBe(3);
            expect(action.hasReachedMaxExecutions()).toBe(true);
        });

        test('Should not reach max executions when maxExecutions is undefined', () => {
            action.executionCount = 1000;
            expect(action.hasReachedMaxExecutions()).toBe(false);
        });
    });

    describe('Serialization', () => {
        test('Should serialize to JSON correctly', () => {
            const testDate = new Date('2023-01-01T00:00:00Z');
            const lastExecution = new Date('2023-01-01T01:00:00Z');
            const payload = { test: 'data' };
            
            const action = new TimeAction(
                '1h',
                'test-action',
                'testcontract',
                'testmethod',
                payload,
                testDate,
                false,
                5,
                10,
                'UTC'
            );
            action.lastExecution = lastExecution;
            
            const json = action.toJSON();
            
            expect(json).toEqual({
                timeValue: '1h',
                id: 'test-action',
                contractName: 'testcontract',
                contractMethod: 'testmethod',
                payload: payload,
                date: testDate.toISOString(),
                enabled: false,
                lastExecution: lastExecution.toISOString(),
                executionCount: 5,
                maxExecutions: 10,
                timezone: 'UTC'
            });
        });

        test('Should deserialize from JSON correctly', () => {
            const testDate = new Date('2023-01-01T00:00:00Z');
            const lastExecution = new Date('2023-01-01T01:00:00Z');
            const payload = { test: 'data' };
            
            const jsonData = {
                timeValue: '1h',
                id: 'test-action',
                contractName: 'testcontract',
                contractMethod: 'testmethod',
                payload: payload,
                date: testDate.toISOString(),
                enabled: false,
                lastExecution: lastExecution.toISOString(),
                executionCount: 5,
                maxExecutions: 10,
                timezone: 'UTC'
            };
            
            const action = TimeAction.fromJSON(jsonData);
            
            expect(action.timeValue).toBe('1h');
            expect(action.id).toBe('test-action');
            expect(action.contractName).toBe('testcontract');
            expect(action.contractMethod).toBe('testmethod');
            expect(action.payload).toEqual(payload);
            expect(action.date).toEqual(testDate);
            expect(action.enabled).toBe(false);
            expect(action.lastExecution).toEqual(lastExecution);
            expect(action.executionCount).toBe(5);
            expect(action.maxExecutions).toBe(10);
            expect(action.timezone).toBe('UTC');
        });

        test('Should handle serialization without optional fields', () => {
            const action = new TimeAction('1m', 'test-action', 'testcontract', 'testmethod');
            
            const json = action.toJSON();
            const restored = TimeAction.fromJSON(json);
            
            expect(restored.timeValue).toBe(action.timeValue);
            expect(restored.id).toBe(action.id);
            expect(restored.contractName).toBe(action.contractName);
            expect(restored.contractMethod).toBe(action.contractMethod);
            expect(restored.payload).toEqual({});
            expect(restored.enabled).toBe(true);
            expect(restored.executionCount).toBe(0);
            expect(restored.lastExecution).toBeUndefined();
            expect(restored.maxExecutions).toBeUndefined();
        });
    });

    describe('Static Methods', () => {
        test('Should return valid time values', () => {
            const validValues = TimeAction.getValidTimeValues();
            
            expect(validValues).toContain('3s');
            expect(validValues).toContain('1m');
            expect(validValues).toContain('1h');
            expect(validValues).toContain('24h');
            expect(validValues).toContain('week');
            expect(Array.isArray(validValues)).toBe(true);
        });

        test('Should return a copy of valid time values', () => {
            const validValues1 = TimeAction.getValidTimeValues();
            const validValues2 = TimeAction.getValidTimeValues();
            
            expect(validValues1).toEqual(validValues2);
            expect(validValues1).not.toBe(validValues2); // Different array instances
            
            validValues1.push('invalid');
            expect(validValues2).not.toContain('invalid');
        });
    });
});