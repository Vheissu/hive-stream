import { createDiceContract } from '../../src/contracts/dice.contract';
import { FairnessManager, MemoryFairnessStore } from '../../src';
import { verifyOutcome } from '../../src/client';
import { createTestStreamer, TestStreamer } from '../../src/testing';

const HOUSE = 'beggars';

describe('Dice Contract', () => {
    let ts: TestStreamer;
    let fairness: FairnessManager;

    async function setup(options: Parameters<typeof createDiceContract>[0] = {}, balances: Record<string, string> = { balance: '2000.000 HIVE', hbd_balance: '2000.000 HBD' }) {
        ts = await createTestStreamer({ username: HOUSE });
        ts.client.setAccount(HOUSE, balances);
        fairness = new FairnessManager({ store: new MemoryFairnessStore(), generateSeed: () => 'dice-spec-seed' });
        await ts.streamer.registerContract(createDiceContract({ name: 'testdice', fairness, houseEdge: 5, ...options }));
    }

    const roll = (payload: Record<string, any>, amount = '9.000 HIVE', from = 'testuser') =>
        ts.contractTransfer({ from, amount, contract: 'testdice', action: 'roll', payload });

    const results = async () => (await ts.getEvents()).filter((event) => event.data.action === 'dice_result').map((event) => event.data.data);

    afterEach(async () => {
        await ts?.stop();
    });

    test('registers the dice contract with fairness on by default', async () => {
        ts = await createTestStreamer({ username: HOUSE });
        const contract = createDiceContract({ name: 'testdice' });
        await ts.streamer.registerContract(contract);

        expect(ts.streamer['contracts'].find((c: any) => c.name === 'testdice')).not.toBeUndefined();
        expect((contract.actions as any).rotateSeed).toBeDefined();
        expect((createDiceContract({ account: HOUSE, fairness: false }).actions as any).rotateSeed).toBeUndefined();
    });

    test('settles every roll exactly as the committed seed dictates', async () => {
        await setup();

        for (let i = 0; i < 6; i++) {
            await roll({ roll: 50 });
        }

        const settled = await results();
        expect(settled).toHaveLength(6);

        await fairness.rotate();
        const revealed = await fairness.getRevealedSeed(0);

        settled.forEach((result) => {
            const check = verifyOutcome({ ...result.fairness, serverSeed: revealed!.serverSeed }, result.outcomeSpec, result.roll);
            expect(check.valid).toBe(true);
            expect(result.result).toBe(result.roll < 50 ? 'win' : 'lose');
        });

        // 0.95 x 100 / 50 = 1.9x; losses send nothing by default.
        const wins = settled.filter((result) => result.result === 'win');
        expect(wins.length).toBeGreaterThan(0);
        expect(wins.length).toBeLessThan(6);
        expect(ts.outgoingTransfers).toHaveLength(wins.length);
        ts.outgoingTransfers.forEach((transfer, index) => {
            expect(transfer).toMatchObject({ from: HOUSE, to: 'testuser', amount: '17.100 HIVE' });
            expect(transfer.memo).toBe(`You won 17.100 HIVE. Roll: ${wins[index].roll}, Your guess: 50 | Fair: seed #0 nonce ${wins[index].fairness.nonce} commit ${wins[index].fairness.serverSeedHash}`);
        });
    });

    test('sends a loss notice only when notifyLosses is enabled', async () => {
        await setup({ notifyLosses: true });

        // A roll of 2 only wins on a 1, so this loses unless the draw is 1.
        await roll({ roll: 2 });

        const [result] = await results();
        expect(ts.outgoingTransfers).toHaveLength(1);

        if (result.result === 'lose') {
            expect(ts.outgoingTransfers[0]).toMatchObject({ amount: '0.001 HIVE' });
            expect(ts.outgoingTransfers[0].memo).toContain(`You lost 9.000 HIVE. Roll: ${result.roll}, Your guess: 2`);
        }
    });

    test('checks the HBD bankroll for HBD bets and pays out in HBD', async () => {
        await setup({ validCurrencies: ['HIVE', 'HBD'] }, { balance: '0.000 HIVE', hbd_balance: '2000.000 HBD' });

        // 95% win chance per roll; stop at the first win.
        for (let i = 0; i < 10 && ts.outgoingTransfers.length === 0; i++) {
            await roll({ roll: 96 }, '5.000 HBD');
        }

        expect(ts.outgoingTransfers.length).toBeGreaterThan(0);
        expect(ts.outgoingTransfers.every((transfer) => transfer.amount.endsWith(' HBD'))).toBe(true);
        expect(ts.outgoingTransfers[0].memo).toMatch(/^You won 4\.947 HBD/);
    });

    test('refunds HIVE bets when only the HBD balance could cover them', async () => {
        await setup({ validCurrencies: ['HIVE', 'HBD'] }, { balance: '0.000 HIVE', hbd_balance: '2000.000 HBD' });

        await roll({ roll: 50 }, '5.000 HIVE');

        expect(ts.outgoingTransfers).toEqual([expect.objectContaining({ amount: '5.000 HIVE', memo: '[Refund] The server could not fulfill your bet.' })]);
    });

    test('refunds rolls outside 2-96 instead of keeping the stake', async () => {
        await setup();

        await roll({ roll: 1 });
        await roll({ roll: 97 });
        await roll({ roll: 50.5 });
        await roll({ roll: 50, seed: 'x'.repeat(65) });

        expect(ts.outgoingTransfers.map((transfer) => [transfer.amount, transfer.memo])).toEqual([
            ['9.000 HIVE', '[Refund] Roll must be a whole number between 2 and 96.'],
            ['9.000 HIVE', '[Refund] Roll must be a whole number between 2 and 96.'],
            ['9.000 HIVE', '[Refund] Roll must be a whole number between 2 and 96.'],
            ['9.000 HIVE', '[Refund] Seed must be a string of at most 64 characters.']
        ]);
        expect(fairness.getCommitment().nextNonce).toBe(0);
    });

    test('rejects a house edge given as a percentage', () => {
        expect(() => createDiceContract({ account: HOUSE, houseEdge: 150 })).toThrow('houseEdge');
    });
});
