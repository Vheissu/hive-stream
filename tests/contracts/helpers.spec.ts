import BigNumber from 'bignumber.js';
import {
    amountSchema,
    identifierSchema,
    assetSchema,
    createContractState,
    ensureSqlAdapter,
    initializeTables,
    emitContractEvent,
    requireSender,
    requireTransferContext,
    requireEscrowContext,
    getIncomingPayment,
    getEscrowPayment,
    parseDateValue,
    parseJson,
    toBigNumber,
    ensurePositiveAmount,
    assertAssetMatches,
    uniqueItems,
} from '../../src/contracts/helpers';

describe('Contract Helpers', () => {
    describe('Zod schemas', () => {
        describe('amountSchema', () => {
            test('accepts valid integer amounts', () => {
                expect(amountSchema.safeParse('100').success).toBe(true);
                expect(amountSchema.safeParse('0').success).toBe(true);
            });

            test('accepts valid decimal amounts', () => {
                expect(amountSchema.safeParse('100.000').success).toBe(true);
                expect(amountSchema.safeParse('0.001').success).toBe(true);
                expect(amountSchema.safeParse('99999.12345678').success).toBe(true);
            });

            test('rejects invalid amounts', () => {
                expect(amountSchema.safeParse('').success).toBe(false);
                expect(amountSchema.safeParse('-1').success).toBe(false);
                expect(amountSchema.safeParse('abc').success).toBe(false);
                expect(amountSchema.safeParse('1.123456789').success).toBe(false); // > 8 decimals
            });
        });

        describe('identifierSchema', () => {
            test('accepts valid identifiers', () => {
                expect(identifierSchema.safeParse('my-id').success).toBe(true);
                expect(identifierSchema.safeParse('token_LEG').success).toBe(true);
                expect(identifierSchema.safeParse('nft:art-1').success).toBe(true);
                expect(identifierSchema.safeParse('a').success).toBe(true);
            });

            test('rejects invalid identifiers', () => {
                expect(identifierSchema.safeParse('').success).toBe(false);
                expect(identifierSchema.safeParse('has space').success).toBe(false);
                expect(identifierSchema.safeParse('a'.repeat(81)).success).toBe(false);
            });
        });

        describe('assetSchema', () => {
            test('accepts valid assets', () => {
                expect(assetSchema.safeParse('HIVE').success).toBe(true);
                expect(assetSchema.safeParse('HBD').success).toBe(true);
                expect(assetSchema.safeParse('SWAP.HIVE').success).toBe(true);
            });

            test('rejects invalid assets', () => {
                expect(assetSchema.safeParse('').success).toBe(false);
                expect(assetSchema.safeParse('ab').success).toBe(false); // too short
                expect(assetSchema.safeParse('hive').success).toBe(false); // lowercase
            });
        });
    });

    describe('createContractState()', () => {
        test('creates state with null adapter', () => {
            const state = createContractState();
            expect(state.adapter).toBeNull();
        });

        test('creates state with extra properties', () => {
            const state = createContractState({ streamer: 'mock', count: 0 });
            expect(state.adapter).toBeNull();
            expect(state.streamer).toBe('mock');
            expect(state.count).toBe(0);
        });
    });

    describe('ensureSqlAdapter()', () => {
        test('throws when adapter is null', () => {
            expect(() => ensureSqlAdapter(null)).toThrow('SQL-capable adapter');
        });

        test('throws when adapter lacks sql capability', () => {
            expect(() => ensureSqlAdapter({ capabilities: {} })).toThrow('SQL-capable adapter');
        });

        test('passes with sql-capable adapter', () => {
            expect(() => ensureSqlAdapter({ capabilities: { sql: true } })).not.toThrow();
        });
    });

    describe('initializeTables()', () => {
        test('calls adapter.query for each statement', async () => {
            const mockAdapter = {
                capabilities: { sql: true },
                query: jest.fn().mockResolvedValue([]),
            };

            await initializeTables(mockAdapter, [
                'CREATE TABLE t1 (id INTEGER)',
                'CREATE TABLE t2 (id INTEGER)',
            ]);

            expect(mockAdapter.query).toHaveBeenCalledTimes(2);
            expect(mockAdapter.query).toHaveBeenCalledWith('CREATE TABLE t1 (id INTEGER)');
            expect(mockAdapter.query).toHaveBeenCalledWith('CREATE TABLE t2 (id INTEGER)');
        });

        test('throws when adapter is not SQL-capable', async () => {
            await expect(initializeTables(null, ['CREATE TABLE t1 (id INTEGER)'])).rejects.toThrow('SQL-capable adapter');
        });
    });

    describe('emitContractEvent()', () => {
        test('calls adapter.addEvent when available', async () => {
            const mockAdapter = {
                addEvent: jest.fn().mockResolvedValue(undefined),
            };

            await emitContractEvent(mockAdapter, 'token', 'create', { name: 'LEG' }, { action: 'token_created' });

            expect(mockAdapter.addEvent).toHaveBeenCalledWith(
                expect.any(Date),
                'token',
                'create',
                { name: 'LEG' },
                { action: 'token_created' },
            );
        });

        test('does nothing when adapter has no addEvent', async () => {
            await expect(emitContractEvent(null, 'token', 'create', {}, {})).resolves.toBeUndefined();
            await expect(emitContractEvent({}, 'token', 'create', {}, {})).resolves.toBeUndefined();
        });
    });

    describe('requireSender()', () => {
        test('returns sender when present', () => {
            expect(requireSender({ sender: 'alice' } as any)).toBe('alice');
        });

        test('throws when sender is missing', () => {
            expect(() => requireSender({} as any)).toThrow('Sender required');
            expect(() => requireSender({ sender: '' } as any)).toThrow('Sender required');
        });
    });

    describe('requireTransferContext()', () => {
        test('returns transfer when present', () => {
            const transfer = { from: 'alice', to: 'bob', amount: '1.000', asset: 'HIVE' };
            const ctx = { transfer } as any;
            expect(requireTransferContext(ctx)).toBe(transfer);
        });

        test('throws when transfer is missing', () => {
            expect(() => requireTransferContext({} as any)).toThrow('Transfer context required');
        });
    });

    describe('requireEscrowContext()', () => {
        test('returns escrow when present', () => {
            const escrow = { escrowId: 1, agent: 'agent' };
            const ctx = { escrow } as any;
            expect(requireEscrowContext(ctx)).toBe(escrow);
        });

        test('throws when escrow is missing', () => {
            expect(() => requireEscrowContext({} as any)).toThrow('Escrow context required');
        });
    });

    describe('getIncomingPayment()', () => {
        test('returns transfer payment when transfer context exists', () => {
            const ctx = {
                transfer: {
                    from: 'alice',
                    to: 'bob',
                    rawAmount: '1.000 HIVE',
                    amount: '1.000',
                    asset: 'HIVE',
                    memo: 'test',
                },
            } as any;

            const payment = getIncomingPayment(ctx);
            expect(payment.source).toBe('transfer');
            expect(payment.from).toBe('alice');
            expect(payment.amount).toBe('1.000');
            expect(payment.asset).toBe('HIVE');
        });

        test('returns recurrent_transfer payment', () => {
            const ctx = {
                trigger: 'recurrent_transfer',
                operation: {
                    data: {
                        from: 'alice',
                        to: 'bob',
                        amount: '5.000 HBD',
                        memo: 'sub',
                    },
                },
            } as any;

            const payment = getIncomingPayment(ctx);
            expect(payment.source).toBe('recurrent_transfer');
            expect(payment.from).toBe('alice');
            expect(payment.amount).toBe('5.000');
            expect(payment.asset).toBe('HBD');
        });

        test('throws when no payment context', () => {
            expect(() => getIncomingPayment({} as any)).toThrow('Payment context required');
        });
    });

    describe('getEscrowPayment()', () => {
        test('returns non-zero HBD amount', () => {
            const ctx = {
                escrow: {
                    escrowId: 1,
                    agent: 'agent',
                    hiveAmount: '0.000 HIVE',
                    hbdAmount: '20.000 HBD',
                },
            } as any;

            const payment = getEscrowPayment(ctx);
            expect(payment.amount).toBe('20.000');
            expect(payment.asset).toBe('HBD');
            expect(payment.rawAmount).toBe('20.000 HBD');
        });

        test('returns non-zero HIVE amount', () => {
            const ctx = {
                escrow: {
                    escrowId: 1,
                    agent: 'agent',
                    hiveAmount: '10.000 HIVE',
                    hbdAmount: '0.000 HBD',
                },
            } as any;

            const payment = getEscrowPayment(ctx);
            expect(payment.amount).toBe('10.000');
            expect(payment.asset).toBe('HIVE');
        });

        test('throws when both amounts are zero', () => {
            const ctx = {
                escrow: {
                    escrowId: 1,
                    agent: 'agent',
                    hiveAmount: '0.000 HIVE',
                    hbdAmount: '0.000 HBD',
                },
            } as any;

            expect(() => getEscrowPayment(ctx)).toThrow('Escrow payment amount required');
        });

        test('throws when escrow context is missing', () => {
            expect(() => getEscrowPayment({} as any)).toThrow('Escrow context required');
        });
    });

    describe('parseDateValue()', () => {
        test('returns null for falsy values', () => {
            expect(parseDateValue(null)).toBeNull();
            expect(parseDateValue(undefined)).toBeNull();
            expect(parseDateValue('')).toBeNull();
        });

        test('returns Date objects unchanged', () => {
            const date = new Date('2024-01-01');
            expect(parseDateValue(date)).toBe(date);
        });

        test('parses valid date strings', () => {
            const result = parseDateValue('2024-06-15T12:00:00Z');
            expect(result).toBeInstanceOf(Date);
            expect(result!.toISOString()).toBe('2024-06-15T12:00:00.000Z');
        });

        test('throws for invalid date strings', () => {
            expect(() => parseDateValue('not-a-date')).toThrow('Invalid date');
        });
    });

    describe('parseJson()', () => {
        test('returns fallback for null/undefined/empty', () => {
            expect(parseJson(null, 'default')).toBe('default');
            expect(parseJson(undefined, 'default')).toBe('default');
            expect(parseJson('', 'default')).toBe('default');
        });

        test('parses valid JSON strings', () => {
            expect(parseJson('{"a":1}', {})).toEqual({ a: 1 });
            expect(parseJson('[1,2,3]', [])).toEqual([1, 2, 3]);
        });

        test('returns fallback for invalid JSON strings', () => {
            expect(parseJson('not json', {})).toEqual({});
        });

        test('returns non-string values as-is', () => {
            const obj = { key: 'value' };
            expect(parseJson(obj, {})).toBe(obj);
            expect(parseJson(42, 0)).toBe(42);
        });
    });

    describe('toBigNumber()', () => {
        test('converts string to BigNumber', () => {
            const bn = toBigNumber('100.500');
            expect(bn).toBeInstanceOf(BigNumber);
            expect(bn.toString()).toBe('100.5');
        });

        test('converts number to BigNumber', () => {
            expect(toBigNumber(42).toString()).toBe('42');
        });
    });

    describe('ensurePositiveAmount()', () => {
        test('passes for positive amounts', () => {
            expect(() => ensurePositiveAmount('1.000', 'Amount')).not.toThrow();
            expect(() => ensurePositiveAmount('0.001', 'Price')).not.toThrow();
        });

        test('throws for zero', () => {
            expect(() => ensurePositiveAmount('0', 'Amount')).toThrow('Amount must be greater than zero');
        });

        test('throws for negative', () => {
            expect(() => ensurePositiveAmount('-1', 'Amount')).toThrow('Amount must be greater than zero');
        });

        test('throws for non-numeric', () => {
            expect(() => ensurePositiveAmount('abc', 'Amount')).toThrow('Invalid numeric value');
        });
    });

    describe('assertAssetMatches()', () => {
        test('passes when assets match', () => {
            expect(() => assertAssetMatches('HIVE', 'HIVE')).not.toThrow();
            expect(() => assertAssetMatches('HBD', 'HBD', 'Collateral')).not.toThrow();
        });

        test('throws when assets differ', () => {
            expect(() => assertAssetMatches('HIVE', 'HBD')).toThrow('Asset must be paid in HBD');
            expect(() => assertAssetMatches('HIVE', 'HBD', 'Collateral')).toThrow('Collateral must be paid in HBD');
        });
    });

    describe('uniqueItems()', () => {
        test('removes duplicates', () => {
            expect(uniqueItems(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
        });

        test('filters out falsy values', () => {
            expect(uniqueItems(['a', '', 'b', ''])).toEqual(['a', 'b']);
        });

        test('returns empty for empty input', () => {
            expect(uniqueItems([])).toEqual([]);
        });
    });
});
