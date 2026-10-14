import BigNumber from 'bignumber.js';
import { SqliteAdapter, Streamer, calculateTournamentPayouts, createTournamentContract } from '../../src';
import { makeContext } from '../helpers/contract-context';

const ranked = (entries: Array<[string, number]>) => entries.map(([player, score], index) => ({
    player,
    score: new BigNumber(score),
    submittedAt: '',
    submissionIndex: index + 1
}));

describe('calculateTournamentPayouts', () => {
    test('splits the pool by basis points and assigns dust to first place', () => {
        const payouts = calculateTournamentPayouts(ranked([['a', 30], ['b', 20], ['c', 10]]), [5000, 3000, 2000], new BigNumber('10.001'), 'split');

        expect(payouts).toEqual([
            { player: 'a', rank: 1, amount: '5.001' },
            { player: 'b', rank: 2, amount: '3.000' },
            { player: 'c', rank: 3, amount: '2.000' }
        ]);
    });

    test('tied players share the prizes of the positions they occupy', () => {
        const payouts = calculateTournamentPayouts(ranked([['a', 50], ['b', 40], ['c', 40], ['d', 10]]), [5000, 3000, 2000], new BigNumber('100'), 'split');

        expect(payouts).toEqual([
            { player: 'a', rank: 1, amount: '50.000' },
            { player: 'b', rank: 2, amount: '25.000' },
            { player: 'c', rank: 2, amount: '25.000' }
        ]);
    });

    test('earliest tie-break keeps submission order', () => {
        const payouts = calculateTournamentPayouts(ranked([['a', 40], ['b', 40]]), [7000, 3000], new BigNumber('10'), 'earliest');

        expect(payouts.map((payout) => [payout.player, payout.amount])).toEqual([['a', '7.000'], ['b', '3.000']]);
    });

    test('redistributes unused prize positions over the players who scored', () => {
        const payouts = calculateTournamentPayouts(ranked([['a', 3], ['b', 2]]), [5000, 3000, 2000], new BigNumber('80'), 'split');

        expect(payouts).toEqual([
            { player: 'a', rank: 1, amount: '50.000' },
            { player: 'b', rank: 2, amount: '30.000' }
        ]);
    });

    test('never pays more than the pool, even with thirds', () => {
        const payouts = calculateTournamentPayouts(ranked([['a', 1], ['b', 1], ['c', 1]]), [10000], new BigNumber('10'), 'split');
        const total = payouts.reduce((sum, payout) => sum.plus(payout.amount), new BigNumber(0));

        expect(total.toFixed(3)).toBe('10.000');
        expect(payouts.map((payout) => payout.amount)).toEqual(['3.334', '3.333', '3.333']);
    });
});

