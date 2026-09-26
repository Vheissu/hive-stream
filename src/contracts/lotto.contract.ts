import BigNumber from '../bignumber';
import seedrandom from 'seedrandom';
import { z } from 'zod';
import { action, defineContract } from './contract';
import { Utils } from '../utils';
import { createFairnessSupport, resolveContractAccount } from './helpers';
import { sha256Hex } from '../fairness/sha256';
import { resolveFairnessOption, type FairDrawProof, type FairnessManager, type FairnessOptions } from '../fairness/manager';

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

function rng(previousBlockId: string, blockId: string, transactionId: string, entropy: number, maximum = 100): number {
    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${entropy}`).double();
    return Math.floor(random * maximum) + 1;
}

export interface LottoContractOptions {
    name?: string;
    account?: string;
    feeAccount?: string;
    tokenSymbol?: string;
    validCurrencies?: string[];
    validDrawTypes?: string[];
    cost?: number;
    minEntriesHourly?: number;
    minEntriesDaily?: number;
    hourlyWinnersPick?: number;
    dailyWinnersPick?: number;
    maxTicketsPerUser?: number;
    feePercentage?: number;
    /**
     * Provably-fair winner selection (recommended). The client seed is the
     * sha256 of every entry's transaction id, so all entrants contribute
     * entropy. When omitted the legacy block-id RNG is used.
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
    const fairSupport = createFairnessSupport(name, () => account, resolveFairnessOption(options.fairness));
    const fairness = fairSupport.fairness;

    const state = {
        streamer: null as any,
        adapter: null as any
    };

    const buySchema = z.object({
        type: z.enum(['hourly', 'daily'])
    });
    type BuyPayload = z.infer<typeof buySchema>;

    const getBalance = async (): Promise<number | null> => {
        const accountInfo = await state.streamer['client'].database.getAccounts([account]);

        if (accountInfo?.[0]) {
            const balance = (accountInfo[0].balance as string).split(' ');
            return parseFloat(balance[0]);
        }

        return null;
    };

    const getPreviousUserTicketsForCurrentDrawType = async (type: string, accountName: string): Promise<number> => {
        const lotto = (await state.adapter.find(COLLECTION_LOTTERY, { status: 'active', type })) || [];

        if (!lotto[0] || !lotto[0].entries) {
            return 0;
        }

        const userEntries = lotto[0].entries.filter((entry: any) => entry.account === accountName);
        return userEntries.length;
    };

    const buy = async (payload: BuyPayload, ctx: any): Promise<void> => {
        if (!ctx.transfer) {
            throw new Error('Transfer context required for buy');
        }

        const sender = ctx.sender;
        const amountRaw = ctx.transfer.rawAmount;

        const amountTrim = amountRaw.split(' ');
        const amountParsed = new BigNumber(amountTrim[0]);
        if (amountParsed.isNaN() || !amountParsed.isFinite() || amountParsed.isNegative()) {
            throw new Error('Invalid ticket amount');
        }
        const amountCurrency = amountTrim[1].trim();

        const transaction = await state.streamer.getTransaction(ctx.block.number, ctx.transaction.id);
        const verify = await state.streamer.verifyTransfer(transaction, sender, account, amountRaw);

        if (verify) {
            if (!validCurrencies.includes(amountCurrency)) {
                await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] You sent an invalid currency.');
                return;
            }

            if (!validDrawTypes.includes(payload.type)) {
                await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] You specified an invalid draw type');
                return;
            }

            const previousEntriesCount = await getPreviousUserTicketsForCurrentDrawType(payload.type, sender);
            if (previousEntriesCount >= maxTicketsPerUser) {
                await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] You have exceeded the allowed number of entries');
                return;
            }

            if (amountParsed.isLessThan(cost)) {
                await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], `[Refund] A ticket costs ${cost} ${tokenSymbol}. You sent ${amountRaw}. Insufficient amount.`);
                return;
            }

            if (amountParsed.isGreaterThan(cost)) {
                const difference = amountParsed.minus(cost).toFixed(3);
                await state.streamer.transferHiveTokens(account, sender, difference, amountTrim[1], `[Refund] A ticket costs ${cost} ${tokenSymbol}. You sent ${amountRaw}. You were refunded ${difference} ${tokenSymbol}.`);
                // Continue to create the entry — user paid enough for a ticket
            }

            const lotto = (await state.adapter.find(COLLECTION_LOTTERY, { status: 'active', type: payload.type })) || [];

            if (lotto.length) {
                const draw = lotto[0];

                draw.entries.push({
                    account: sender,
                    transactionId: ctx.transaction.id,
                    date: new Date()
                });

                await state.adapter.replace(COLLECTION_LOTTERY, { _id: draw._id }, draw);
                return;
            }

            const entries = [{
                account: sender,
                transactionId: ctx.transaction.id,
                date: new Date()
            }];

            await state.adapter.insert(COLLECTION_LOTTERY, { status: 'active', type: payload.type, entries });
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

    const drawHourlyLottery = async (_payload: any, ctx: any): Promise<void> => {
        const lotto = (await state.adapter.find(COLLECTION_LOTTERY, { status: 'active', type: 'hourly' })) || [];

        if (lotto.length) {
            const draw = lotto[0];
            const total = draw.entries.length;

            if (total < minEntriesHourly) {
                const entrants = draw.entries.reduce((arr: string[], entrant: any) => {
                    arr.push(entrant.account);
                    return arr;
                }, []);

                // Mark draw as completed BEFORE refunding to prevent re-draws
                await state.adapter.replace(COLLECTION_LOTTERY, { _id: draw._id }, { ...draw, status: 'completed' });

                await state.streamer.transferHiveTokensMultiple(account, entrants, new BigNumber(cost).toFixed(3), tokenSymbol, '[Refund] The hourly lotto draw did not have enough contestants.');
                return;
            }

            const balance = await getBalance();
            const winningsAmount = new BigNumber(total).multipliedBy(cost);
            const percentageFee = winningsAmount.dividedBy(100).multipliedBy(feePercentage);
            const payoutTotal = winningsAmount.minus(percentageFee);

            // Check full outgoing amount (winnings + fee) against balance
            if (balance !== null && winningsAmount.toNumber() > balance) {
                throw new Error('Balance is less than amount to pay out');
            }

            // Mark draw as completed BEFORE payouts to prevent re-draws
            await state.adapter.replace(COLLECTION_LOTTERY, { _id: draw._id }, { ...draw, status: 'completed' });

            if (account !== feeAccount) {
                await state.streamer.transferHiveTokens(account, feeAccount, percentageFee.toFixed(3), tokenSymbol, 'percentage fee');
            }

            const { winners, proof } = await getWinners(hourlyWinnersPick, draw.entries, ctx);
            // Split the pot across the winners actually drawn, rounding down so
            // the payouts can never exceed the pot.
            const amountPerWinner = payoutTotal.dividedBy(Math.max(1, winners.length)).toFixed(3, BigNumber.ROUND_DOWN);

            if (proof) {
                await state.adapter.replace(COLLECTION_LOTTERY, { _id: draw._id }, {
                    ...draw,
                    status: 'completed',
                    winners: winners.map((winner: any) => winner.account),
                    fairness: proof
                });
            }

            if (winners) {
                const winnerStrings = winners.reduce((arr: string[], winner: any) => {
                    arr.push(winner.account);
                    return arr;
                }, []);

                await state.streamer.transferHiveTokensMultiple(account, winnerStrings, amountPerWinner, tokenSymbol, `Congratulations you won the hourly lottery. You won ${amountPerWinner} ${tokenSymbol}. Winners: ${winnerStrings.join(', ')}`);

                const losers = draw.entries
                    .filter((entry: any) => !winnerStrings.includes(entry.account))
                    .reduce((unique: string[], value: any) => {
                        return unique.includes(value.account) ? unique : [...unique, value.account];
                    }, []);

                if (losers.length) {
                    await state.streamer.transferHiveTokensMultiple(account, losers, '0.001', tokenSymbol, `Sorry, you didn't win the hourly draw. Winners: ${winnerStrings.join(', ')}`);
                }
            }

            return;
        }

        return;
    };

    const drawDailyLottery = async (_payload: any, ctx: any): Promise<void> => {
        const lotto = (await state.adapter.find(COLLECTION_LOTTERY, { status: 'active', type: 'daily' })) || [];

        if (lotto.length) {
            const draw = lotto[0];
            const total = draw.entries.length;

            if (total < minEntriesDaily) {
                // Mark draw as completed BEFORE refunding to prevent re-draws
                await state.adapter.replace(COLLECTION_LOTTERY, { _id: draw._id }, { ...draw, status: 'completed' });

                // Use transferHiveTokensMultiple for error isolation (one failure doesn't kill others)
                const entrants = draw.entries.reduce((arr: string[], entrant: any) => {
                    arr.push(entrant.account);
                    return arr;
                }, []);
                await state.streamer.transferHiveTokensMultiple(account, entrants, new BigNumber(cost).toFixed(3), tokenSymbol, '[Refund] The daily lotto draw did not have enough contestants.');

                return;
            }

            const balance = await getBalance();
            const winningsAmount = new BigNumber(total).multipliedBy(cost);
            const percentageFee = winningsAmount.dividedBy(100).multipliedBy(feePercentage);
            const payoutTotal = winningsAmount.minus(percentageFee);

            // Check full outgoing amount (winnings + fee) against balance
            if (balance !== null && winningsAmount.toNumber() > balance) {
                throw new Error('Balance is less than amount to pay out');
            }

            // Mark draw as completed BEFORE payouts to prevent re-draws
            await state.adapter.replace(COLLECTION_LOTTERY, { _id: draw._id }, { ...draw, status: 'completed' });

            if (account !== feeAccount) {
                await state.streamer.transferHiveTokens(account, feeAccount, percentageFee.toFixed(3), tokenSymbol, 'percentage fee');
            }

            const { winners, proof } = await getWinners(dailyWinnersPick, draw.entries, ctx);
            // Split the pot across the winners actually drawn, rounding down so
            // the payouts can never exceed the pot.
            const amountPerWinner = payoutTotal.dividedBy(Math.max(1, winners.length)).toFixed(3, BigNumber.ROUND_DOWN);

            if (proof) {
                await state.adapter.replace(COLLECTION_LOTTERY, { _id: draw._id }, {
                    ...draw,
                    status: 'completed',
                    winners: winners.map((winner: any) => winner.account),
                    fairness: proof
                });
            }

            if (winners) {
                const winnerStrings = winners.reduce((arr: string[], winner: any) => {
                    arr.push(winner.account);
                    return arr;
                }, []);

                await state.streamer.transferHiveTokensMultiple(account, winnerStrings, amountPerWinner, tokenSymbol, `Congratulations you won the daily lottery. You won ${amountPerWinner} ${tokenSymbol}`);
            }

            return;
        }

        return;
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

                const settings = await state.adapter.findOne(COLLECTION_SETTINGS, {});
                if (!settings) {
                    await state.adapter.insert(COLLECTION_SETTINGS, {
                        contractInitiated: new Date(),
                        enabled: true
                    });
                }
            }
        },
        actions: {
            buy: action(buy, {
                schema: buySchema,
                trigger: 'transfer',
                description: 'Buy a ticket for the hourly or daily draw by transferring the ticket cost.'
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
