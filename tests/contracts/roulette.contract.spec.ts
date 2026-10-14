import { createRouletteContract } from '../../src/contracts/roulette.contract';
import { FairnessManager, MemoryFairnessStore } from '../../src';
import { verifyOutcome } from '../../src/client';
import { createTestStreamer, TestStreamer } from '../../src/testing';

const HOUSE = 'beggars';

describe('Roulette Contract', () => {
    let ts: TestStreamer;
    let fairness: FairnessManager;

    async function setup(options: Parameters<typeof createRouletteContract>[0] = {}, balances: Record<string, string> = { balance: '2000.000 HIVE', hbd_balance: '2000.000 HBD' }) {
        ts = await createTestStreamer({ username: HOUSE });
        ts.client.setAccount(HOUSE, balances);
        fairness = new FairnessManager({ store: new MemoryFairnessStore(), generateSeed: () => 'roulette-spec-seed' });
        await ts.streamer.registerContract(createRouletteContract({ fairness, ...options }));
    }

    const spin = (payload: Record<string, any>, amount = '2.000 HIVE') =>
        ts.contractTransfer({ from: 'testuser', amount, contract: 'roulette', action: 'spin', payload });

    const results = async () => (await ts.getEvents()).filter((event) => event.data.action === 'spin_result').map((event) => event.data.data);

    afterEach(async () => {
        await ts?.stop();
    });

    test('registers the contract with fairness on by default', async () => {
        ts = await createTestStreamer({ username: HOUSE });
        const contract = createRouletteContract();
        await ts.streamer.registerContract(contract);

        expect(ts.streamer['contracts'].find((c: any) => c.name === 'roulette')).not.toBeUndefined();
        expect((contract.actions as any).rotateSeed).toBeDefined();
    });

    test('settles color bets at standard odds as the committed seed dictates', async () => {
        await setup();

        for (let i = 0; i < 8; i++) {
            await spin({ betType: 'color', value: 'red', seed: `spin-${i}` });
        }

        const settled = await results();
        await fairness.rotate();
        const revealed = await fairness.getRevealedSeed(0);

        settled.forEach((result) => {
            expect(verifyOutcome({ ...result.fairness, serverSeed: revealed!.serverSeed }, { type: 'roulette' }, result.winningNumber).valid).toBe(true);
            expect(result.result).toBe(result.winningColor === 'red' ? 'win' : 'lose');
        });

        const wins = settled.filter((result) => result.result === 'win');
        expect(wins.length).toBeGreaterThan(0);
        expect(wins.length).toBeLessThan(8);
        expect(ts.outgoingTransfers).toHaveLength(wins.length);
        ts.outgoingTransfers.forEach((transfer, index) => {
            expect(transfer).toMatchObject({ from: HOUSE, to: 'testuser', amount: '4.000 HIVE' });
            expect(transfer.memo).toContain(`[Winner] | Bet: color:red | Number: ${wins[index].winningNumber} | Color: red | Fair: seed #0`);
        });
    });

    test('a minimum bet pays whole multiples and losses cost the house nothing', async () => {
        await setup();

        for (let i = 0; i < 10; i++) {
            await spin({ betType: 'dozen', value: 2, seed: `min-${i}` }, '0.001 HIVE');
        }

        const wins = (await results()).filter((result) => result.result === 'win');

        expect(wins.length).toBeGreaterThan(0);
        expect(ts.outgoingTransfers).toHaveLength(wins.length);
        expect(ts.outgoingTransfers.every((transfer) => transfer.amount === '0.003 HIVE')).toBe(true);
    });

    test('loss notices are opt-in', async () => {
        await setup({ notifyLosses: true });

        // Straight-up on 0 loses 36 times out of 37.
        await spin({ betType: 'straight', value: 0 });

        const [result] = await results();
        expect(ts.outgoingTransfers).toHaveLength(1);

        if (result.result === 'lose') {
            expect(ts.outgoingTransfers[0]).toMatchObject({ amount: '0.001 HIVE' });
            expect(ts.outgoingTransfers[0].memo).toContain(`[Lost] | Bet: straight:0 | Number: ${result.winningNumber}`);
        }
    });

    test('checks the HBD bankroll for HBD bets', async () => {
        await setup({ validCurrencies: ['HIVE', 'HBD'] }, { balance: '0.000 HIVE', hbd_balance: '100.000 HBD' });

        await spin({ betType: 'color', value: 'black' }, '1.000 HBD');

        const [result] = await results();
        expect(result.asset).toBe('HBD');
        expect(ts.outgoingTransfers.every((transfer) => transfer.amount.endsWith(' HBD'))).toBe(true);
    });

    test('refunds invalid currency', async () => {
        await setup();

        await spin({ betType: 'range', value: 'low' }, '3.000 HBD');

        expect(ts.outgoingTransfers).toEqual([expect.objectContaining({ amount: '3.000 HBD', memo: '[Refund] You sent an invalid currency.' })]);
    });

    test('refunds invalid bets instead of keeping the stake', async () => {
        await setup();

        await spin({ betType: 'straight', value: 37 });
        await spin({ betType: 'corner', value: 1 });
        await spin({ betType: 'color', value: 'green' });
        await spin({ betType: 'dozen', value: 4 });

        expect(ts.outgoingTransfers.map((transfer) => [transfer.amount, transfer.memo])).toEqual([
            ['2.000 HIVE', '[Refund] Straight bets require a number between 0 and 36.'],
            ['2.000 HIVE', '[Refund] Bet type must be one of straight, color, parity, dozen, column, range.'],
            ['2.000 HIVE', '[Refund] Color bets must be red or black.'],
            ['2.000 HIVE', '[Refund] Dozen bets must be 1, 2, or 3.']
        ]);
        expect(fairness.getCommitment().nextNonce).toBe(0);
    });
});
