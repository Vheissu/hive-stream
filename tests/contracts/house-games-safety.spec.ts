/**
 * Money-safety checks shared by the built-in house games (dice, coinflip,
 * roulette, rps, lotto): one bet per paid operation, no double payouts after
 * a failed broadcast, and stakes refunded for bets the game cannot take.
 */
import {
    FairnessManager,
    MemoryFairnessStore,
    SqliteAdapter,
    Streamer,
    createCoinflipContract,
    createDiceContract,
    createLimboContract,
    createLottoContract,
    createRouletteContract,
    createRpsContract
} from '../../src';
import { createTestStreamer, TestStreamer } from '../../src/testing';
import { makeContext } from '../helpers/contract-context';

const HOUSE = 'house';

type GameCase = {
    game: string;
    factory: (options: any) => any;
    contract: string;
    action: string;
    payload: Record<string, any>;
    amount: string;
};

const games: GameCase[] = [
    { game: 'dice', factory: createDiceContract, contract: 'hivedice', action: 'roll', payload: { roll: 50 }, amount: '1.000 HIVE' },
    { game: 'coinflip', factory: createCoinflipContract, contract: 'coinflip', action: 'flip', payload: { guess: 'heads' }, amount: '1.000 HIVE' },
    { game: 'roulette', factory: createRouletteContract, contract: 'roulette', action: 'spin', payload: { betType: 'color', value: 'red' }, amount: '1.000 HIVE' },
    { game: 'rps', factory: createRpsContract, contract: 'rps', action: 'play', payload: { move: 'rock' }, amount: '1.000 HIVE' }
];

const limboCase: GameCase = { game: 'limbo', factory: createLimboContract, contract: 'limbo', action: 'bet', payload: { target: '2' }, amount: '1.000 HIVE' };

const lottoCase: GameCase = { game: 'lotto', factory: createLottoContract, contract: 'hivelotto', action: 'buy', payload: { type: 'hourly' }, amount: '1.000 HIVE' };

describe('house games: one bet per paid operation', () => {
    let ts: TestStreamer;

    afterEach(async () => {
        await ts?.stop();
    });

    async function setup(game: GameCase) {
        ts = await createTestStreamer({ username: HOUSE });
        ts.client.setAccount(HOUSE, { balance: '1000.000 HIVE', hbd_balance: '1000.000 HBD' });
        const contract = game.factory({ cost: 1, notifyLosses: true });
        // Simulates an operator who widened the recipient guard: the game
        // itself must still refuse transfers that did not pay the house.
        await ts.streamer.registerContract({ ...contract, guards: { allowedRecipients: [HOUSE, 'alice-alt'] } });
    }

    async function settledBets(game: GameCase): Promise<number> {
        if (game.game === 'lotto') {
            const rows = await ts.adapter.query('SELECT entries FROM lotto_draws');
            return rows.reduce((total: number, row: any) => total + JSON.parse(row.entries).length, 0);
        }

        return (await ts.getEvents()).filter((event) => event.contract === game.contract).length;
    }

    test.each([...games, lottoCase])('$game: extra transfers in the same transaction to another account get no bet', async (game) => {
        await setup(game);
        const memo = ts.contractMemo(game.contract, game.action, game.payload);

        await ts.sendOperations([
            ['transfer', { from: 'alice', to: HOUSE, amount: game.amount, memo }],
            ['transfer', { from: 'alice', to: 'alice-alt', amount: game.amount, memo }],
            ['transfer', { from: 'alice', to: 'alice-alt', amount: game.amount, memo }]
        ]);

        expect(await settledBets(game)).toBe(1);
        expect(ts.outgoingTransfers.every((transfer) => transfer.from === HOUSE && transfer.to === 'alice')).toBe(true);
        // At most one settlement transfer (lotto buys send none).
        expect(ts.outgoingTransfers.length).toBeLessThanOrEqual(1);
    });

    test.each([...games, lottoCase])('$game: a bet that is not the first operation of its transaction is verified at its own index', async (game) => {
        await setup(game);
        const memo = ts.contractMemo(game.contract, game.action, game.payload);

        await ts.sendOperations([
            ['transfer', { from: 'alice', to: 'someone-else', amount: '0.001 HIVE', memo: 'hi' }],
            ['transfer', { from: 'alice', to: HOUSE, amount: game.amount, memo }]
        ]);

        expect(await settledBets(game)).toBe(1);
    });
});

