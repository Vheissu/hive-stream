import { getLogger } from '../logger';
import BigNumber from 'bignumber.js';
import seedrandom from 'seedrandom';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { action, defineContract } from './contract';
import { formatBlockchainAmount, parseBlockchainAmount } from './helpers';

const DEFAULT_NAME = 'roulette';
const DEFAULT_ACCOUNT = 'beggars';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_MIN_AMOUNT = 0.001;
const DEFAULT_MAX_AMOUNT = 20;

const BET_TYPES = ['straight', 'color', 'parity', 'dozen', 'column', 'range'] as const;
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

type RouletteBetType = typeof BET_TYPES[number];
type RouletteColor = 'red' | 'black';
type RouletteParity = 'odd' | 'even';
type RouletteRange = 'low' | 'high';
type RouletteSpinPayload = { betType: RouletteBetType; value: string | number; seed?: string };

type NormalizedSpinPayload =
    | { betType: 'straight'; value: number; seed?: string }
    | { betType: 'color'; value: RouletteColor; seed?: string }
    | { betType: 'parity'; value: RouletteParity; seed?: string }
    | { betType: 'dozen'; value: 1 | 2 | 3; seed?: string }
    | { betType: 'column'; value: 1 | 2 | 3; seed?: string }
    | { betType: 'range'; value: RouletteRange; seed?: string };

export interface RouletteContractOptions {
    name?: string;
    account?: string;
    tokenSymbol?: string;
    validCurrencies?: string[];
    minAmount?: number;
    maxAmount?: number;
}

