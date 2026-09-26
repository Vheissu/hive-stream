import { FairnessManager, MemoryFairnessStore, SqliteAdapter, Streamer, createLimboContract } from '../../src';
import { deriveOutcome, verifyOutcome } from '../../src/client';
import { makeContext } from '../helpers/contract-context';

describe('limbo contract', () => {
    let streamer: Streamer;
    let transfers: jest.SpyInstance;
    let events: any[];
    let fairness: FairnessManager;
    let contract: ReturnType<typeof createLimboContract>;
    let balance: string;

    const bet = (player: string, amount: string, target: any, extra: Record<string, any> = {}, ctxOptions: Record<string, any> = {}) =>
        contract.actions.bet.handler({ target, ...extra }, makeContext(streamer, { sender: player, amount, to: 'house', ...ctxOptions }));

    const lastEvent = () => events[events.length - 1][4];

    beforeEach(async () => {
        streamer = new Streamer();
        const adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);

        events = [];
        jest.spyOn(adapter, 'addEvent').mockImplementation(async (...args: any[]) => {
            events.push(args);
            return true;
        });
        transfers = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);
        balance = '10000.000 HIVE';
        jest.spyOn(streamer.getClient().database, 'getAccounts').mockImplementation(async () => [{ balance, hbd_balance: '100000.000 HBD' }] as any);

        fairness = new FairnessManager({ store: new MemoryFairnessStore(), generateSeed: () => 'fixed-server-seed' });
        contract = createLimboContract({ account: 'house', assets: ['HIVE', 'HBD'], minBet: '1', maxBet: '100', maxTarget: '100', fairness });
        await streamer.registerContract(contract);
    });

    afterEach(async () => {
        await streamer.stop();
        jest.restoreAllMocks();
    });

    test('validates options', () => {
        expect(() => createLimboContract({ account: 'h', houseEdgeBps: 10000 })).toThrow('houseEdgeBps');
        expect(() => createLimboContract({ account: 'h', minTarget: '1.00' })).toThrow('Targets');
        expect(() => createLimboContract({ account: 'h', maxPayoutBankrollBps: 0 })).toThrow('maxPayoutBankrollBps');
        expect((createLimboContract({ account: 'h' }).actions as Record<string, unknown>).rotateSeed).toBeDefined();
    });

    test('settles wins and losses exactly as the committed seed dictates', async () => {
        const ctxBlock = 'b10c';
        const expected = deriveOutcome(
            { serverSeed: 'fixed-server-seed', clientSeed: 'alice', nonce: 0, entropy: ctxBlock },
            { type: 'crash', houseEdgeBps: 100 }
        );

        // Aim just below the result so the bet must win.
        const target = Math.max(101, expected.multiplierCents);
        await bet('alice', '10.000 HIVE', (target / 100).toFixed(2), {}, { blockId: ctxBlock });

        const result = lastEvent().data;
        expect(result.result).toBe(expected.multiplier);
        expect(result.won).toBe(expected.multiplierCents >= target);

        if (result.won) {
            const payout = (10 * target / 100).toFixed(3);
            expect(transfers).toHaveBeenCalledWith('house', 'alice', payout, 'HIVE', expect.stringContaining(`Result ${expected.multiplier}x`));
        }

        await fairness.rotate();
        const revealed = await fairness.getRevealedSeed(0);
        const check = verifyOutcome({ ...result.fairness, serverSeed: revealed!.serverSeed }, result.outcomeSpec, {
            multiplierCents: expected.multiplierCents,
            multiplier: expected.multiplier
        });
        expect(check.valid).toBe(true);
    });

    test('a losing bet sends nothing by default and records the result', async () => {
        let blockId = '';
        for (let i = 0; i < 100; i++) {
            const outcome = deriveOutcome({ serverSeed: 'fixed-server-seed', clientSeed: 'bob', nonce: 0, entropy: `L${i}` }, { type: 'crash', houseEdgeBps: 100 });
            if (outcome.multiplierCents < 1000) {
                blockId = `L${i}`;
                break;
            }
        }

        await bet('bob', '5.000 HIVE', '10', {}, { blockId });
        const result = lastEvent().data;

        expect(result.won).toBe(false);
        expect(result.payout).toBe('0.000');
        expect(transfers).not.toHaveBeenCalled();
    });

    test('pays bet x target rounded down to 3 decimals', async () => {
        // Find a nonce/blockId combination that wins at 1.33x.
        let blockId = '';
        for (let i = 0; i < 100; i++) {
            const candidate = `b${i}`;
            const outcome = deriveOutcome({ serverSeed: 'fixed-server-seed', clientSeed: 'carol', nonce: 0, entropy: candidate }, { type: 'crash', houseEdgeBps: 100 });
            if (outcome.multiplierCents >= 133) {
                blockId = candidate;
                break;
            }
        }

        await bet('carol', '1.001 HIVE', '1.33', {}, { blockId });
        expect(transfers.mock.calls[0][2]).toBe('1.331');
    });

    test('refunds invalid bets without drawing a nonce', async () => {
        await bet('alice', '10.000 HBD', '2');
        expect(lastEvent().action).toBe('limbo_result');
        expect(lastEvent().data.asset).toBe('HBD');
        transfers.mockClear();

        const limited = createLimboContract({ name: 'hiveonly', account: 'house', minBet: '1', maxBet: '100', fairness: { store: new MemoryFairnessStore() } });
        await streamer.registerContract(limited);
        await limited.actions.bet.handler({ target: '2' }, makeContext(streamer, { sender: 'alice', amount: '10.000 HBD', to: 'house' }));

        await bet('alice', '0.500 HIVE', '2');
        await bet('alice', '101.000 HIVE', '2');
        await bet('alice', '10.000 HIVE', '1.00');
        await bet('alice', '10.000 HIVE', '100.01');
        await bet('alice', '10.000 HIVE', '2.555');
        await bet('alice', '10.000 HIVE', undefined);

        expect(transfers.mock.calls.map((call) => call[4])).toEqual([
            '[Refund] Unsupported asset HBD',
            '[Refund] Bets must be between 1.000 and 100.000 HIVE',
            '[Refund] Bets must be between 1.000 and 100.000 HIVE',
            '[Refund] Target must be between 1.01x and 100.00x',
            '[Refund] Target must be between 1.01x and 100.00x',
            '[Refund] Target must be between 1.01x and 100.00x',
            '[Refund] Target must be between 1.01x and 100.00x'
        ]);
        // Only the valid HBD bet consumed a nonce.
        expect(fairness.getCommitment().nextNonce).toBe(1);

        await expect(bet('alice', '10.000 HIVE', '2', {}, { to: 'not-house' })).rejects.toThrow('must be sent to house');
    });

    test('caps payouts against the bankroll and an absolute maximum', async () => {
        balance = '1000.000 HIVE';
        // 1% of 1000 = 10 max payout
        await bet('alice', '5.000 HIVE', '3');
        expect(transfers.mock.calls[0][4]).toBe('[Refund] The house cannot cover this payout right now');

        const capped = createLimboContract({ name: 'capped', account: 'house', maxPayout: '15', maxPayoutBankrollBps: 10000, fairness: { store: new MemoryFairnessStore() } });
        await streamer.registerContract(capped);
        await capped.actions.bet.handler({ target: '2' }, makeContext(streamer, { sender: 'bob', amount: '10.000 HIVE', to: 'house' }));
        expect(transfers.mock.calls[1][4]).toBe('[Refund] Maximum payout is 15.000 HIVE');
    });

    test('bets are serialized so concurrent payouts respect the bankroll', async () => {
        balance = '2000.000 HIVE';
        // Each bet can pay 10 (1% of 2000 = 20 cap); in-flight payouts are reserved while settling.
        await Promise.all([
            bet('a1', '5.000 HIVE', '2'),
            bet('a2', '5.000 HIVE', '2'),
            bet('a3', '5.000 HIVE', '2')
        ]);

        const nonces = events.filter((event) => event[4].action === 'limbo_result').map((event) => event[4].data.fairness.nonce);
        expect(nonces).toEqual([0, 1, 2]);
    });

    test('refunds the stake when a draw cannot be produced', async () => {
        await expect(bet('alice', '10.000 HIVE', '2', {}, { blockId: '' })).rejects.toThrow('blockId');
        expect(transfers).toHaveBeenCalledWith('house', 'alice', '10.000', 'HIVE', '[Refund] The bet could not be settled');
    });
});
