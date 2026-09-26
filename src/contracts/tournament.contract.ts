import BigNumber from '../bignumber';
import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    createContractState,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender,
    requireTransferContext,
    toBigNumber
} from './helpers';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'tournaments';
const PRECISION = 3;
const MAX_PRIZE_POSITIONS = 50;
const MAX_FEE_BPS = 3000;

const scoreSchema = z.union([
    z.number().finite(),
    z.string().regex(/^-?\d+(?:\.\d+)?$/, 'Invalid score')
]);

export interface TournamentContractOptions {
    name?: string;
    /** Account that receives entry fees and pays prizes. Entries sent elsewhere are rejected. */
    account: string;
    /** House fee taken from the prize pool, in basis points (max 3000). */
    feeBps?: number;
    /** Where the house fee is sent. Defaults to keeping it in `account`. */
    feeAccount?: string;
    /** Accounts allowed to submit scores for any tournament, in addition to each tournament's oracle. */
    oracles?: string[];
    /** When set, only these accounts can create tournaments. */
    organizers?: string[];
}

interface RankedEntry {
    player: string;
    score: BigNumber;
    submittedAt: string;
    submissionIndex: number;
}

export interface TournamentPayout {
    player: string;
    rank: number;
    amount: string;
}

/**
 * Splits a prize pool across ranked players. Tied players share the prizes
 * of the positions they occupy equally ('split'), or the earliest submission
 * wins the tie ('earliest'). Unused positions (fewer scored players than
 * prizes) are redistributed pro-rata over the used positions. Rounding dust
 * goes to the top-ranked player so the payouts sum exactly to the pool.
 */
export function calculateTournamentPayouts(
    ranked: RankedEntry[],
    prizeSplitBps: number[],
    pool: BigNumber,
    tieBreak: 'split' | 'earliest'
): TournamentPayout[] {
    if (ranked.length === 0 || pool.lte(0)) {
        return [];
    }

    const positions = Math.min(prizeSplitBps.length, ranked.length);
    const usedBps = prizeSplitBps.slice(0, positions);
    const usedTotal = usedBps.reduce((sum, bps) => sum + bps, 0);

    if (usedTotal === 0) {
        return [];
    }

    const positionPrize = (index: number): BigNumber => index < positions
        ? pool.multipliedBy(usedBps[index]).dividedBy(usedTotal)
        : new BigNumber(0);

    const payouts: TournamentPayout[] = [];
    let index = 0;

    while (index < ranked.length && index < positions) {
        let groupEnd = index + 1;

        if (tieBreak === 'split') {
            while (groupEnd < ranked.length && ranked[groupEnd].score.eq(ranked[index].score)) {
                groupEnd++;
            }
        }

        let groupPrize = new BigNumber(0);
        for (let position = index; position < groupEnd; position++) {
            groupPrize = groupPrize.plus(positionPrize(position));
        }

        const share = groupPrize.dividedBy(groupEnd - index).decimalPlaces(PRECISION, BigNumber.ROUND_DOWN);

        for (let position = index; position < groupEnd; position++) {
            if (share.gt(0)) {
                payouts.push({ player: ranked[position].player, rank: index + 1, amount: share.toFixed(PRECISION) });
            }
        }

        index = groupEnd;
    }

    const paid = payouts.reduce((sum, payout) => sum.plus(payout.amount), new BigNumber(0));
    const dust = pool.decimalPlaces(PRECISION, BigNumber.ROUND_DOWN).minus(paid);

    if (dust.gt(0) && payouts.length > 0) {
        payouts[0].amount = new BigNumber(payouts[0].amount).plus(dust).toFixed(PRECISION);
    }

    return payouts;
}

