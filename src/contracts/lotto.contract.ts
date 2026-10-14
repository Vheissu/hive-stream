import BigNumber from '../bignumber';
import seedrandom from 'seedrandom';
import { z } from 'zod';
import { action, defineContract } from './contract';
import { getLogger } from '../logger';
import {
    blockTimeOf,
    createBetSettlement,
    createFairnessSupport,
    fetchAccountBalance,
    initializeTables,
    refundableField,
    resolveContractAccount,
    verifyIncomingTransfer
} from './helpers';
import { sha256Hex } from '../fairness/sha256';
import { resolveFairnessOption, type FairDrawProof, type FairnessManager, type FairnessOptions } from '../fairness/manager';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'hivelotto';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_VALID_DRAW_TYPES = ['hourly', 'daily'];

const DEFAULT_COST = 10;
const DEFAULT_MIN_ENTRIES_HOURLY = 25;
const DEFAULT_MIN_ENTRIES_DAILY = 100;
const DEFAULT_HOURLY_WINNERS_PICK = 3;
const DEFAULT_DAILY_WINNERS_PICK = 10;
const DEFAULT_MAX_TICKETS_PER_USER = 3;
const DEFAULT_PERCENTAGE = 5;

const COLLECTION_LOTTERY = 'lottery';
const COLLECTION_SETTINGS = 'settings';

