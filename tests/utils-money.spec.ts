import { PrivateKey } from '@hiveio/dhive';

import BigNumber from '../src/bignumber';
import {
    HiveEngineDelegateBuilder,
    HiveEngineMarketOrderBuilder,
    HiveEngineStakeBuilder,
    HiveEngineUnstakeBuilder
} from '../src/builders';
import { Utils } from '../src/utils';

const ACTIVE_KEY = PrivateKey.fromSeed('hive-stream utils money spec').toString();
const config = { ACTIVE_KEY, HIVE_ENGINE_ID: 'ssc-mainnet-hive' } as any;

function recordingClient(failOnCall: number[] = []) {
    const calls: any[] = [];
    let count = 0;

    return {
        calls,
        client: {
            broadcast: {
                json: jest.fn(async (data: any) => {
                    count++;
                    if (failOnCall.includes(count)) {
                        throw new Error(`broadcast ${count} failed`);
                    }
                    calls.push(data);
                    return { id: `trx-${count}` };
                })
            }
        } as any
    };
}

describe('Utils.parseAssetAmount strictness', () => {
    test.each([
        '0x10 HIVE',
        '1e3 HBD',
        '-1.000 HIVE',
        '+1.000 HIVE',
        '1,000.000 HIVE',
        '.5 HIVE',
        '1. HIVE',
        'Infinity HIVE',
        '1.0001 HIVE',
        '1.0001 HBD',
        '1.0000001 VESTS',
        '1.000000001 BEE'
    ])('rejects %s', (raw) => {
        expect(() => Utils.parseAssetAmount(raw)).toThrow(/Invalid asset amount/);
    });

    test('accepts plain decimals within each asset precision', () => {
        expect(Utils.parseAssetAmount('1.000 HIVE').value.toFixed(3)).toBe('1.000');
        expect(Utils.parseAssetAmount('5 HBD').amount).toBe('5');
        expect(Utils.parseAssetAmount('1.000000 VESTS').asset).toBe('VESTS');
        expect(Utils.parseAssetAmount('0.00000001 BEE').value.toFixed()).toBe('0.00000001');
        expect(Utils.parseAssetAmount('0.000 HIVE').value.isZero()).toBe(true);
    });

    test('names the decimal limit in the error', () => {
        expect(() => Utils.parseAssetAmount('1.0001 HIVE')).toThrow('HIVE allows at most 3 decimal places');
    });
});

describe('Utils.roundPrecision', () => {
    test('rounds on the decimal value without a fudge factor', () => {
        expect(Utils.roundPrecision(1.0004999, 3)).toBe(1);
        expect(Utils.roundPrecision(1.0005, 3)).toBe(1.001);
        expect(Utils.roundPrecision(1.005, 2)).toBe(1.01);
        expect(Utils.roundPrecision(-1.0005, 3)).toBe(-1.001);
        expect(Utils.roundPrecision(-1.0004999, 3)).toBe(-1);
        expect(Utils.roundPrecision(99.2966, 3)).toBe(99.297);
        expect(Utils.roundPrecision(2.5, 0)).toBe(3);
    });
});

describe('split helpers never over-allocate', () => {
    test('round the total down before allocating', () => {
        expect(Utils.splitAmountByBasisPoints('1.0009', [5000, 5000])).toEqual(['0.500', '0.500']);
        expect(Utils.splitAmountByPercentage('1.0009', [50, 50])).toEqual(['0.500', '0.500']);
        expect(Utils.splitAmountByWeights('1.0009', [1, 1])).toEqual(['0.500', '0.500']);
    });

    test('reject negative amounts', () => {
        expect(() => Utils.splitAmountByBasisPoints('-1.000', [5000, 5000])).toThrow('Amount cannot be negative');
        expect(() => Utils.splitAmountByPercentage('-1.000', [50, 50])).toThrow('Amount cannot be negative');
        expect(() => Utils.splitAmountByWeights('-1.000', [1, 1])).toThrow('Amount cannot be negative');
    });

    test('throw instead of over-allocating with a rounding mode that rounds up', () => {
        expect(() => Utils.splitAmountByWeights('0.002', [1, 1, 1, 1], 3, BigNumber.ROUND_UP)).toThrow(/exceeds the amount/);
    });

    test('parts never sum above the input', () => {
        const amounts = ['0', '0.001', '0.0019', '1.0005', '7.123456', '1000000.9999', '3.333'];
        const weightSets = [[1, 1, 1], [3, 7], [10000, 800], [1, 2, 3, 4, 5, 6, 7]];

        for (const amount of amounts) {
            for (const weights of weightSets) {
                const parts = Utils.splitAmountByWeights(amount, weights);
                const sum = parts.reduce((total, part) => total.plus(part), new BigNumber(0));

                expect({ amount, weights, over: sum.isGreaterThan(amount) }).toEqual({ amount, weights, over: false });
                expect(parts.every((part) => !new BigNumber(part).isNegative())).toBe(true);
            }

            const bps = Utils.splitAmountByBasisPoints(amount, [3333, 3333, 3334]);
            expect(bps.reduce((total, part) => total.plus(part), new BigNumber(0)).isGreaterThan(amount)).toBe(false);

            const pct = Utils.splitAmountByPercentage(amount, [33.33, 33.33, 33.34]);
            expect(pct.reduce((total, part) => total.plus(part), new BigNumber(0)).isGreaterThan(amount)).toBe(false);
        }
    });
});

