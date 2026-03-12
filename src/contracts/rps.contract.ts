import BigNumber from 'bignumber.js';
import seedrandom from 'seedrandom';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { action, defineContract } from './contract';

const DEFAULT_NAME = 'rps';
const DEFAULT_ACCOUNT = 'beggars';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_MIN_AMOUNT = 0.001;
const DEFAULT_MAX_AMOUNT = 20;

const MOVES = ['rock', 'paper', 'scissors'] as const;

function rng(previousBlockId: string, blockId: string, transactionId: string, serverSeed: string, clientSeed = ''): 'rock' | 'paper' | 'scissors' {
    if (!previousBlockId || !blockId || !transactionId || !serverSeed) {
        throw new Error('Invalid RNG parameters');
    }

    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${clientSeed}${serverSeed}`).double();
    const randomRoll = Math.floor(random * 3);

    return MOVES[randomRoll];
}

export interface RpsContractOptions {
    name?: string;
    account?: string;
    tokenSymbol?: string;
    validCurrencies?: string[];
    minAmount?: number;
    maxAmount?: number;
}

export function createRpsContract(options: RpsContractOptions = {}) {
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

    const playSchema = z.object({
        move: z.enum(MOVES),
        seed: z.string().optional()
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
            console.error('[RpsContract] Error fetching balance:', error);
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
                    console.error('[RpsContract] Queue processing error:', error);
                }
            }
        }

        state.processingQueue = false;
    };

    const beats = (player: string, opponent: string): boolean => {
        return (
            (player === 'rock' && opponent === 'scissors') ||
            (player === 'scissors' && opponent === 'paper') ||
            (player === 'paper' && opponent === 'rock')
        );
    };

    const processPlay = async (payload: { move: 'rock' | 'paper' | 'scissors'; seed?: string }, ctx: any): Promise<void> => {
        if (!ctx.transfer) {
            throw new Error('Transfer context required for play');
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
                if (!validCurrencies.includes(amountCurrency)) {
                    await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] You sent an invalid currency.');
                    return;
                }

                if (amountParsed.isLessThan(minAmount)) {
                    await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], `[Refund] Bet amount too small. Minimum: ${minAmount} ${amountCurrency}.`);
                    return;
                }

                if (amountParsed.isGreaterThan(maxAmount)) {
                    await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], `[Refund] You sent too much. Maximum: ${maxAmount} ${amountCurrency}.`);
                    return;
                }

                const potentialPayout = amountParsed.multipliedBy(2);
                if (potentialPayout.isGreaterThan(availableBalance)) {
                    await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], '[Refund] The server cannot afford this bet payout.');
                    return;
                }

                state.pendingPayouts = state.pendingPayouts.plus(potentialPayout);
                let payoutIncremented = true;

                try {
                    const serverSeed = uuidv4();
                    const serverMove = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id, serverSeed, payload.seed ?? '');

                    let result: 'win' | 'lose' | 'tie' = 'lose';
                    if (serverMove === payload.move) {
                        result = 'tie';
                    } else if (beats(payload.move, serverMove)) {
                        result = 'win';
                    }

                    await state.adapter.addEvent(new Date(), name, 'play', payload, {
                        action: 'rps_result',
                        data: {
                            player: sender,
                            playerMove: payload.move,
                            serverMove,
                            serverSeed,
                            result,
                            blockId: ctx.block.id,
                            transactionId: ctx.transaction.id
                        }
                    });

                    if (result === 'win') {
                        await state.streamer.transferHiveTokens(account, sender, potentialPayout.toFixed(3), amountTrim[1], `[Winner] | You: ${payload.move} | Server: ${serverMove} | Seed: ${serverSeed}`);
                        // Invalidate balance cache after payout
                        state.balanceCache = null;
                    } else if (result === 'tie') {
                        await state.streamer.transferHiveTokens(account, sender, amountTrim[0], amountTrim[1], `[Tie] | You: ${payload.move} | Server: ${serverMove} | Seed: ${serverSeed}`);
                    } else {
                        await state.streamer.transferHiveTokens(account, sender, '0.001', amountTrim[1], `[Lost] | You: ${payload.move} | Server: ${serverMove} | Seed: ${serverSeed}`);
                    }
                } finally {
                    if (payoutIncremented) {
                        state.pendingPayouts = state.pendingPayouts.minus(potentialPayout);
                        payoutIncremented = false;
                    }
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            console.error('[RpsContract] Play processing error:', {
                sender,
                amount: amountRaw,
                payload,
                message: error.message
            });

            // Attempt refund on unexpected errors to avoid loss of funds
            try {
                if (amountRaw && typeof amountRaw === 'string' && amountRaw.includes(' ')) {
                    const parts = amountRaw.split(' ');
                    await state.streamer.transferHiveTokens(account, sender, parts[0], parts[1], '[Refund] An error occurred processing your bet.');
                }
            } catch (refundError) {
                console.error('[RpsContract] Refund failed:', refundError);
            }

            throw error;
        }
    };

    const play = async (payload: { move: 'rock' | 'paper' | 'scissors'; seed?: string }, ctx: any): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            state.betQueue.push(async () => {
                try {
                    await processPlay(payload, ctx);
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
            }
        },
        actions: {
            play: action(play, {
                schema: playSchema,
                trigger: 'transfer'
            })
        }
    });
}
