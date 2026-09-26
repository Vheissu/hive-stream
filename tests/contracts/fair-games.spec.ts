import {
    FairnessManager,
    MemoryFairnessStore,
    SqliteAdapter,
    Streamer,
    createCoinflipContract,
    createDiceContract,
    createLottoContract,
    createRouletteContract,
    createRpsContract
} from '../../src';
import { verifyOutcome, sha256Hex } from '../../src/client';
import { createMockAdapter } from '../helpers/mock-adapter';
import { makeContext } from '../helpers/contract-context';

async function revealProof(manager: FairnessManager, proof: any) {
    await manager.rotate();
    const revealed = await manager.getRevealedSeed(proof.seedIndex);
    return { ...proof, serverSeed: revealed!.serverSeed };
}

describe('provably-fair game modes', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;
    let transfers: jest.SpyInstance;
    let events: any[];

    beforeEach(async () => {
        streamer = new Streamer({ JSON_ID: 'hivestream', PAYLOAD_IDENTIFIER: 'hive_stream' });
        adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);

        events = [];
        jest.spyOn(adapter, 'addEvent').mockImplementation(async (...args: any[]) => {
            events.push(args);
            return true;
        });
        transfers = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(streamer, 'getTransaction').mockResolvedValue({} as any);
        jest.spyOn(streamer, 'verifyTransfer').mockResolvedValue(true as any);
        jest.spyOn(streamer.getClient().database, 'getAccounts').mockResolvedValue([{ balance: '100000.000 HIVE', hbd_balance: '0.000 HBD' }] as any);
    });

    afterEach(async () => {
        await streamer.stop();
        jest.restoreAllMocks();
    });

    test('dice settles with a committed seed and the result verifies after rotation', async () => {
        const fairness = new FairnessManager();
        const contract = createDiceContract({ name: 'fairdice', account: 'house', fairness });
        await streamer.registerContract(contract);

        const commitment = fairness.getCommitment();
        const ctx = makeContext(streamer, { sender: 'alice', amount: '5.000 HIVE', to: 'house' });
        await contract.actions.roll.handler({ roll: 50, seed: 'lucky' }, ctx);

        const [, , , , data] = events.find((event) => event[4]?.action === 'dice_result');
        const { fairness: proof, roll } = data.data;

        expect(proof).toEqual(expect.objectContaining({
            scope: 'fairdice',
            seedIndex: 0,
            nonce: 0,
            clientSeed: 'lucky',
            serverSeedHash: commitment.serverSeedHash,
            entropy: ctx.block.id
        }));

        const memo = transfers.mock.calls[0][4];
        expect(memo).toContain(`Roll: ${roll}`);
        expect(memo).toContain(`commit ${commitment.serverSeedHash}`);

        const check = verifyOutcome(await revealProof(fairness, proof), { type: 'dice', sides: 100 }, roll);
        expect(check.valid).toBe(true);
    });

    test('coinflip uses the player account as the default client seed', async () => {
        const fairness = new FairnessManager();
        const contract = createCoinflipContract({ name: 'fairflip', account: 'house', fairness });
        await streamer.registerContract(contract);

        await contract.actions.flip.handler({ guess: 'heads' }, makeContext(streamer, { sender: 'bob', amount: '1.000 HIVE', to: 'house' }));

        const data = events[0][4].data;
        expect(data.fairness.clientSeed).toBe('bob');
        expect(data.serverSeed).toBeUndefined();

        const check = verifyOutcome(await revealProof(fairness, data.fairness), { type: 'coin' }, data.result);
        expect(check.valid).toBe(true);
        expect(data.userWon).toBe(data.result === 'heads' ? 'true' : 'false');
    });

    test('roulette and rps record verifiable proofs', async () => {
        const rouletteFairness = new FairnessManager();
        const roulette = createRouletteContract({ name: 'fairroulette', account: 'house', fairness: rouletteFairness });
        const rpsFairness = new FairnessManager();
        const rps = createRpsContract({ name: 'fairrps', account: 'house', fairness: rpsFairness });
        await streamer.registerContract(roulette);
        await streamer.registerContract(rps);

        await roulette.actions.spin.handler({ betType: 'color', value: 'red' }, makeContext(streamer, { sender: 'carol', amount: '1.000 HIVE', to: 'house' }));
        await rps.actions.play.handler({ move: 'rock' }, makeContext(streamer, { sender: 'dave', amount: '1.000 HIVE', to: 'house' }));

        const spin = events.find((event) => event[4]?.action === 'spin_result')[4].data;
        const play = events.find((event) => event[4]?.action === 'rps_result')[4].data;

        expect(verifyOutcome(await revealProof(rouletteFairness, spin.fairness), { type: 'roulette' }, spin.winningNumber).valid).toBe(true);

        const moveIndex = ['rock', 'paper', 'scissors'].indexOf(play.serverMove);
        expect(verifyOutcome(await revealProof(rpsFairness, play.fairness), { type: 'int', min: 0, max: 2 }, moveIndex).valid).toBe(true);
    });

    test('rotateSeed is restricted to the house account and reveals the seed in an event', async () => {
        const contract = createDiceContract({ name: 'rotdice', account: 'house', fairness: true });
        await streamer.registerContract(contract);

        const rotate = (contract.actions as any).rotateSeed;
        expect(rotate.requiresActiveKey).toBe(true);

        await expect(rotate.handler({}, makeContext(streamer, { sender: 'mallory' }))).rejects.toThrow('Only house');
        await rotate.handler({}, makeContext(streamer, { sender: 'house' }));

        const rotation = events.find((event) => event[4]?.action === 'fairness_seed_rotated')[4].data;
        expect(rotation.revealed.seedIndex).toBe(0);
        expect(sha256Hex(rotation.revealed.serverSeed)).toBe(rotation.revealed.serverSeedHash);
        expect(rotation.commitment.seedIndex).toBe(1);
    });

    test('legacy mode is unchanged when fairness is not configured', () => {
        const contract = createDiceContract({ account: 'beggars', name: 'legacy' });
        expect((contract.actions as any).rotateSeed).toBeUndefined();
    });
});