describe('Utils.convertHiveAmount failures', () => {
    beforeEach(() => {
        (fetch as any).resetMocks();
    });

    test('throws when the rate sources are unreachable', async () => {
        (fetch as any).mockReject(new Error('network down'));

        await expect(Utils.convertHiveAmount(10, 'USD', 'HIVE')).rejects.toThrow(/convertHiveAmount: .*USD to HIVE/);
    });

    test('throws when no positive rate exists for the pair', async () => {
        (fetch as any)
            .once(JSON.stringify({ hive: { usd: 0 }, hive_dollar: { usd: 0 } }))
            .once(JSON.stringify({ date: '2025-07-31', usd: { usd: 1.0 } }));

        await expect(Utils.convertHiveAmount(10, 'USD', 'HIVE')).rejects.toThrow('no exchange rate available for USD to HIVE');
    });

    test('still returns the amount unchanged for the same symbol', async () => {
        await expect(Utils.convertHiveAmount(10, 'HIVE', 'HIVE')).resolves.toBe(10);
    });
});

describe('Utils.formatEngineQuantity', () => {
    test('formats numbers through BigNumber without float noise or exponents', () => {
        expect(Utils.formatEngineQuantity(0.1 + 0.2)).toBe('0.3');
        expect(Utils.formatEngineQuantity(0.7 + 0.1)).toBe('0.8');
        expect(Utils.formatEngineQuantity(1e-7)).toBe('0.0000001');
        expect(Utils.formatEngineQuantity(1e21)).toBe('1000000000000000000000');
        expect(Utils.formatEngineQuantity(10)).toBe('10');
        expect(Utils.formatEngineQuantity('10.50')).toBe('10.5');
        expect(Utils.formatEngineQuantity(new BigNumber('2.125'))).toBe('2.125');
    });

    test.each([
        ['1e-7'],
        ['1,5'],
        ['1,000.50'],
        ['abc'],
        ['-1'],
        ['0'],
        ['0.000000001'],
        [''],
        [0],
        [-1],
        [Number.NaN],
        [Number.POSITIVE_INFINITY],
        [1e-9]
    ])('rejects %p', (value) => {
        expect(() => Utils.formatEngineQuantity(value as any)).toThrow(/Hive Engine quantity/);
    });
});

describe('Hive Engine batch helpers', () => {
    beforeEach(() => {
        jest.spyOn(Utils, 'sleep').mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test.each([
        ['1,000.50'],
        ['abc'],
        ['0'],
        ['-5']
    ])('rejects an invalid amount %p before broadcasting anything', async (amount) => {
        const { client } = recordingClient();

        await expect(Utils.transferHiveEngineTokensMultiple(client, config, 'app', [
            { account: 'alice', amount: '1' },
            { account: 'bob', amount }
        ], 'BEE', 'memo')).rejects.toThrow(/Recipient 2 \(@bob\)/);

        expect(client.broadcast.json).not.toHaveBeenCalled();
    });

    test('rejects a missing account before broadcasting anything', async () => {
        const { client } = recordingClient();

        await expect(Utils.issueHiveEngineTokensMultiple(client, config, 'app', [
            { account: 'alice', amount: '1' },
            { account: '' }
        ], 'BEE', 'memo', '2')).rejects.toThrow('Recipient 2 is missing an account name');

        expect(client.broadcast.json).not.toHaveBeenCalled();
    });

    test('formats quantities without exponents and accepts numeric amounts', async () => {
        const { client, calls } = recordingClient();

        const result = await Utils.transferHiveEngineTokensMultiple(client, config, 'app', [
            { account: '@alice', amount: '0.0000001' },
            { account: 'bob', amount: 0.1 + 0.2 },
            { account: 'carol' }
        ], 'bee', 'memo', '1.5');

        const sent = JSON.parse(calls[0].json);
        expect(sent.map((op: any) => op.contractPayload.quantity)).toEqual(['0.0000001', '0.3', '1.5']);
        expect(sent.map((op: any) => op.contractPayload.to)).toEqual(['alice', 'bob', 'carol']);
        expect(sent[0].contractPayload.symbol).toBe('BEE');
        expect(result.failed).toEqual([]);
        expect(result.sent).toHaveLength(1);
        expect(result.sent[0].recipients).toEqual([
            { account: 'alice', quantity: '0.0000001' },
            { account: 'bob', quantity: '0.3' },
            { account: 'carol', quantity: '1.5' }
        ]);
    });

    test('reports a failed batch instead of throwing after earlier batches went out', async () => {
        const { client } = recordingClient([2]);
        const recipients = Array.from({ length: 60 }, (_, index) => ({ account: `user${index}`, amount: '1.00000000' }));

        const result = await Utils.issueHiveEngineTokensMultiple(client, config, 'app', recipients, 'BEE', 'a memo long enough to force a few batches');

        expect(client.broadcast.json.mock.calls.length).toBeGreaterThanOrEqual(3);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].batch).toBe(1);
        expect((result.failed[0].error as Error).message).toBe('broadcast 2 failed');
        expect(result.sent.map((batch) => batch.batch)).not.toContain(1);
        expect(result.sent.length + result.failed.length).toBe(client.broadcast.json.mock.calls.length);

        const accounted = [...result.sent, ...result.failed].flatMap((batch) => batch.recipients.map((recipient) => recipient.account));
        expect(accounted.sort()).toEqual(recipients.map((recipient) => recipient.account).sort());
        expect(JSON.parse(client.broadcast.json.mock.calls[0][0].json)[0].contractAction).toBe('issue');
    });
});

