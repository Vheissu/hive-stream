import { Utils } from '../src/utils';
import { PrivateKey } from '@hiveio/dhive';

/**
 * Extended Utils tests covering functions not tested in utils.spec.ts:
 * sleep, jsonParse, toHiveTimestamp, normalizeJsonMeta, normalizePrivateKeys,
 * verifyTransfer, createAuthority, getTransferUrl, and input validation
 * for blockchain methods (transferHiveTokens, broadcastOperations,
 * escrowTransfer, escrowApprove, escrowDispute, escrowRelease, etc.)
 */
describe('Utils (extended)', () => {
    describe('sleep()', () => {
        test('resolves after specified time', async () => {
            const start = Date.now();
            await Utils.sleep(50);
            expect(Date.now() - start).toBeGreaterThanOrEqual(40);
        });

        test('throws for negative duration', () => {
            expect(() => Utils.sleep(-1)).toThrow('Sleep duration cannot be negative');
        });

        test('resolves immediately for 0ms', async () => {
            await expect(Utils.sleep(0)).resolves.toBeUndefined();
        });
    });

    describe('jsonParse()', () => {
        test('parses valid JSON', () => {
            expect(Utils.jsonParse('{"key":"value"}')).toEqual({ key: 'value' });
            expect(Utils.jsonParse('[1,2,3]')).toEqual([1, 2, 3]);
            expect(Utils.jsonParse('"hello"')).toBe('hello');
        });

        test('returns null for invalid JSON', () => {
            expect(Utils.jsonParse('not json')).toBeNull();
            expect(Utils.jsonParse('{broken')).toBeNull();
        });

        test('returns null for non-string input', () => {
            expect(Utils.jsonParse(null as any)).toBeNull();
            expect(Utils.jsonParse(undefined as any)).toBeNull();
            expect(Utils.jsonParse('' as any)).toBeNull();
            expect(Utils.jsonParse(123 as any)).toBeNull();
        });
    });

    describe('toHiveTimestamp()', () => {
        test('converts Date object to Hive format', () => {
            const date = new Date('2024-06-15T12:30:45.123Z');
            expect(Utils.toHiveTimestamp(date)).toBe('2024-06-15T12:30:45');
        });

        test('converts ISO string to Hive format', () => {
            expect(Utils.toHiveTimestamp('2024-06-15T12:30:45.000Z')).toBe('2024-06-15T12:30:45');
        });

        test('throws for invalid date', () => {
            expect(() => Utils.toHiveTimestamp('not-a-date')).toThrow('Invalid date');
        });
    });

    describe('normalizeJsonMeta()', () => {
        test('returns "{}" for null/undefined', () => {
            expect(Utils.normalizeJsonMeta(undefined)).toBe('{}');
            expect(Utils.normalizeJsonMeta(null as any)).toBe('{}');
        });

        test('returns string as-is', () => {
            expect(Utils.normalizeJsonMeta('{"app":"test"}')).toBe('{"app":"test"}');
        });

        test('stringifies object', () => {
            expect(Utils.normalizeJsonMeta({ app: 'test' })).toBe('{"app":"test"}');
        });
    });

    describe('normalizePrivateKeys()', () => {
        test('converts string to PrivateKey array', () => {
            // Use a known test key (this is not a real key with funds)
            const testKey = '5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg';
            const result = Utils.normalizePrivateKeys(testKey);
            expect(result).toHaveLength(1);
            expect(result[0]).toBeInstanceOf(PrivateKey);
        });

        test('accepts PrivateKey instance', () => {
            const pk = PrivateKey.fromString('5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg');
            const result = Utils.normalizePrivateKeys(pk);
            expect(result).toHaveLength(1);
            expect(result[0]).toBe(pk);
        });

        test('accepts array of keys', () => {
            const testKey = '5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg';
            const result = Utils.normalizePrivateKeys([testKey, testKey]);
            expect(result).toHaveLength(2);
        });

        test('throws for empty string', () => {
            expect(() => Utils.normalizePrivateKeys('')).toThrow('Invalid private key');
        });

        test('throws for invalid key', () => {
            expect(() => Utils.normalizePrivateKeys('not-a-key')).toThrow();
        });
    });

    describe('verifyTransfer()', () => {
        test('returns true for matching transfer', async () => {
            const transaction = {
                operations: [
                    ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE' }]
                ]
            } as any;

            const result = await Utils.verifyTransfer(transaction, 'alice', 'bob', '1.000 HIVE');
            expect(result).toBe(true);
        });

        test('returns false for mismatched from', async () => {
            const transaction = {
                operations: [
                    ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE' }]
                ]
            } as any;

            const result = await Utils.verifyTransfer(transaction, 'charlie', 'bob', '1.000 HIVE');
            expect(result).toBe(false);
        });

        test('returns false for mismatched to', async () => {
            const transaction = {
                operations: [
                    ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE' }]
                ]
            } as any;

            const result = await Utils.verifyTransfer(transaction, 'alice', 'charlie', '1.000 HIVE');
            expect(result).toBe(false);
        });

        test('returns false for mismatched amount', async () => {
            const transaction = {
                operations: [
                    ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE' }]
                ]
            } as any;

            const result = await Utils.verifyTransfer(transaction, 'alice', 'bob', '2.000 HIVE');
            expect(result).toBe(false);
        });

        test('returns false for null transaction', async () => {
            expect(await Utils.verifyTransfer(null as any, 'a', 'b', '1')).toBe(false);
        });

        test('returns false for transaction with no operations', async () => {
            expect(await Utils.verifyTransfer({ operations: [] } as any, 'a', 'b', '1')).toBe(false);
        });
    });

    describe('createAuthority()', () => {
        test('creates default authority', () => {
            const auth = Utils.createAuthority();
            expect(auth).toEqual({
                weight_threshold: 1,
                account_auths: [],
                key_auths: [],
            });
        });

        test('creates authority with key and account auths', () => {
            const auth = Utils.createAuthority(
                [['STM7abc', 1]],
                [['alice', 1]],
                2
            );

            expect(auth.weight_threshold).toBe(2);
            expect(auth.key_auths).toEqual([['STM7abc', 1]]);
            expect(auth.account_auths).toEqual([['alice', 1]]);
        });

        test('throws for zero weight threshold', () => {
            expect(() => Utils.createAuthority([], [], 0)).toThrow('weight threshold must be greater than zero');
        });

        test('throws for negative weight threshold', () => {
            expect(() => Utils.createAuthority([], [], -1)).toThrow('weight threshold must be greater than zero');
        });
    });

    describe('transferHiveTokens() input validation', () => {
        test('throws when client is missing', () => {
            expect(() => Utils.transferHiveTokens(
                null as any, { ACTIVE_KEY: 'key' }, 'alice', 'bob', '1.000', 'HIVE'
            )).toThrow('Missing required parameters');
        });

        test('throws when active key is missing', () => {
            expect(() => Utils.transferHiveTokens(
                {} as any, {}, 'alice', 'bob', '1.000', 'HIVE'
            )).toThrow('Missing required parameters');
        });

        test('throws when from is missing', () => {
            expect(() => Utils.transferHiveTokens(
                {} as any, { ACTIVE_KEY: 'key' }, '', 'bob', '1.000', 'HIVE'
            )).toThrow('Missing required parameters');
        });
    });

    describe('broadcastOperations() input validation', () => {
        test('throws when operations array is empty', () => {
            expect(() => Utils.broadcastOperations(
                {} as any, [], '5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg'
            )).toThrow('at least one operation');
        });

        test('throws when client is missing', () => {
            expect(() => Utils.broadcastOperations(
                null as any, [['transfer', {}]], '5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg'
            )).toThrow('at least one operation');
        });
    });

    describe('broadcastMultiSigOperations() input validation', () => {
        test('throws when fewer than 2 keys provided', () => {
            expect(() => Utils.broadcastMultiSigOperations(
                {} as any, [['transfer', {}]], ['5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg']
            )).toThrow('at least two keys');
        });
    });

    describe('escrowTransfer() input validation', () => {
        test('throws when from is missing', () => {
            expect(() => Utils.escrowTransfer(
                {} as any, {}, {
                    from: '', to: 'bob', agent: 'agent',
                    escrow_id: 1, fee: '0.001 HIVE',
                    ratification_deadline: '2024-01-01', escrow_expiration: '2024-02-01'
                }
            )).toThrow('Escrow transfer requires');
        });

        test('throws when escrow_id is not a number', () => {
            expect(() => Utils.escrowTransfer(
                {} as any, {}, {
                    from: 'alice', to: 'bob', agent: 'agent',
                    escrow_id: 'abc' as any, fee: '0.001 HIVE',
                    ratification_deadline: '2024-01-01', escrow_expiration: '2024-02-01'
                }
            )).toThrow('numeric escrow_id');
        });

        test('throws when fee is missing', () => {
            expect(() => Utils.escrowTransfer(
                {} as any, {}, {
                    from: 'alice', to: 'bob', agent: 'agent',
                    escrow_id: 1, fee: '',
                    ratification_deadline: '2024-01-01', escrow_expiration: '2024-02-01'
                }
            )).toThrow('escrow fee');
        });

        test('throws when no signing keys available', () => {
            expect(() => Utils.escrowTransfer(
                {} as any, {}, {
                    from: 'alice', to: 'bob', agent: 'agent',
                    escrow_id: 1, fee: '0.001 HIVE',
                    ratification_deadline: '2024-01-01', escrow_expiration: '2024-02-01'
                }
            )).toThrow('Active key or explicit signing keys');
        });
    });

    describe('escrowApprove() input validation', () => {
        test('throws when who is missing', () => {
            expect(() => Utils.escrowApprove(
                {} as any, {},
                { from: 'alice', to: 'bob', agent: 'agent', who: '', escrow_id: 1, approve: true }
            )).toThrow('Escrow approve requires');
        });

        test('throws when no signing keys', () => {
            expect(() => Utils.escrowApprove(
                {} as any, {},
                { from: 'alice', to: 'bob', agent: 'agent', who: 'agent', escrow_id: 1, approve: true }
            )).toThrow('Active key or explicit signing keys');
        });
    });

    describe('escrowDispute() input validation', () => {
        test('throws when agent is missing', () => {
            expect(() => Utils.escrowDispute(
                {} as any, {},
                { from: 'alice', to: 'bob', agent: '', who: 'alice', escrow_id: 1 }
            )).toThrow('Escrow dispute requires');
        });
    });

    describe('escrowRelease() input validation', () => {
        test('throws when receiver is missing', () => {
            expect(() => Utils.escrowRelease(
                {} as any, {},
                { from: 'alice', to: 'bob', agent: 'agent', who: 'agent', receiver: '', escrow_id: 1 }
            )).toThrow('Escrow release requires');
        });
    });

    describe('transferHiveTokensMultiple() input validation', () => {
        test('throws for empty accounts array', async () => {
            await expect(Utils.transferHiveTokensMultiple(
                {} as any, {} as any, 'alice', [], '1.000', 'HIVE', 'memo'
            )).rejects.toThrow('Accounts array cannot be empty');
        });
    });

    describe('getAccountTransfers() input validation', () => {
        test('throws when account is missing', async () => {
            await expect(Utils.getAccountTransfers(
                {} as any, ''
            )).rejects.toThrow('Account name is required');
        });
    });

    describe('transferHiveEngineTokens() input validation', () => {
        test('throws when parameters are missing', () => {
            expect(() => Utils.transferHiveEngineTokens(
                null as any, {} as any, 'alice', 'bob', '10', 'LEG'
            )).toThrow('Missing required parameters');
        });
    });

    describe('issueHiveEngineTokens() input validation', () => {
        test('throws when parameters are missing', () => {
            expect(() => Utils.issueHiveEngineTokens(
                null as any, {} as any, 'alice', 'bob', 'LEG', '10'
            )).toThrow('Missing required parameters');
        });
    });

    describe('transferHiveEngineTokensMultiple() input validation', () => {
        test('throws for empty accounts', async () => {
            await expect(Utils.transferHiveEngineTokensMultiple(
                {} as any, {} as any, 'alice', [], 'LEG', 'memo'
            )).rejects.toThrow('Accounts array cannot be empty');
        });
    });

    describe('getTransaction() input validation', () => {
        test('throws when client is null', async () => {
            await expect(Utils.getTransaction(null as any, 100, 'trx-1')).rejects.toThrow('Client instance is required');
        });

        test('throws when transactionId is empty', async () => {
            await expect(Utils.getTransaction({} as any, 100, '')).rejects.toThrow('Transaction ID is required');
        });
    });

    describe('randomString edge cases', () => {
        test('returns empty string for length 0', () => {
            expect(Utils.randomString(0)).toBe('');
        });

        test('throws for negative length', () => {
            expect(() => Utils.randomString(-1)).toThrow('Length cannot be negative');
        });
    });

    describe('shuffle edge cases', () => {
        test('throws for non-array input', () => {
            expect(() => Utils.shuffle('not an array' as any)).toThrow('Input must be an array');
        });

        test('handles empty array', () => {
            expect(Utils.shuffle([])).toEqual([]);
        });

        test('handles single-element array', () => {
            expect(Utils.shuffle([1])).toEqual([1]);
        });
    });

    describe('roundPrecision edge cases', () => {
        test('throws for negative precision', () => {
            expect(() => Utils.roundPrecision(1.5, -1)).toThrow('Precision must be a non-negative');
        });
    });

    describe('randomRange edge cases', () => {
        test('throws when min > max', () => {
            expect(() => Utils.randomRange(10, 5)).toThrow('Minimum value cannot be greater than maximum');
        });
    });
});