export function createTournamentContract(options: TournamentContractOptions) {
    if (!options?.account) {
        throw new Error('Tournament contract requires an account');
    }

    const name = options.name || DEFAULT_NAME;
    const account = options.account;
    const feeBps = options.feeBps ?? 0;
    const feeAccount = options.feeAccount;
    const globalOracles = options.oracles || [];
    const organizers = options.organizers;

    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
        throw new Error(`Tournament feeBps must be an integer between 0 and ${MAX_FEE_BPS}`);
    }

    const state = createContractState({ streamer: null as any });

    const tournamentIdSchema = z.object({ tournamentId: identifierSchema });

    const createTournamentSchema = z.object({
        tournamentId: identifierSchema,
        title: z.string().min(1).max(140),
        asset: assetSchema,
        entryFee: amountSchema,
        registrationOpensAt: z.string().optional(),
        registrationClosesAt: z.string(),
        endsAt: z.string().optional(),
        minPlayers: z.number().int().min(1).max(10000).default(2),
        maxPlayers: z.number().int().min(1).max(10000).default(1000),
        prizeSplitBps: z.array(z.number().int().min(0).max(10000)).min(1).max(MAX_PRIZE_POSITIONS),
        oracle: z.string().min(3).max(16).optional(),
        scoreOrder: z.enum(['desc', 'asc']).default('desc'),
        tieBreak: z.enum(['split', 'earliest']).default('split')
    });

    const submitScoreSchema = z.object({
        tournamentId: identifierSchema,
        player: z.string().min(3).max(16),
        score: scoreSchema
    });

    const submitScoresSchema = z.object({
        tournamentId: identifierSchema,
        scores: z.array(z.object({ player: z.string().min(3).max(16), score: scoreSchema })).min(1).max(100)
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS tournaments (
                    tournament_id TEXT PRIMARY KEY,
                    organizer TEXT NOT NULL,
                    title TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    entry_fee TEXT NOT NULL,
                    registration_opens_at TEXT NOT NULL,
                    registration_closes_at TEXT NOT NULL,
                    ends_at TEXT,
                    min_players INTEGER NOT NULL,
                    max_players INTEGER NOT NULL,
                    prize_split_bps TEXT NOT NULL,
                    oracle TEXT NOT NULL,
                    score_order TEXT NOT NULL,
                    tie_break TEXT NOT NULL,
                    status TEXT NOT NULL,
                    status_reason TEXT,
                    pot TEXT NOT NULL,
                    fee TEXT,
                    created_at TEXT NOT NULL,
                    finalized_at TEXT
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS tournament_entries (
                    tournament_id TEXT NOT NULL,
                    player TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    score TEXT,
                    score_submitted_at TEXT,
                    score_sequence INTEGER,
                    refunded INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (tournament_id, player)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS tournament_payouts (
                    tournament_id TEXT NOT NULL,
                    player TEXT NOT NULL,
                    rank INTEGER NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (tournament_id, player)
                )
            `
        ]);
    };

    const nowOf = (ctx: ContractContext): Date => ctx.block?.time instanceof Date && !Number.isNaN(ctx.block.time.getTime())
        ? ctx.block.time
        : new Date();

    const transfer = async (to: string, amount: string, asset: string, memo: string) => {
        if (!state.streamer) {
            throw new Error('Tournament contract is not attached to a streamer');
        }

        await state.streamer.transferHiveTokens(account, to, amount, asset, memo);
    };

    const getTournament = async (tournamentId: string) => {
        const rows = await state.adapter.query('SELECT * FROM tournaments WHERE tournament_id = ?', [tournamentId]);

        if (rows.length === 0) {
            throw new Error(`Tournament ${tournamentId} does not exist`);
        }

        return rows[0];
    };

    const canScore = (tournament: any, sender: string) => sender === tournament.oracle || globalOracles.includes(sender);

    const createTournament = async (payload: z.infer<typeof createTournamentSchema>, ctx: ContractContext) => {
        const organizer = requireSender(ctx);

        if (organizers && !organizers.includes(organizer)) {
            throw new Error(`${organizer} is not allowed to create tournaments`);
        }

        const existing = await state.adapter.query('SELECT tournament_id FROM tournaments WHERE tournament_id = ?', [payload.tournamentId]);

        if (existing.length > 0) {
            throw new Error(`Tournament ${payload.tournamentId} already exists`);
        }

        const splitTotal = payload.prizeSplitBps.reduce((sum, bps) => sum + bps, 0);

        if (splitTotal !== 10000) {
            throw new Error('prizeSplitBps must add up to 10000');
        }

        if (payload.minPlayers > payload.maxPlayers) {
            throw new Error('minPlayers cannot exceed maxPlayers');
        }

        if (toBigNumber(payload.entryFee).lte(0)) {
            throw new Error('entryFee must be greater than zero');
        }

        const now = nowOf(ctx);
        const opensAt = parseDateValue(payload.registrationOpensAt) || now;
        const closesAt = parseDateValue(payload.registrationClosesAt)!;
        const endsAt = parseDateValue(payload.endsAt);

        if (closesAt <= opensAt) {
            throw new Error('Registration must close after it opens');
        }

        if (endsAt && endsAt < closesAt) {
            throw new Error('Tournament cannot end before registration closes');
        }

        await state.adapter.query(
            `INSERT INTO tournaments (
                tournament_id, organizer, title, asset, entry_fee, registration_opens_at, registration_closes_at, ends_at,
                min_players, max_players, prize_split_bps, oracle, score_order, tie_break, status, status_reason, pot, fee, created_at, finalized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.tournamentId, organizer, payload.title, payload.asset, toBigNumber(payload.entryFee).toFixed(PRECISION),
                opensAt.toISOString(), closesAt.toISOString(), endsAt ? endsAt.toISOString() : null,
                payload.minPlayers, payload.maxPlayers, JSON.stringify(payload.prizeSplitBps),
                payload.oracle || organizer, payload.scoreOrder, payload.tieBreak,
                'registration', null, '0', null, now.toISOString(), null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createTournament', payload, {
            action: 'tournament_created',
            data: { tournamentId: payload.tournamentId, organizer, entryFee: payload.entryFee, asset: payload.asset }
        }, blockTimeOf(ctx));
    };

    const enter = async (payload: z.infer<typeof tournamentIdSchema>, ctx: ContractContext) => {
        const transferCtx = requireTransferContext(ctx);
        const player = requireSender(ctx);

        if (transferCtx.to !== account) {
            throw new Error(`Tournament entries must be sent to ${account}`);
        }

        const entryRef = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);
        const duplicate = await state.adapter.query(
            'SELECT player FROM tournament_entries WHERE transaction_id = ?',
            [entryRef]
        );

        if (duplicate.length > 0) {
            return;
        }

        const amount = toBigNumber(transferCtx.amount);
        const refund = async (reason: string) => {
            await transfer(player, amount.toFixed(PRECISION), transferCtx.asset, `[Refund] ${reason}`);
            await emitContractEvent(state.adapter, name, 'enter', payload, {
                action: 'tournament_entry_refunded',
                data: { tournamentId: payload.tournamentId, player, reason, amount: amount.toFixed(PRECISION), asset: transferCtx.asset }
            }, blockTimeOf(ctx));
        };

        const rows = await state.adapter.query('SELECT * FROM tournaments WHERE tournament_id = ?', [payload.tournamentId]);

        if (rows.length === 0) {
            await refund(`Tournament ${payload.tournamentId} does not exist`);
            return;
        }

        const tournament = rows[0];
        const now = nowOf(ctx);

        if (tournament.status !== 'registration') {
            await refund('Registration is closed');
            return;
        }

        if (now < new Date(tournament.registration_opens_at) || now >= new Date(tournament.registration_closes_at)) {
            await refund('Registration is not open');
            return;
        }

        if (transferCtx.asset !== tournament.asset) {
            await refund(`Entry fee must be paid in ${tournament.asset}`);
            return;
        }

        if (!amount.eq(tournament.entry_fee)) {
            await refund(`Entry fee is exactly ${tournament.entry_fee} ${tournament.asset}`);
            return;
        }

        const existing = await state.adapter.query(
            'SELECT player FROM tournament_entries WHERE tournament_id = ? AND player = ?',
            [payload.tournamentId, player]
        );

        if (existing.length > 0) {
            await refund('You are already entered');
            return;
        }

        const countRows = await state.adapter.query(
            'SELECT COUNT(*) AS total FROM tournament_entries WHERE tournament_id = ?',
            [payload.tournamentId]
        );

        if (Number(countRows[0]?.total ?? 0) >= Number(tournament.max_players)) {
            await refund('Tournament is full');
            return;
        }

        await state.adapter.query(
            'INSERT INTO tournament_entries (tournament_id, player, amount, transaction_id, score, score_submitted_at, score_sequence, refunded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [payload.tournamentId, player, amount.toFixed(PRECISION), entryRef, null, null, null, 0, now.toISOString()]
        );

        const pot = toBigNumber(tournament.pot).plus(amount);
        await state.adapter.query('UPDATE tournaments SET pot = ? WHERE tournament_id = ?', [pot.toFixed(PRECISION), payload.tournamentId]);

        await emitContractEvent(state.adapter, name, 'enter', payload, {
            action: 'tournament_entered',
            data: { tournamentId: payload.tournamentId, player, pot: pot.toFixed(PRECISION) }
        }, blockTimeOf(ctx));
    };

    const recordScores = async (tournamentId: string, scores: Array<{ player: string; score: number | string }>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const tournament = await getTournament(tournamentId);

        if (!canScore(tournament, sender)) {
            throw new Error(`${sender} is not authorised to submit scores`);
        }

        if (tournament.status !== 'registration' && tournament.status !== 'running') {
            throw new Error(`Tournament ${tournamentId} is ${tournament.status}`);
        }

        const now = nowOf(ctx);

        if (now < new Date(tournament.registration_closes_at)) {
            throw new Error('Scores can only be submitted after registration closes');
        }

        if (tournament.ends_at && now > new Date(tournament.ends_at)) {
            throw new Error('Tournament has ended; finalize it instead');
        }

        const sequenceRows = await state.adapter.query(
            'SELECT MAX(score_sequence) AS seq FROM tournament_entries WHERE tournament_id = ?',
            [tournamentId]
        );
        let sequence = Number(sequenceRows[0]?.seq ?? 0);

        for (const entry of scores) {
            const rows = await state.adapter.query(
                'SELECT * FROM tournament_entries WHERE tournament_id = ? AND player = ?',
                [tournamentId, entry.player]
            );

            if (rows.length === 0) {
                throw new Error(`${entry.player} is not entered in ${tournamentId}`);
            }

            sequence++;
            await state.adapter.query(
                'UPDATE tournament_entries SET score = ?, score_submitted_at = ?, score_sequence = ? WHERE tournament_id = ? AND player = ?',
                [toBigNumber(entry.score).toFixed(), now.toISOString(), sequence, tournamentId, entry.player]
            );
        }

        if (tournament.status === 'registration') {
            await state.adapter.query('UPDATE tournaments SET status = ? WHERE tournament_id = ?', ['running', tournamentId]);
        }

        await emitContractEvent(state.adapter, name, 'submitScores', { tournamentId }, {
            action: 'tournament_scores_submitted',
            data: { tournamentId, oracle: sender, scores }
        }, blockTimeOf(ctx));
    };

    const submitScore = async (payload: z.infer<typeof submitScoreSchema>, ctx: ContractContext) => {
        await recordScores(payload.tournamentId, [{ player: payload.player, score: payload.score }], ctx);
    };

    const submitScores = async (payload: z.infer<typeof submitScoresSchema>, ctx: ContractContext) => {
        const players = payload.scores.map((entry) => entry.player);

        if (new Set(players).size !== players.length) {
            throw new Error('Each player may appear once per batch');
        }

        await recordScores(payload.tournamentId, payload.scores as Array<{ player: string; score: number | string }>, ctx);
    };

    const refundAll = async (tournament: any, reason: string) => {
        const entries = await state.adapter.query(
            'SELECT * FROM tournament_entries WHERE tournament_id = ? AND refunded = ?',
            [tournament.tournament_id, 0]
        );

        for (const entry of entries) {
            // Mark first so a crash between the two steps can never refund twice.
            await state.adapter.query(
                'UPDATE tournament_entries SET refunded = ? WHERE tournament_id = ? AND player = ?',
                [1, tournament.tournament_id, entry.player]
            );
            await transfer(entry.player, entry.amount, tournament.asset, `[Refund] ${tournament.title}: ${reason}`);
        }

        return entries.length;
    };

    const cancelTournament = async (payload: z.infer<typeof tournamentIdSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const tournament = await getTournament(payload.tournamentId);

        if (sender !== tournament.organizer) {
            throw new Error('Only the organizer can cancel this tournament');
        }

        if (tournament.status === 'finalized' || tournament.status === 'cancelled') {
            throw new Error(`Tournament ${payload.tournamentId} is ${tournament.status}`);
        }

        await state.adapter.query(
            'UPDATE tournaments SET status = ?, status_reason = ?, finalized_at = ? WHERE tournament_id = ?',
            ['cancelled', 'Cancelled by organizer', nowOf(ctx).toISOString(), payload.tournamentId]
        );

        const refunded = await refundAll(tournament, 'Tournament cancelled');

        await emitContractEvent(state.adapter, name, 'cancelTournament', payload, {
            action: 'tournament_cancelled',
            data: { tournamentId: payload.tournamentId, refunded }
        }, blockTimeOf(ctx));
    };

    const rankEntries = (entries: any[], order: 'asc' | 'desc', tieBreak: 'split' | 'earliest'): RankedEntry[] => {
        return entries
            .filter((entry) => entry.score !== null && entry.score !== undefined)
            .map((entry) => ({
                player: entry.player,
                score: toBigNumber(entry.score),
                submittedAt: entry.score_submitted_at,
                submissionIndex: Number(entry.score_sequence)
            }))
            .sort((a, b) => {
                const byScore = order === 'desc' ? b.score.comparedTo(a.score)! : a.score.comparedTo(b.score)!;

                if (byScore !== 0) {
                    return byScore;
                }

                // Deterministic ordering for ties: earliest submission, then account name.
                if (a.submissionIndex !== b.submissionIndex) {
                    return a.submissionIndex - b.submissionIndex;
                }

                return a.player.localeCompare(b.player);
            });
    };

    const finalizeOne = async (tournament: any, ctx: ContractContext) => {
        const now = nowOf(ctx);
        const entries = await state.adapter.query(
            'SELECT * FROM tournament_entries WHERE tournament_id = ? AND refunded = ?',
            [tournament.tournament_id, 0]
        );

        if (entries.length < Number(tournament.min_players)) {
            await state.adapter.query(
                'UPDATE tournaments SET status = ?, status_reason = ?, finalized_at = ? WHERE tournament_id = ?',
                ['cancelled', 'Not enough players', now.toISOString(), tournament.tournament_id]
            );
            const refunded = await refundAll(tournament, 'Not enough players');

            await emitContractEvent(state.adapter, name, 'finalize', { tournamentId: tournament.tournament_id }, {
                action: 'tournament_cancelled',
                data: { tournamentId: tournament.tournament_id, reason: 'Not enough players', refunded }
            }, blockTimeOf(ctx));
            return;
        }

        const ranked = rankEntries(entries, tournament.score_order, tournament.tie_break);

        if (ranked.length === 0) {
            await state.adapter.query(
                'UPDATE tournaments SET status = ?, status_reason = ?, finalized_at = ? WHERE tournament_id = ?',
                ['cancelled', 'No scores submitted', now.toISOString(), tournament.tournament_id]
            );
            const refunded = await refundAll(tournament, 'No scores were submitted');

            await emitContractEvent(state.adapter, name, 'finalize', { tournamentId: tournament.tournament_id }, {
                action: 'tournament_cancelled',
                data: { tournamentId: tournament.tournament_id, reason: 'No scores submitted', refunded }
            }, blockTimeOf(ctx));
            return;
        }

        const pot = toBigNumber(tournament.pot);
        const fee = pot.multipliedBy(feeBps).dividedBy(10000).decimalPlaces(PRECISION, BigNumber.ROUND_DOWN);
        const pool = pot.minus(fee);
        const payouts = calculateTournamentPayouts(ranked, JSON.parse(tournament.prize_split_bps), pool, tournament.tie_break);

        // Persist the result before any transfer so a replay cannot pay twice.
        await state.adapter.query(
            'UPDATE tournaments SET status = ?, fee = ?, finalized_at = ? WHERE tournament_id = ?',
            ['finalized', fee.toFixed(PRECISION), now.toISOString(), tournament.tournament_id]
        );

        for (const payout of payouts) {
            await state.adapter.query(
                'INSERT INTO tournament_payouts (tournament_id, player, rank, amount, asset, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [tournament.tournament_id, payout.player, payout.rank, payout.amount, tournament.asset, 'pending', now.toISOString()]
            );
        }

        for (const payout of payouts) {
            await transfer(payout.player, payout.amount, tournament.asset, `${tournament.title}: rank #${payout.rank} prize`);
            await state.adapter.query(
                'UPDATE tournament_payouts SET status = ? WHERE tournament_id = ? AND player = ?',
                ['paid', tournament.tournament_id, payout.player]
            );
        }

        if (feeAccount && feeAccount !== account && fee.gt(0)) {
            await transfer(feeAccount, fee.toFixed(PRECISION), tournament.asset, `${tournament.title}: house fee`);
        }

        await emitContractEvent(state.adapter, name, 'finalize', { tournamentId: tournament.tournament_id }, {
            action: 'tournament_finalized',
            data: {
                tournamentId: tournament.tournament_id,
                pot: pot.toFixed(PRECISION),
                fee: fee.toFixed(PRECISION),
                payouts,
                standings: ranked.map((entry, index) => ({ position: index + 1, player: entry.player, score: entry.score.toFixed() }))
            }
        }, blockTimeOf(ctx));
    };

    const finalize = async (payload: z.infer<typeof tournamentIdSchema>, ctx: ContractContext) => {
        const tournament = await getTournament(payload.tournamentId);
        const sender = requireSender(ctx);

        if (sender !== tournament.organizer && !canScore(tournament, sender)) {
            throw new Error('Only the organizer or oracle can finalize this tournament');
        }

        if (tournament.status === 'finalized' || tournament.status === 'cancelled') {
            throw new Error(`Tournament ${payload.tournamentId} is ${tournament.status}`);
        }

        if (nowOf(ctx) < new Date(tournament.registration_closes_at)) {
            throw new Error('Tournament cannot be finalized before registration closes');
        }

        await finalizeOne(tournament, ctx);
    };

    /** Scheduled sweep: finalizes tournaments whose end time has passed. */
    const finalizeDue = async (_payload: Record<string, never>, ctx: ContractContext) => {
        const now = nowOf(ctx).toISOString();
        const due = await state.adapter.query(
            'SELECT * FROM tournaments WHERE status IN (?, ?) AND ends_at IS NOT NULL AND ends_at <= ?',
            ['registration', 'running', now]
        );

        for (const tournament of due) {
            await finalizeOne(tournament, ctx);
        }
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ adapter, streamer }) => {
                state.adapter = adapter;
                state.streamer = streamer;
                await initialize();
            }
        },
        actions: {
            createTournament: action(createTournament, {
                schema: createTournamentSchema,
                trigger: 'custom_json',
                ...(organizers ? { guards: { allowedSenders: organizers } } : {}),
                description: 'Create a tournament with an entry fee, registration window, player limits and a basis-point prize split.'
            }),
            enter: action(enter, {
                schema: tournamentIdSchema,
                trigger: 'transfer',
                description: 'Enter by transferring the exact entry fee; wrong assets, amounts, duplicates and closed registrations are refunded.'
            }),
            submitScore: action(submitScore, {
                schema: submitScoreSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'Oracle-only: record a player score after registration closes.'
            }),
            submitScores: action(submitScores, {
                schema: submitScoresSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'Oracle-only: record up to 100 scores in one operation.'
            }),
            finalize: action(finalize, {
                schema: tournamentIdSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'Rank players, take the house fee and pay prizes; under-subscribed tournaments are cancelled and refunded.'
            }),
            finalizeDue: action(finalizeDue, {
                schema: z.object({}),
                trigger: 'time',
                description: 'Scheduled sweep that finalizes tournaments past their end time.'
            }),
            cancelTournament: action(cancelTournament, {
                schema: tournamentIdSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'Organizer-only: cancel and refund every entry.'
            })
        }
    });
}