describe('Hive Engine stake, market and delegation quantities', () => {
    test('utils format numeric quantities and reject exponent strings', async () => {
        const { client, calls } = recordingClient();

        await Utils.stakeEngineTokens(client, config, 'app', 'app', 'BEE', 0.1 + 0.2);
        await Utils.unstakeEngineTokens(client, config, 'app', 'BEE', 1e-7);
        await Utils.delegateEngineTokens(client, config, 'app', 'bob', 'BEE', '5');
        await Utils.undelegateEngineTokens(client, config, 'app', 'bob', 'BEE', 2.5);
        await Utils.buyEngineTokens(client, config, 'app', 'BEE', 0.1 + 0.2, 0.7 + 0.1);
        await Utils.transferHiveEngineTokens(client, config, 'app', 'bob', 3, 'BEE');

        expect(calls.map((call) => JSON.parse(call.json).contractPayload.quantity)).toEqual(['0.3', '0.0000001', '5', '2.5', '0.3', '3']);
        expect(JSON.parse(calls[4].json).contractPayload.price).toBe('0.8');

        expect(() => Utils.stakeEngineTokens(client, config, 'app', 'app', 'BEE', '1e-7')).toThrow(/plain decimal/);
        expect(() => Utils.sellEngineTokens(client, config, 'app', 'BEE', '1', '-1')).toThrow(/Hive Engine price/);
        expect(() => Utils.transferHiveEngineTokens(client, config, 'app', 'bob', '0', 'BEE')).toThrow(/greater than zero/);
    });

    test('builders format quantities through BigNumber', () => {
        const streamer = {
            stakeEngineTokens: jest.fn(),
            unstakeEngineTokens: jest.fn(),
            delegateEngineTokens: jest.fn(),
            buyEngineTokens: jest.fn()
        } as any;

        new HiveEngineStakeBuilder(streamer).from('app').symbol('BEE').quantity(0.1 + 0.2).send();
        new HiveEngineUnstakeBuilder(streamer).from('app').symbol('BEE').quantity(1e-7).send();
        new HiveEngineDelegateBuilder(streamer).from('app').to('bob').symbol('BEE').quantity(2).send();
        new HiveEngineMarketOrderBuilder(streamer, 'buy').from('app').symbol('BEE').quantity('1.5').price(0.7 + 0.1).send();

        expect(streamer.stakeEngineTokens).toHaveBeenCalledWith('app', 'app', 'BEE', '0.3');
        expect(streamer.unstakeEngineTokens).toHaveBeenCalledWith('app', 'BEE', '0.0000001');
        expect(streamer.delegateEngineTokens).toHaveBeenCalledWith('app', 'bob', 'BEE', '2');
        expect(streamer.buyEngineTokens).toHaveBeenCalledWith('app', 'BEE', '1.5', '0.8');

        expect(() => new HiveEngineStakeBuilder(streamer).quantity('1e-7')).toThrow(/plain decimal/);
        expect(() => new HiveEngineStakeBuilder(streamer).quantity(0)).toThrow(/greater than zero/);
        expect(() => new HiveEngineMarketOrderBuilder(streamer, 'sell').price(-1)).toThrow(/Hive Engine price/);
    });
});