// Legacy block-derived RNG, used only with `fairness: false`. Biasable by the
// block producer and not verifiable by players.
function rng(previousBlockId: string, blockId: string, transactionId: string, entropy: number, maximum = 100): number {
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${entropy}`).double();
    return Math.floor(random * maximum) + 1;
}

export interface LottoContractOptions {
    name?: string;
    /** House account that sells tickets and pays winners. Defaults to the streamer username. */
    account?: string;
    /** Receives the fee share of each pot. Defaults to the house account. */
    feeAccount?: string;
    /** Asset tickets are priced and paid out in (HIVE or HBD). Tickets paid in any other asset are refunded. */
    tokenSymbol?: string;
    /** Accepted ticket assets. Defaults to `[tokenSymbol]`; a ticket must also be paid in `tokenSymbol`. */
    validCurrencies?: string[];
    validDrawTypes?: string[];
    cost?: number;
    minEntriesHourly?: number;
    minEntriesDaily?: number;
    hourlyWinnersPick?: number;
    dailyWinnersPick?: number;
    maxTicketsPerUser?: number;
    feePercentage?: number;
    /** Send a 0.001 notice transfer to entrants who did not win a draw (default false; results are always recorded on the draw). */
    notifyLosses?: boolean;
    /**
     * Provably-fair winner selection, on by default. The client seed is the
     * sha256 of every entry's transaction id, so all entrants contribute
     * entropy. Pass `false` for the legacy block-id RNG (not verifiable).
     */
    fairness?: FairnessManager | FairnessOptions | boolean;
}

export function createLottoContract(options: LottoContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    let feeAccount = options.feeAccount || '';
    const tokenSymbol = options.tokenSymbol || DEFAULT_TOKEN_SYMBOL;
    const validCurrencies = options.validCurrencies || [tokenSymbol];
    const validDrawTypes = options.validDrawTypes || DEFAULT_VALID_DRAW_TYPES;
    const cost = options.cost ?? DEFAULT_COST;
    const minEntriesHourly = options.minEntriesHourly ?? DEFAULT_MIN_ENTRIES_HOURLY;
    const minEntriesDaily = options.minEntriesDaily ?? DEFAULT_MIN_ENTRIES_DAILY;
    const hourlyWinnersPick = options.hourlyWinnersPick ?? DEFAULT_HOURLY_WINNERS_PICK;
    const dailyWinnersPick = options.dailyWinnersPick ?? DEFAULT_DAILY_WINNERS_PICK;
    const maxTicketsPerUser = options.maxTicketsPerUser ?? DEFAULT_MAX_TICKETS_PER_USER;
    const feePercentage = options.feePercentage ?? DEFAULT_PERCENTAGE;
    const notifyLosses = options.notifyLosses ?? false;
    const fairSupport = createFairnessSupport(name, () => account, resolveFairnessOption(options.fairness ?? true));
    const fairness = fairSupport.fairness;

    const state = {
        streamer: null as any,
        adapter: null as any
    };

    /**
     * Draw storage. Document stores (MongoDB) use the `lottery` / `settings`
     * collections with every document tagged with the contract name, so two
     * lotto instances never share draws; SQL adapters get namespaced tables
     * with the entries, winners and fairness proof stored as JSON text.
     */
    const isSql = (): boolean => Boolean(state.adapter?.capabilities?.sql);

    const parseJson = (value: any, fallback: any) => {
        if (value === null || value === undefined || value === '') {
            return fallback;
        }

        return typeof value === 'string' ? JSON.parse(value) : value;
    };

    const toDraw = (row: any) => ({
        _id: row.draw_id,
        type: row.type,
        status: row.status,
        entries: parseJson(row.entries, []),
        winners: parseJson(row.winners, undefined),
        fairness: parseJson(row.fairness, undefined)
    });

    const store = {
        async initialize(time: Date): Promise<void> {
            if (isSql()) {
                await initializeTables(state.adapter, [
                    `
                        CREATE TABLE IF NOT EXISTS lotto_draws (
                            draw_id TEXT PRIMARY KEY,
                            contract TEXT NOT NULL,
                            type TEXT NOT NULL,
                            status TEXT NOT NULL,
                            entries TEXT NOT NULL,
                            winners TEXT,
                            fairness TEXT,
                            created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )
                    `,
                    'CREATE INDEX IF NOT EXISTS idx_lotto_draws_active ON lotto_draws (contract, type, status)',
                    `
                        CREATE TABLE IF NOT EXISTS lotto_settings (
                            contract TEXT PRIMARY KEY,
                            enabled INTEGER NOT NULL,
                            initiated_at TEXT NOT NULL
                        )
                    `
                ]);

                const existing = await state.adapter.query('SELECT contract FROM lotto_settings WHERE contract = ?', [name]);

                if (!existing?.length) {
                    await state.adapter.query('INSERT INTO lotto_settings (contract, enabled, initiated_at) VALUES (?, ?, ?)', [name, 1, time.toISOString()]);
                }

                return;
            }

            const settings = await state.adapter.findOne(COLLECTION_SETTINGS, { contract: name });

            if (!settings) {
                await state.adapter.insert(COLLECTION_SETTINGS, {
                    contract: name,
                    contractInitiated: time,
                    enabled: true
                });
            }
        },

        async findActive(type: string): Promise<any | null> {
            if (isSql()) {
                const rows = await state.adapter.query(
                    'SELECT * FROM lotto_draws WHERE contract = ? AND type = ? AND status = ? ORDER BY created_at ASC LIMIT 1',
                    [name, type, 'active']
                );

                return rows?.[0] ? toDraw(rows[0]) : null;
            }

            const draws = (await state.adapter.find(COLLECTION_LOTTERY, { contract: name, status: 'active', type })) || [];
            return draws[0] ?? null;
        },

        async insert(draw: { status: string; type: string; entries: any[] }, drawId: string, time: Date): Promise<void> {
            if (isSql()) {
                await state.adapter.query(
                    'INSERT INTO lotto_draws (draw_id, contract, type, status, entries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [drawId, name, draw.type, draw.status, JSON.stringify(draw.entries), time.toISOString(), time.toISOString()]
                );
                return;
            }

            await state.adapter.insert(COLLECTION_LOTTERY, { contract: name, ...draw });
        },

        async save(draw: any, time: Date): Promise<void> {
            if (isSql()) {
                await state.adapter.query(
                    'UPDATE lotto_draws SET status = ?, entries = ?, winners = ?, fairness = ?, updated_at = ? WHERE draw_id = ?',
                    [
                        draw.status,
                        JSON.stringify(draw.entries ?? []),
                        draw.winners === undefined ? null : JSON.stringify(draw.winners),
                        draw.fairness === undefined ? null : JSON.stringify(draw.fairness),
                        time.toISOString(),
                        draw._id
                    ]
                );
                return;
            }

            await state.adapter.replace(COLLECTION_LOTTERY, { _id: draw._id }, draw);
        }
    };

    // Typed but permissive: an unknown draw type is refunded by the handler
    // instead of failing validation and keeping the ticket money.
    const buySchema = z.object({
        type: refundableField(z.enum(['hourly', 'daily']))
    });
    type BuyPayload = z.infer<typeof buySchema>;

    const getPreviousUserTicketsForCurrentDrawType = async (type: string, accountName: string): Promise<number> => {
        const draw = await store.findActive(type);

        if (!draw || !draw.entries) {
            return 0;
        }

        const userEntries = draw.entries.filter((entry: any) => entry.account === accountName);
        return userEntries.length;
    };

    const buy = async (payload: BuyPayload, ctx: ContractContext): Promise<void> => {
        const ticket = await verifyIncomingTransfer(state.streamer, ctx, account);
        const sender = ticket.from;
        const settlement = createBetSettlement({
            streamer: state.streamer,
            adapter: state.adapter,
            contract: name,
            account,
            ctx,
            player: sender,
            amount: ticket.amount,
            asset: ticket.asset,
            logPrefix: '[LottoContract]'
        });

        if (await settlement.alreadySettled()) {
            return;
        }

        if (!validCurrencies.includes(ticket.asset) || ticket.asset !== tokenSymbol) {
            await settlement.refund('[Refund] You sent an invalid currency.');
            return;
        }

        const drawType = payload.type;

        if (typeof drawType !== 'string' || !validDrawTypes.includes(drawType)) {
            await settlement.refund('[Refund] You specified an invalid draw type');
            return;
        }

        const previousEntriesCount = await getPreviousUserTicketsForCurrentDrawType(drawType, sender);
        if (previousEntriesCount >= maxTicketsPerUser) {
            await settlement.refund('[Refund] You have exceeded the allowed number of entries');
            return;
        }

        if (ticket.value.isLessThan(cost)) {
            await settlement.refund(`[Refund] A ticket costs ${cost} ${tokenSymbol}. You sent ${ticket.rawAmount}. Insufficient amount.`);
            return;
        }

        const time = blockTimeOf(ctx);
        const entry = {
            account: sender,
            transactionId: operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex),
            date: time
        };
        const activeDraw = await store.findActive(drawType);

        // Record the entry before refunding any overpayment, so a failed
        // refund can never cost the player their ticket.
        if (activeDraw) {
            activeDraw.entries.push(entry);
            await store.save(activeDraw, time);
        } else {
            const drawId = `${name}:${drawType}:${ctx.transaction.id}:${ctx.transaction.operationIndex ?? 0}`;
            await store.insert({ status: 'active', type: drawType, entries: [entry] }, drawId, time);
        }

        if (ticket.value.isGreaterThan(cost)) {
            const difference = ticket.value.minus(cost).toFixed(3, BigNumber.ROUND_DOWN);
            await settlement.send(sender, difference, ticket.asset, `[Refund] A ticket costs ${cost} ${tokenSymbol}. You sent ${ticket.rawAmount}. You were refunded ${difference} ${tokenSymbol}.`);
        }
    };

    const getWinners = async (count: number, entries: any[], ctx: any): Promise<{ winners: any[]; proof: FairDrawProof | null }> => {
        if (fairness) {
            const pickCount = Math.min(count, entries.length);
            const clientSeed = sha256Hex(entries.map((entry: any) => String(entry.transactionId ?? '')).join(','));
            const draw = await fairness.draw({ type: 'pick', count: pickCount, total: entries.length }, {
                clientSeed,
                blockId: ctx.block.id
            });

            return {
                winners: draw.outcome.map((index: number) => entries[index]),
                proof: draw.proof
            };
        }

        const winners: any[] = [];
        const selectedIndices = new Set<number>();
        const maxEntries = Math.min(count, entries.length);

        for (let attempt = 0; winners.length < maxEntries && attempt < maxEntries * 10; attempt++) {
            const index = rng(
                ctx.block.previousId,
                ctx.block.id,
                ctx.transaction.id,
                attempt,
                entries.length
            ) - 1; // rng returns 1-based, convert to 0-based

            if (!selectedIndices.has(index)) {
                selectedIndices.add(index);
                winners.push(entries[index]);
            }
        }

        return { winners, proof: null };
    };

    const runDraw = async (type: 'hourly' | 'daily', ctx: any): Promise<void> => {
        const draw = await store.findActive(type);

        if (!draw) {
            return;
        }

        const minEntries = type === 'hourly' ? minEntriesHourly : minEntriesDaily;
        const winnersPick = type === 'hourly' ? hourlyWinnersPick : dailyWinnersPick;
        const time = blockTimeOf(ctx);
        const total = draw.entries.length;

        if (total < minEntries) {
            const entrants = draw.entries.map((entrant: any) => entrant.account);

            // Mark draw as completed BEFORE refunding to prevent re-draws
            await store.save({ ...draw, status: 'completed' }, time);

            await state.streamer.transferHiveTokensMultiple(account, entrants, new BigNumber(cost).toFixed(3), tokenSymbol, `[Refund] The ${type} lotto draw did not have enough contestants.`);
            return;
        }

        const winningsAmount = new BigNumber(total).multipliedBy(cost);
        const percentageFee = winningsAmount.dividedBy(100).multipliedBy(feePercentage);
        const payoutTotal = winningsAmount.minus(percentageFee);
        const balance = await fetchAccountBalance(state.streamer, account, tokenSymbol);

        // Check full outgoing amount (winnings + fee) against balance
        if (winningsAmount.isGreaterThan(balance)) {
            throw new Error('Balance is less than amount to pay out');
        }

        // Mark draw as completed BEFORE payouts to prevent re-draws
        await store.save({ ...draw, status: 'completed' }, time);

        if (account !== feeAccount) {
            await state.streamer.transferHiveTokens(account, feeAccount, percentageFee.toFixed(3, BigNumber.ROUND_DOWN), tokenSymbol, 'percentage fee');
        }

        const { winners, proof } = await getWinners(winnersPick, draw.entries, ctx);
        // Split the pot across the winners actually drawn, rounding down so
        // the payouts can never exceed the pot.
        const amountPerWinner = payoutTotal.dividedBy(Math.max(1, winners.length)).toFixed(3, BigNumber.ROUND_DOWN);
        const winnerStrings: string[] = winners.map((winner: any) => winner.account);

        await store.save({
            ...draw,
            status: 'completed',
            winners: winnerStrings,
            ...(proof ? { fairness: proof } : {})
        }, time);

        if (!winnerStrings.length) {
            return;
        }

        const winMemo = type === 'hourly'
            ? `Congratulations you won the hourly lottery. You won ${amountPerWinner} ${tokenSymbol}. Winners: ${winnerStrings.join(', ')}`
            : `Congratulations you won the daily lottery. You won ${amountPerWinner} ${tokenSymbol}`;

        await state.streamer.transferHiveTokensMultiple(account, winnerStrings, amountPerWinner, tokenSymbol, winMemo);

        if (!notifyLosses) {
            return;
        }

        const losers = [...new Set<string>(draw.entries.map((entry: any) => entry.account))]
            .filter((entrant) => !winnerStrings.includes(entrant));

        if (losers.length) {
            await state.streamer.transferHiveTokensMultiple(account, losers, '0.001', tokenSymbol, `Sorry, you didn't win the ${type} draw. Winners: ${winnerStrings.join(', ')}`);
        }
    };

    const drawHourlyLottery = async (_payload: any, ctx: any): Promise<void> => {
        try {
            await runDraw('hourly', ctx);
        } catch (error) {
            getLogger().error('[LottoContract] Hourly draw failed:', error);
            throw error;
        }
    };

    const drawDailyLottery = async (_payload: any, ctx: any): Promise<void> => {
        try {
            await runDraw('daily', ctx);
        } catch (error) {
            getLogger().error('[LottoContract] Daily draw failed:', error);
            throw error;
        }
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { streamer, adapter } = lifecycle;
                account = resolveContractAccount('createLottoContract', options.account, lifecycle);
                feeAccount = options.feeAccount || account;
                state.streamer = streamer;
                state.adapter = adapter;
                await fairSupport.initialize(adapter);
                await store.initialize(new Date());
            }
        },
        actions: {
            buy: action(buy, {
                schema: buySchema,
                trigger: 'transfer',
                description: 'Buy a ticket for the hourly or daily draw by transferring the ticket cost in the lotto\'s asset. `type` must be "hourly" or "daily" (or another configured draw type); invalid tickets are refunded and overpayments are refunded down to the ticket cost.'
            }),
            drawHourlyLottery: action(drawHourlyLottery, {
                trigger: 'time'
            }),
            drawDailyLottery: action(drawDailyLottery, {
                trigger: 'time'
            }),
            ...fairSupport.actions
        }
    });
}