describe('provably-fair lotto draws', () => {
    test('winners come from a verifiable pick seeded by every entry', async () => {
        const streamer = new Streamer();
        const adapter = createMockAdapter();
        await streamer.registerAdapter(adapter);

        const fairness = new FairnessManager({ store: new MemoryFairnessStore() });
        const contract = createLottoContract({ name: 'fairlotto', account: 'house', feeAccount: 'house', minEntriesHourly: 3, hourlyWinnersPick: 2, fairness });
        await streamer.registerContract(contract);

        const entries = ['a1', 'b2', 'c3', 'd4', 'e5'].map((account, index) => ({ account, transactionId: `tx-${index}` }));
        const draw = { _id: 'draw-1', status: 'active', type: 'hourly', entries };

        jest.spyOn(adapter, 'find').mockResolvedValue([draw] as any);
        const replace = jest.spyOn(adapter, 'replace').mockResolvedValue(true as any);
        const multiple = jest.spyOn(streamer, 'transferHiveTokensMultiple').mockResolvedValue(true as any);
        jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(streamer.getClient().database, 'getAccounts').mockResolvedValue([{ balance: '1000.000 HIVE' }] as any);

        await contract.actions.drawHourlyLottery.handler({}, makeContext(streamer, { sender: 'house', trigger: 'time' }));

        const recorded = replace.mock.calls.map((call) => call[2]).find((doc: any) => doc.fairness);
        expect(recorded.winners).toHaveLength(2);
        expect(recorded.fairness.clientSeed).toBe(sha256Hex('tx-0,tx-1,tx-2,tx-3,tx-4'));

        await fairness.rotate();
        const revealed = await fairness.getRevealedSeed(0);
        const check = verifyOutcome({ ...recorded.fairness, serverSeed: revealed!.serverSeed }, { type: 'pick', count: 2, total: 5 });
        expect(check.valid).toBe(true);
        expect((check.outcome as number[]).map((index) => entries[index].account)).toEqual(recorded.winners);
        expect(multiple.mock.calls[0][1]).toEqual(recorded.winners);

        await streamer.stop();
    });
});
