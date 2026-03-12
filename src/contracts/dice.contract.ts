import BigNumber from 'bignumber.js';
import seedrandom from 'seedrandom';
import { z } from 'zod';
import { action, defineContract } from './contract';

const DEFAULT_NAME = 'hivedice';
const DEFAULT_ACCOUNT = 'beggars';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_HOUSE_EDGE = 0.05;
const DEFAULT_MIN_BET = 1;
const DEFAULT_MAX_BET = 10;

// Provably Fair Random Number Generator
const rng = (previousBlockId: string, blockId: string, transactionId: string): number => {
    if (!previousBlockId || !blockId || !transactionId) {
        throw new Error('Invalid RNG parameters');
    }

    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}`).double();
    const randomRoll = Math.floor(random * 100) + 1;

    if (randomRoll < 1 || randomRoll > 100) {
        throw new Error('RNG generated invalid result');
    }

    return randomRoll;
};

export interface DiceContractOptions {
    name?: string;
    account?: string;
    tokenSymbol?: string;
    validCurrencies?: string[];
    houseEdge?: number;
    minBet?: number;
    maxBet?: number;
}

export function createDiceContract(options: DiceContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const account = options.account || DEFAULT_ACCOUNT;
    const tokenSymbol = options.tokenSymbol || DEFAULT_TOKEN_SYMBOL;
    const houseEdge = options.houseEdge ?? DEFAULT_HOUSE_EDGE;
    const minBet = options.minBet ?? DEFAULT_MIN_BET;
    const maxBet = options.maxBet ?? DEFAULT_MAX_BET;
    const validCurrencies = options.validCurrencies || [tokenSymbol];

    const state = {
        streamer: null as any,
        adapter: null as any,
        balanceCache: null as { balance: BigNumber; timestamp: number } | null,
        balanceCacheTimeout: 30000,
        betQueue: [] as Array<() => Promise<void>>,
        processingQueue: false,
        pendingPayouts: new BigNumber(0)
    };

    const rollSchema = z.object({
        roll: z.number().int().min(2).max(96)
    });

    const getBalance = async (): Promise<BigNumber> => {
        const now = Date.now();

        if (state.balanceCache && (now - state.balanceCache.timestamp) < state.balanceCacheTimeout) {
            return state.balanceCache.balance;
        }

        try {
            const accountInfo = await state.streamer['client'].database.getAccounts([account]);

            if (accountInfo?.[0]) {
                const balanceParts = (accountInfo[0].balance as string).split(' ');
                const amount = new BigNumber(balanceParts[0]);

                if (amount.isNaN() || !amount.isFinite()) {
                    throw new Error('Invalid balance format received from API');
                }

                state.balanceCache = {
                    balance: amount,
                    timestamp: now
                };

                return amount;
            }
        } catch (error) {
            console.error('[DiceContract] Error fetching balance:', error);
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
                    console.error('[DiceContract] Queue processing error:', error);
                }
            }
        }

        state.processingQueue = false;
    };

    const processRoll = async (payload: { roll: number }, ctx: any): Promise<void> => {
        if (!ctx.transfer) {
            throw new Error('Transfer context required for roll');
        }

        const sender = ctx.sender;
        const amountRaw = ctx.transfer.rawAmount;

        try {
            if (!amountRaw || typeof amountRaw !== 'string' || !amountRaw.includes(' ')) {
                throw new Error('Invalid amount format');
            }

            const amountTrim = amountRaw.split(' ');
            if (amountTrim.length !== 2) {
                throw new Error('Invalid amount format');
            }

            const amountParsed = new BigNumber(amountTrim[0]);
            if (amountParsed.isNaN() || !amountParsed.isFinite() || amountParsed.isNegative()) {
                throw new Error('Invalid amount value');
            }

            const amountCurrency = amountTrim[1].trim();
            const transaction = await state.streamer.getTransaction(ctx.block.number, ctx.transaction.id);
            const verify = await state.streamer.verifyTransfer(transaction, sender, account, amountRaw);

            const balance = await getBalance();
            const availableBalance = balance.minus(state.pendingPayouts);

            if (verify) {
                if (availableBalance.isLessThan(new BigNumber(minBet * 2))) {
                    await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] The server could not fulfill your bet.');
                    return;
                }

                if (!validCurrencies.includes(amountCurrency)) {
                    await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] Invalid bet currency.');
                    return;
                }

                if (amountParsed.isLessThan(minBet) || amountParsed.isGreaterThan(maxBet)) {
                    await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] You sent an invalid bet amount.');
                    return;
                }

                const roll = payload.roll;
                const multiplier = new BigNumber(1).minus(houseEdge).multipliedBy(100).dividedBy(roll);
                const tokensWonBN = amountParsed.multipliedBy(multiplier);
                const tokensWon = tokensWonBN.toFixed(3, BigNumber.ROUND_DOWN);

                if (tokensWonBN.isGreaterThan(availableBalance)) {
                    await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] The server could not fulfill your bet.');
                    return;
                }

                state.pendingPayouts = state.pendingPayouts.plus(tokensWonBN);
                let payoutIncremented = true;

                const random = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id);
                const winningMemo = `You won ${tokensWon} ${tokenSymbol}. Roll: ${random}, Your guess: ${roll}`;
                const losingMemo = `You lost ${amountParsed.toFixed(3)} ${tokenSymbol}. Roll: ${random}, Your guess: ${roll}`;

                try {
                    if (random < roll) {
                        await state.streamer.transferHiveTokens(account, sender, tokensWon, tokenSymbol, winningMemo);
                        // Invalidate balance cache after payout
                        state.balanceCache = null;
                    } else {
                        await state.streamer.transferHiveTokens(account, sender, '0.001', tokenSymbol, losingMemo);
                    }
                } finally {
                    if (payoutIncremented) {
                        state.pendingPayouts = state.pendingPayouts.minus(tokensWonBN);
                        payoutIncremented = false;
                    }
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error('[DiceContract] Roll processing error:', {
                sender,
                amount: amountRaw,
                payload,
                message: error.message
            });

            try {
                if (amountRaw && typeof amountRaw === 'string' && amountRaw.includes(' ')) {
                    const [amountStr, currency] = amountRaw.split(' ');
                    const amountBN = new BigNumber(amountStr);
                    if (!amountBN.isNaN() && amountBN.isFinite() && !amountBN.isNegative()) {
                        await state.streamer.transferHiveTokens(account, sender, amountStr, currency, '[Refund] Processing error occurred.');
                    }
                }
            } catch (refundError) {
                console.error('[DiceContract] Failed to refund after error:', refundError);
            }

            throw error;
        }
    };

    const roll = async (payload: { roll: number }, ctx: any): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            state.betQueue.push(async () => {
                try {
                    await processRoll(payload, ctx);
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
            roll: action(roll, {
                schema: rollSchema,
                trigger: 'transfer'
            }),
            testauto: action(() => {
                console.log('[DiceContract] test');
            }, {
                trigger: 'time'
            })
        }
    });
}
