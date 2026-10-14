import { createCoinflipContract } from '../../src/contracts/coinflip.contract';
import { FairnessManager, MemoryFairnessStore } from '../../src';
import { verifyOutcome } from '../../src/client';
import { createTestStreamer, TestStreamer } from '../../src/testing';

jest.mock('crypto', () => ({
    ...jest.requireActual('crypto'),
    randomUUID: jest.fn()
}));

import { randomUUID } from 'crypto';

const HOUSE = 'beggars';

describe('Coinflip Contract', () => {
    let ts: TestStreamer;
    let fairness: FairnessManager;

    async function setup(options: Parameters<typeof createCoinflipContract>[0] = {}, balances: Record<string, string> = { balance: '2000.000 HIVE', hbd_balance: '2000.000 HBD' }) {
        ts = await createTestStreamer({ username: HOUSE });
        ts.client.setAccount(HOUSE, balances);
        fairness = new FairnessManager({ store: new MemoryFairnessStore(), generateSeed: () => 'coinflip-spec-seed' });
        await ts.streamer.registerContract(createCoinflipContract({ fairness, ...options }));
    }

    const flip = (payload: Record<string, any>, amount = '9.000 HIVE') =>
        ts.contractTransfer({ from: 'testuser', amount, contract: 'coinflip', action: 'flip', payload });

    const results = async () => (await ts.getEvents()).filter((event) => event.contract === 'coinflip').map((event) => event.data.data);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('registers the contract with fairness on by default', async () => {
        ts = await createTestStreamer({ username: HOUSE });
        const contract = createCoinflipContract();
        await ts.streamer.registerContract(contract);

        expect(ts.streamer['contracts'].find((c: any) => c.name === 'coinflip')).not.toBeUndefined();
        expect((contract.actions as any).rotateSeed).toBeDefined();
    });

    test('pays winners 2x less the 2% house edge and sends nothing on a loss', async () => {
        await setup();

        for (let i = 0; i < 6; i++) {
            await flip({ guess: 'heads', seed: `seed-${i}` });
        }

        const settled = await results();
        await fairness.rotate();
        const revealed = await fairness.getRevealedSeed(0);

        settled.forEach((result) => {
            expect(verifyOutcome({ ...result.fairness, serverSeed: revealed!.serverSeed }, { type: 'coin' }, result.result).valid).toBe(true);
            expect(result.userWon).toBe(result.result === 'heads' ? 'true' : 'false');
        });

        const wins = settled.filter((result) => result.userWon === 'true');
        expect(wins.length).toBeGreaterThan(0);
        expect(wins.length).toBeLessThan(6);
        expect(ts.outgoingTransfers).toHaveLength(wins.length);
        ts.outgoingTransfers.forEach((transfer, index) => {
            // 9.000 x 2 x 0.98
            expect(transfer).toMatchObject({ from: HOUSE, to: 'testuser', amount: '17.640 HIVE' });
            expect(transfer.memo).toBe(`[Winner] | Guess: heads | Server Roll: heads | Fair: seed #0 nonce ${wins[index].fairness.nonce} commit ${wins[index].fairness.serverSeedHash}`);
        });
    });

    test('a minimum bet cannot win more than it risks', async () => {
        await setup({ notifyLosses: false });

        for (let i = 0; i < 6; i++) {
            await flip({ guess: 'tails', seed: `min-${i}` }, '0.001 HIVE');
        }

        // 0.001 x 1.96 rounds down to 0.001, and losses send nothing.
        expect(ts.outgoingTransfers.length).toBeGreaterThan(0);
        expect(ts.outgoingTransfers.every((transfer) => transfer.amount === '0.001 HIVE')).toBe(true);
    });

    test('houseEdge is configurable and validated', async () => {
        expect(() => createCoinflipContract({ account: HOUSE, houseEdge: 100 })).toThrow('houseEdge');
        expect(() => createCoinflipContract({ account: HOUSE, houseEdge: -1 })).toThrow('houseEdge');

        await setup({ houseEdge: 0 });

        for (let i = 0; i < 6 && ts.outgoingTransfers.length === 0; i++) {
            await flip({ guess: 'heads', seed: `edge-${i}` });
        }

        expect(ts.outgoingTransfers[0].amount).toBe('18.000 HIVE');
    });

    test('checks the HBD bankroll for HBD bets', async () => {
        await setup({ validCurrencies: ['HIVE', 'HBD'] }, { balance: '0.000 HIVE', hbd_balance: '100.000 HBD' });

        for (let i = 0; i < 6 && ts.outgoingTransfers.length === 0; i++) {
            await flip({ guess: 'heads', seed: `hbd-${i}` }, '5.000 HBD');
        }

        expect(ts.outgoingTransfers[0]).toMatchObject({ amount: '9.800 HBD' });
        expect(ts.outgoingTransfers[0].memo).toContain('[Winner]');
    });

    test('refunds an unknown guess instead of keeping the stake', async () => {
        await setup();

        await flip({ guess: 'edge' });
        await flip({ guess: 'HEADS' });

        expect(ts.outgoingTransfers.map((transfer) => [transfer.amount, transfer.memo])).toEqual([
            ['9.000 HIVE', '[Refund] Guess must be heads or tails.'],
            ['9.000 HIVE', '[Refund] Guess must be heads or tails.']
        ]);
        expect(fairness.getCommitment().nextNonce).toBe(0);
    });

    test('fairness: false keeps the legacy RNG and memo', async () => {
        (randomUUID as jest.Mock).mockReturnValue('j93jgsjghjdhgjfhgkfdhgkj34872394723');
        await setup({ fairness: false, notifyLosses: true });

        const { block } = await flip({ guess: 'heads', seed: 'tulips' });

        expect(ts.outgoingTransfers).toHaveLength(1);
        expect(ts.outgoingTransfers[0].memo).toMatch(/^\[(Winner|Lost)\] \| Guess: heads \| Server Roll: (heads|tails) \| Previous block id: /);
        expect(ts.outgoingTransfers[0].memo).toContain(`BlockID: ${block.block_id}`);
        expect(ts.outgoingTransfers[0].memo).toContain('Server Seed: j93jgsjghjdhgjfhgkfdhgkj34872394723');
    });
});