describe('house games: failed payouts are never paid twice', () => {
    let streamer: Streamer;

    beforeEach(async () => {
        streamer = new Streamer({ username: HOUSE });
        await streamer.registerAdapter(new SqliteAdapter(':memory:'));
        jest.spyOn(streamer.getClient().database, 'getAccounts').mockResolvedValue([{ balance: '1000.000 HIVE', hbd_balance: '1000.000 HBD' }] as any);
        jest.spyOn(streamer, 'getTransaction').mockImplementation(async () => ({
            operations: [['transfer', { from: 'alice', to: HOUSE, amount: '1.000 HIVE' }]]
        }) as any);
    });

    afterEach(async () => {
        await streamer.stop();
        jest.restoreAllMocks();
    });

    test.each([...games, limboCase])('$game: a payout broadcast that throws is not refunded, and a retry does not draw again', async (game) => {
        const fairness = new FairnessManager({ store: new MemoryFairnessStore() });
        // Loss notices on, so every outcome sends exactly one transfer.
        const contract = game.factory({ account: HOUSE, notifyLosses: true, fairness });
        await streamer.registerContract(contract);

        // The broadcast times out but may still have landed.
        const transfers = jest.spyOn(streamer, 'transferHiveTokens').mockRejectedValue(new Error('broadcast timeout'));
        const ctx = makeContext(streamer, { sender: 'alice', amount: '1.000 HIVE', to: HOUSE });

        await expect(contract.actions[game.action].handler(game.payload, ctx)).rejects.toThrow('broadcast timeout');
        expect(transfers).toHaveBeenCalledTimes(1);
        expect(transfers.mock.calls[0][4]).not.toContain('[Refund]');

        // errorPolicy: 'retry' runs the same operation again.
        transfers.mockResolvedValue(true as any);
        await contract.actions[game.action].handler(game.payload, ctx);

        expect(transfers).toHaveBeenCalledTimes(1);
        expect(fairness.getCommitment().nextNonce).toBe(1);
    });

    test.each(games)('$game: a failure before any transfer refunds the stake once', async (game) => {
        const contract = game.factory({ account: HOUSE, fairness: { store: new MemoryFairnessStore() } });
        await streamer.registerContract(contract);

        const transfers = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);
        jest.spyOn(streamer.getAdapter(), 'addEvent').mockRejectedValue(new Error('database write failed'));
        const ctx = makeContext(streamer, { sender: 'alice', amount: '1.000 HIVE', to: HOUSE });

        await expect(contract.actions[game.action].handler(game.payload, ctx)).rejects.toThrow('database write failed');
        expect(transfers).toHaveBeenCalledTimes(1);
        expect(transfers).toHaveBeenCalledWith(HOUSE, 'alice', '1.000', 'HIVE', '[Refund] Processing error occurred.');

        // A retry does not refund again.
        await contract.actions[game.action].handler(game.payload, ctx);
        expect(transfers).toHaveBeenCalledTimes(1);
    });

    test.each(games)('$game: a transfer that did not pay the house is rejected without moving money', async (game) => {
        const contract = game.factory({ account: HOUSE });
        await streamer.registerContract(contract);
        const transfers = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);

        await expect(contract.actions[game.action].handler(game.payload, makeContext(streamer, { sender: 'alice', amount: '1.000 HIVE', to: 'alice-alt' })))
            .rejects.toThrow(`Bets must be sent to ${HOUSE}`);
        expect(transfers).not.toHaveBeenCalled();
    });
});