describe('tournament contract', () => {
    let streamer: Streamer;
    let adapter: SqliteAdapter;
    let transfers: jest.SpyInstance;
    let contract: ReturnType<typeof createTournamentContract>;

    const REG_OPEN = '2026-05-01T00:00:00Z';
    const DURING = '2026-05-01T12:00:00Z';
    const AFTER_CLOSE = '2026-05-02T12:00:00Z';

    const create = (overrides: Record<string, any> = {}, sender = 'organizer') => contract.actions.createTournament.handler({
        tournamentId: 'cup-1',
        title: 'Spring Cup',
        asset: 'HIVE',
        entryFee: '10.000',
        registrationOpensAt: REG_OPEN,
        registrationClosesAt: '2026-05-02T00:00:00Z',
        endsAt: '2026-05-03T00:00:00Z',
        minPlayers: 2,
        maxPlayers: 4,
        prizeSplitBps: [7000, 3000],
        oracle: 'gameserver',
        scoreOrder: 'desc',
        tieBreak: 'split',
        ...overrides
    } as any, makeContext(streamer, { sender, time: REG_OPEN }));

    const enter = (player: string, amount = '10.000 HIVE', time = DURING, tournamentId = 'cup-1', to = 'host') =>
        contract.actions.enter.handler({ tournamentId }, makeContext(streamer, { sender: player, amount, to, time }));

    const score = (player: string, value: number | string, sender = 'gameserver', time = AFTER_CLOSE) =>
        contract.actions.submitScore.handler({ tournamentId: 'cup-1', player, score: value }, makeContext(streamer, { sender, time }));

    const finalize = (sender = 'organizer', time = AFTER_CLOSE) =>
        contract.actions.finalize.handler({ tournamentId: 'cup-1' }, makeContext(streamer, { sender, time }));

    beforeEach(async () => {
        streamer = new Streamer();
        adapter = new SqliteAdapter(':memory:');
        await streamer.registerAdapter(adapter);
        transfers = jest.spyOn(streamer, 'transferHiveTokens').mockResolvedValue(true as any);
        // Creation is open (no organizers), so scores come from the app or a configured oracle.
        contract = createTournamentContract({ account: 'host', feeBps: 1000, feeAccount: 'treasury', oracles: ['gameserver'] });
        await streamer.registerContract(contract);
    });

    afterEach(async () => {
        await streamer.stop();
        jest.restoreAllMocks();
    });

    test('validates tournament definitions', async () => {
        await expect(create({ prizeSplitBps: [6000, 3000] })).rejects.toThrow('10000');
        await expect(create({ minPlayers: 5, maxPlayers: 4 })).rejects.toThrow('minPlayers');
        await expect(create({ registrationClosesAt: REG_OPEN })).rejects.toThrow('close after');
        await expect(create({ endsAt: '2026-05-01T06:00:00Z' })).rejects.toThrow('end before');
        await create();
        await expect(create()).rejects.toThrow('already exists');
    });

    test('runs a full tournament: entries, oracle scores, fee and prizes', async () => {
        await create();
        await enter('alice');
        await enter('bob');
        await enter('carol');

        await expect(score('alice', 10, 'alice')).rejects.toThrow('not authorised');
        await expect(score('alice', 10, 'gameserver', DURING)).rejects.toThrow('after registration closes');
        await expect(score('mallory', 10)).rejects.toThrow('not entered');

        await score('alice', 120);
        await score('bob', 300);
        await score('carol', '95.5');
        await finalize();

        // Pot 30, fee 10% = 3, pool 27 split 70/30.
        expect(transfers.mock.calls).toEqual([
            ['host', 'bob', '18.900', 'HIVE', 'Spring Cup: rank #1 prize'],
            ['host', 'alice', '8.100', 'HIVE', 'Spring Cup: rank #2 prize'],
            ['host', 'treasury', '3.000', 'HIVE', 'Spring Cup: house fee']
        ]);

        const payouts = await adapter.query('SELECT player, status FROM tournament_payouts ORDER BY rank');
        expect(payouts).toEqual([{ player: 'bob', status: 'paid' }, { player: 'alice', status: 'paid' }]);

        await expect(finalize()).rejects.toThrow('is finalized');
        expect(transfers).toHaveBeenCalledTimes(3);
    });

    test('refunds wrong assets, wrong amounts, duplicates, late and full entries', async () => {
        await create({ maxPlayers: 2 });

        await enter('alice', '10.000 HBD');
        await enter('alice', '9.000 HIVE');
        await enter('alice', '10.000 HIVE', '2026-04-30T00:00:00Z');
        await enter('alice');
        await enter('alice');
        await enter('bob');
        await enter('carol');
        await enter('dave', '10.000 HIVE', DURING, 'missing-cup');

        const reasons = transfers.mock.calls.map((call) => call[4]);
        expect(reasons).toEqual([
            '[Refund] Entry fee must be paid in HIVE',
            '[Refund] Entry fee is exactly 10.000 HIVE',
            '[Refund] Registration is not open',
            '[Refund] You are already entered',
            '[Refund] Tournament is full',
            '[Refund] Tournament missing-cup does not exist'
        ]);

        const [tournament] = await adapter.query('SELECT pot FROM tournaments');
        expect(tournament.pot).toBe('20.000');

        await expect(enter('erin', '10.000 HIVE', DURING, 'cup-1', 'elsewhere')).rejects.toThrow('must be sent to host');
    });

    test('ignores a replayed entry transfer', async () => {
        await create();
        const ctx = makeContext(streamer, { sender: 'alice', amount: '10.000 HIVE', to: 'host', time: DURING, transactionId: 'same-trx' });

        await contract.actions.enter.handler({ tournamentId: 'cup-1' }, ctx);
        await contract.actions.enter.handler({ tournamentId: 'cup-1' }, ctx);

        expect(transfers).not.toHaveBeenCalled();
        expect(await adapter.query('SELECT player FROM tournament_entries')).toHaveLength(1);
    });

    test('cancels and refunds under-subscribed tournaments', async () => {
        await create({ minPlayers: 3 });
        await enter('alice');
        await enter('bob');
        await finalize();

        expect(transfers.mock.calls.map((call) => [call[1], call[2]])).toEqual([['alice', '10.000'], ['bob', '10.000']]);
        const [tournament] = await adapter.query('SELECT status, status_reason FROM tournaments');
        expect(tournament).toEqual({ status: 'cancelled', status_reason: 'Not enough players' });
    });

    test('refunds everyone when no scores were submitted', async () => {
        await create();
        await enter('alice');
        await enter('bob');
        await finalize();

        expect(transfers).toHaveBeenCalledTimes(2);
        expect(transfers.mock.calls[0][4]).toContain('No scores were submitted');
    });

    test('organizer cancellation refunds each entry exactly once', async () => {
        await create();
        await enter('alice');
        await enter('bob');

        await expect(contract.actions.cancelTournament.handler({ tournamentId: 'cup-1' }, makeContext(streamer, { sender: 'alice' })))
            .rejects.toThrow('Only the organizer');
        await contract.actions.cancelTournament.handler({ tournamentId: 'cup-1' }, makeContext(streamer, { sender: 'organizer' }));
        await expect(contract.actions.cancelTournament.handler({ tournamentId: 'cup-1' }, makeContext(streamer, { sender: 'organizer' })))
            .rejects.toThrow('is cancelled');

        expect(transfers).toHaveBeenCalledTimes(2);
    });

    test('ascending scores, batch submission and the scheduled sweep', async () => {
        await create({ scoreOrder: 'asc', prizeSplitBps: [10000] });
        await enter('alice');
        await enter('bob');

        await expect(contract.actions.submitScores.handler({
            tournamentId: 'cup-1',
            scores: [{ player: 'alice', score: 1 }, { player: 'alice', score: 2 }]
        }, makeContext(streamer, { sender: 'gameserver', time: AFTER_CLOSE }))).rejects.toThrow('once per batch');

        await contract.actions.submitScores.handler({
            tournamentId: 'cup-1',
            scores: [{ player: 'alice', score: 61.2 }, { player: 'bob', score: 58.9 }]
        }, makeContext(streamer, { sender: 'gameserver', time: AFTER_CLOSE }));

        await expect(score('alice', 50, 'gameserver', '2026-05-03T01:00:00Z')).rejects.toThrow('has ended');

        await (contract.actions.finalizeDue as any).handler({}, makeContext(streamer, { sender: 'host', trigger: 'time', time: '2026-05-01T00:00:00Z' }));
        expect(transfers).not.toHaveBeenCalled();

        await (contract.actions.finalizeDue as any).handler({}, makeContext(streamer, { sender: 'host', trigger: 'time', time: '2026-05-03T00:00:01Z' }));
        expect(transfers.mock.calls[0]).toEqual(['host', 'bob', '18.000', 'HIVE', 'Spring Cup: rank #1 prize']);
    });

    test('restricts creation to organizers when configured', async () => {
        const restricted = createTournamentContract({ name: 'restricted', account: 'host', organizers: ['league'] });
        await streamer.registerContract(restricted);

        expect(restricted.actions.createTournament.guards).toEqual({ allowedSenders: ['league'] });
        await expect(restricted.actions.createTournament.handler({
            tournamentId: 'x', title: 'X', asset: 'HIVE', entryFee: '1.000', registrationClosesAt: '2027-01-01T00:00:00Z',
            minPlayers: 1, maxPlayers: 2, prizeSplitBps: [10000], scoreOrder: 'desc', tieBreak: 'split'
        } as any, makeContext(streamer, { sender: 'random' }))).rejects.toThrow('not allowed');
    });
});