function rng(previousBlockId: string, blockId: string, transactionId: string, serverSeed: string, clientSeed = ''): number {
    if (!previousBlockId || !blockId || !transactionId || !serverSeed) {
        throw new Error('Invalid RNG parameters');
    }

    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${clientSeed}${serverSeed}`).double();
    const winningNumber = Math.floor(random * 37);

    if (winningNumber < 0 || winningNumber > 36) {
        throw new Error('RNG generated invalid roulette result');
    }

    return winningNumber;
}

function parseNumericValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return value;
    }

    if (typeof value === 'string' && /^\d+$/.test(value)) {
        return Number.parseInt(value, 10);
    }

    return null;
}

function normalizeSpinPayload(payload: RouletteSpinPayload): NormalizedSpinPayload {
    switch (payload.betType) {
        case 'straight': {
            const parsed = parseNumericValue(payload.value);
            if (parsed === null || parsed < 0 || parsed > 36) {
                throw new Error('Straight bets require a number between 0 and 36');
            }

            return { betType: 'straight', value: parsed, seed: payload.seed };
        }
        case 'color': {
            if (payload.value !== 'red' && payload.value !== 'black') {
                throw new Error('Color bets must be red or black');
            }

            return { betType: 'color', value: payload.value, seed: payload.seed };
        }
        case 'parity': {
            if (payload.value !== 'odd' && payload.value !== 'even') {
                throw new Error('Parity bets must be odd or even');
            }

            return { betType: 'parity', value: payload.value, seed: payload.seed };
        }
        case 'dozen': {
            const parsed = parseNumericValue(payload.value);
            if (parsed !== 1 && parsed !== 2 && parsed !== 3) {
                throw new Error('Dozen bets must be 1, 2, or 3');
            }

            return { betType: 'dozen', value: parsed, seed: payload.seed };
        }
        case 'column': {
            const parsed = parseNumericValue(payload.value);
            if (parsed !== 1 && parsed !== 2 && parsed !== 3) {
                throw new Error('Column bets must be 1, 2, or 3');
            }

            return { betType: 'column', value: parsed, seed: payload.seed };
        }
        case 'range': {
            if (payload.value !== 'low' && payload.value !== 'high') {
                throw new Error('Range bets must be low or high');
            }

            return { betType: 'range', value: payload.value, seed: payload.seed };
        }
    }
}

function getPayoutMultiplier(payload: NormalizedSpinPayload): BigNumber {
    switch (payload.betType) {
        case 'straight':
            return new BigNumber(36);
        case 'dozen':
        case 'column':
            return new BigNumber(3);
        case 'color':
        case 'parity':
        case 'range':
            return new BigNumber(2);
    }
}

function getRouletteColor(number: number): RouletteColor | null {
    if (number === 0) {
        return null;
    }

    return RED_NUMBERS.has(number) ? 'red' : 'black';
}

function isWinningBet(payload: NormalizedSpinPayload, winningNumber: number): boolean {
    switch (payload.betType) {
        case 'straight':
            return payload.value === winningNumber;
        case 'color':
            return winningNumber !== 0 && getRouletteColor(winningNumber) === payload.value;
        case 'parity':
            if (winningNumber === 0) {
                return false;
            }

            return (winningNumber % 2 === 0 ? 'even' : 'odd') === payload.value;
        case 'dozen':
            if (winningNumber === 0) {
                return false;
            }

            return Math.ceil(winningNumber / 12) === payload.value;
        case 'column':
            if (winningNumber === 0) {
                return false;
            }

            return ((winningNumber - 1) % 3) + 1 === payload.value;
        case 'range':
            if (winningNumber === 0) {
                return false;
            }

            return payload.value === 'low' ? winningNumber >= 1 && winningNumber <= 18 : winningNumber >= 19 && winningNumber <= 36;
    }
}

function describeBet(payload: NormalizedSpinPayload): string {
    return `${payload.betType}:${payload.value}`;
}

function getSpinContext(number: number) {
    const color = getRouletteColor(number) ?? 'green';
    const parity = number === 0 ? 'none' : number % 2 === 0 ? 'even' : 'odd';
    const range = number === 0 ? 'none' : number <= 18 ? 'low' : 'high';

    return { color, parity, range };
}

const spinSchema = z.object({
    betType: z.enum(BET_TYPES),
    value: z.union([z.string(), z.number().int()]),
    seed: z.string().optional()
}).superRefine((payload, ctx) => {
    try {
        normalizeSpinPayload(payload as RouletteSpinPayload);
    } catch (error) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: error instanceof Error ? error.message : 'Invalid roulette payload'
        });
    }
});

export function createRouletteContract(options: RouletteContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const account = options.account || DEFAULT_ACCOUNT;
    const tokenSymbol = options.tokenSymbol || DEFAULT_TOKEN_SYMBOL;
    const validCurrencies = options.validCurrencies || [tokenSymbol];
    const minAmount = options.minAmount ?? DEFAULT_MIN_AMOUNT;
    const maxAmount = options.maxAmount ?? DEFAULT_MAX_AMOUNT;

    const state = {
        streamer: null as any,
        adapter: null as any,
        balanceCache: null as { balance: BigNumber; timestamp: number } | null,
        balanceCacheTimeout: 30000,
        betQueue: [] as Array<() => Promise<void>>,
        processingQueue: false,
        pendingPayouts: new BigNumber(0)
    };

    const invalidateBalanceCache = (): void => {
        state.balanceCache = null;
    };

    const getBalance = async (): Promise<BigNumber> => {
        const now = Date.now();

        if (state.balanceCache && (now - state.balanceCache.timestamp) < state.balanceCacheTimeout) {
            return state.balanceCache.balance;
        }

        try {
            const accountInfo = await state.streamer['client'].database.getAccounts([account]);

            if (accountInfo?.[0]) {
                const amount = parseBlockchainAmount(accountInfo[0].balance as string).value;

                state.balanceCache = {
                    balance: amount,
                    timestamp: now
                };

                return amount;
            }
        } catch (error) {
            getLogger().error('[RouletteContract] Error fetching balance:', error);
            if (state.balanceCache) {
                return state.balanceCache.balance;
            }
        }

        return new BigNumber(0);
    };

    const processQueue = async (): Promise<void> => {
        if (state.processingQueue || state.betQueue.length === 0) {
            return;
        }

        state.processingQueue = true;

        while (state.betQueue.length > 0) {
            const nextBet = state.betQueue.shift();
            if (nextBet) {
                try {
                    await nextBet();
                } catch (error) {
                    getLogger().error('[RouletteContract] Queue processing error:', error);
                }
            }
        }

        state.processingQueue = false;
    };

    const processSpin = async (payload: RouletteSpinPayload, ctx: any): Promise<void> => {
        if (!ctx.transfer) {
            throw new Error('Transfer context required for spin');
        }

        const sender = ctx.sender;
        const amountRaw = ctx.transfer.rawAmount;

        try {
            const bet = normalizeSpinPayload(payload);

            let parsedAmount;
            try {
                parsedAmount = parseBlockchainAmount(amountRaw);
            } catch (error) {
                throw new Error('Invalid amount format');
            }

            const amountParsed = parsedAmount.value;
            if (amountParsed.isNegative()) {
                throw new Error('Invalid amount value');
            }

            const transaction = await state.streamer.getTransaction(ctx.block.number, ctx.transaction.id);
            const verify = await state.streamer.verifyTransfer(transaction, sender, account, amountRaw);
            const amountCurrency = parsedAmount.asset;

            if (!verify) {
                return;
            }

            if (!validCurrencies.includes(amountCurrency)) {
                await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] You sent an invalid currency.');
                invalidateBalanceCache();
                return;
            }

            if (amountParsed.isLessThan(minAmount)) {
                await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, `[Refund] Bet amount too small. Minimum: ${minAmount} ${amountCurrency}.`);
                invalidateBalanceCache();
                return;
            }

            if (amountParsed.isGreaterThan(maxAmount)) {
                await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, `[Refund] You sent too much. Maximum: ${maxAmount} ${amountCurrency}.`);
                invalidateBalanceCache();
                return;
            }

            const potentialPayout = amountParsed.multipliedBy(getPayoutMultiplier(bet));
            const balance = await getBalance();
            const availableBalance = balance.minus(state.pendingPayouts);

            if (potentialPayout.isGreaterThan(availableBalance)) {
                await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] The server cannot afford this bet payout.');
                invalidateBalanceCache();
                return;
            }

            state.pendingPayouts = state.pendingPayouts.plus(potentialPayout);
            let payoutIncremented = true;

            try {
                const serverSeed = uuidv4();
                if (!serverSeed || typeof serverSeed !== 'string') {
                    throw new Error('Failed to generate server seed');
                }

                const winningNumber = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id, serverSeed, bet.seed ?? '');
                const spinContext = getSpinContext(winningNumber);
                const won = isWinningBet(bet, winningNumber);

                if (state.adapter?.addEvent) {
                    await state.adapter.addEvent(new Date(), name, 'spin', payload, {
                        action: 'spin_result',
                        data: {
                            player: sender,
                            betType: bet.betType,
                            betValue: String(bet.value),
                            winningNumber,
                            winningColor: spinContext.color,
                            winningParity: spinContext.parity,
                            winningRange: spinContext.range,
                            result: won ? 'win' : 'lose',
                            serverSeed,
                            blockId: ctx.block.id,
                            transactionId: ctx.transaction.id
                        }
                    });
                }

                const betDescription = describeBet(bet);
                if (won) {
                    await state.streamer.transferHiveTokens(
                        account,
                        sender,
                        formatBlockchainAmount(potentialPayout),
                        parsedAmount.asset,
                        `[Winner] | Bet: ${betDescription} | Number: ${winningNumber} | Color: ${spinContext.color} | Seed: ${serverSeed}`
                    );
                    invalidateBalanceCache();
                    return;
                }

                await state.streamer.transferHiveTokens(
                    account,
                    sender,
                    '0.001',
                    parsedAmount.asset,
                    `[Lost] | Bet: ${betDescription} | Number: ${winningNumber} | Color: ${spinContext.color} | Seed: ${serverSeed}`
                );
                invalidateBalanceCache();
            } finally {
                if (payoutIncremented) {
                    state.pendingPayouts = state.pendingPayouts.minus(potentialPayout);
                    payoutIncremented = false;
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            getLogger().error('[RouletteContract] Spin processing error:', {
                sender,
                amount: amountRaw,
                payload,
                message: error.message
            });

            try {
                if (amountRaw && typeof amountRaw === 'string' && amountRaw.includes(' ')) {
                    const parsedAmount = parseBlockchainAmount(amountRaw);
                    const amountBN = parsedAmount.value;
                    if (!amountBN.isNaN() && amountBN.isFinite() && !amountBN.isNegative()) {
                        await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] Processing error occurred.');
                        invalidateBalanceCache();
                    }
                }
            } catch (refundError) {
                getLogger().error('[RouletteContract] Failed to refund after error:', refundError);
            }

            throw error;
        }
    };

    const spin = async (payload: RouletteSpinPayload, ctx: any): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            state.betQueue.push(async () => {
                try {
                    await processSpin(payload, ctx);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            processQueue();
        });
    };

    return defineContract({
        name,
        hooks: {
            create: ({ streamer, adapter }) => {
                state.streamer = streamer;
                state.adapter = adapter;
            },
            destroy: () => {
                state.betQueue = [];
                state.processingQueue = false;
            }
        },
        actions: {
            spin: action(spin, {
                schema: spinSchema,
                trigger: 'transfer'
            })
        }
    });
}
