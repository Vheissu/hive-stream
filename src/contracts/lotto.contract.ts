import BigNumber from 'bignumber.js';
import seedrandom from 'seedrandom';
import { z } from 'zod';
import { action, defineContract } from './contract';
import { Utils } from '../utils';

const DEFAULT_NAME = 'hivelotto';
const DEFAULT_ACCOUNT = 'beggars';
const DEFAULT_FEE_ACCOUNT = 'beggars';
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
}

export function createLottoContract(options: LottoContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const account = options.account || DEFAULT_ACCOUNT;
    const feeAccount = options.feeAccount || DEFAULT_FEE_ACCOUNT;
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
        const amountParsed = parseFloat(amountTrim[0]);
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
            if (previousEntriesCount === maxTicketsPerUser) {
                await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] You have exceeded the allowed number of entries');
                return;
            }

            if (amountParsed > cost) {
                const difference = new BigNumber(amountParsed).minus(cost).toFixed(3);
                await state.streamer.transferHiveTokens(account, sender, difference, amountTrim[1], `[Refund] A ticket costs ${cost} ${tokenSymbol}. You sent ${amountRaw}. You were refunded ${difference} ${tokenSymbol}.`);
                return;
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

    const getWinners = async (count: number, entries: any[], ctx: any): Promise<any[]> => {
        const winners: any[] = [];

        Utils.shuffle(entries);

        for (const entry of entries) {
            if (winners.length < count) {
                const winner = entries[rng(
                    ctx.block.previousId + `${seedrandom().double()}`,
                    ctx.block.id + `${seedrandom().double()}`,
                    ctx.transaction.id + `${seedrandom().double()}`,
                    seedrandom().double(),
                    entries.length - 1
                )];

                winners.push(winner);
                await Utils.sleep(300);
            } else {
                break;
            }
        }

        return winners;
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

                await state.streamer.transferHiveTokensMultiple(account, entrants, '10.000', tokenSymbol, '[Refund] The hourly lotto draw did not have enough contestants.');
                return;
            }

            const balance = await getBalance();
            const winningsAmount = new BigNumber(total).multipliedBy(cost).toNumber();
            const percentageFee = new BigNumber(winningsAmount).dividedBy(100).multipliedBy(feePercentage);
            const payoutTotal = new BigNumber(winningsAmount).minus(percentageFee);
            const amountPerWinner = new BigNumber(payoutTotal).dividedBy(hourlyWinnersPick).toFixed(3);

            if (account !== feeAccount) {
                await state.streamer.transferHiveTokens(account, feeAccount, percentageFee.toFixed(3), tokenSymbol, 'percentage fee');
            }

            if (balance !== null && payoutTotal.toNumber() > balance) {
                throw new Error('Balance is less than amount to pay out');
            }

            const winners = await getWinners(hourlyWinnersPick, draw.entries, ctx);

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
                for (const entrant of draw.entries) {
                    await state.streamer.transferHiveTokens(account, entrant.account, '10.000', tokenSymbol, '[Refund] The daily lotto draw did not have enough contestants.');
                    await Utils.sleep(3000);
                }

                return;
            }

            const balance = await getBalance();
            const winningsAmount = new BigNumber(total).multipliedBy(cost).toNumber();
            const percentageFee = new BigNumber(winningsAmount).dividedBy(100).multipliedBy(feePercentage);
            const payoutTotal = new BigNumber(winningsAmount).minus(percentageFee);
            const amountPerWinner = new BigNumber(payoutTotal).dividedBy(dailyWinnersPick).toFixed(3);

            if (account !== feeAccount) {
                await state.streamer.transferHiveTokens(account, feeAccount, percentageFee.toFixed(3), tokenSymbol, 'percentage fee');
            }

            if (balance !== null && payoutTotal.toNumber() > balance) {
                throw new Error('Balance is less than amount to pay out');
            }

            const winners = await getWinners(dailyWinnersPick, draw.entries, ctx);

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
            create: async ({ streamer, adapter }) => {
                state.streamer = streamer;
                state.adapter = adapter;

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
                trigger: 'transfer'
            }),
            drawHourlyLottery: action(drawHourlyLottery, {
                trigger: 'time'
            }),
            drawDailyLottery: action(drawDailyLottery, {
                trigger: 'time'
            })
        }
    });
}
