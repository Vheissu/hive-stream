import { getLogger } from '../logger';
import BigNumber from '../bignumber';
import seedrandom from 'seedrandom';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { action, defineContract } from './contract';
import { createFairnessSupport, formatBlockchainAmount, formatFairnessMemo, parseBlockchainAmount, resolveContractAccount } from './helpers';
import { resolveFairnessOption, type FairDrawProof, type FairnessManager, type FairnessOptions } from '../fairness/manager';

const DEFAULT_NAME = 'coinflip';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_MIN_AMOUNT = 0.001;
const DEFAULT_MAX_AMOUNT = 20;

function rng(previousBlockId: string, blockId: string, transactionId: string, serverSeed: string, clientSeed = ''): 'heads' | 'tails' {
    if (!previousBlockId || !blockId || !transactionId || !serverSeed) {
        throw new Error('Invalid RNG parameters');
    }

    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${clientSeed}${serverSeed}`).double();
    const randomRoll = Math.floor(random * 2) + 1;

    if (randomRoll < 1 || randomRoll > 2) {
        throw new Error('RNG generated invalid result');
    }

    return randomRoll === 1 ? 'heads' : 'tails';
}

export interface CoinflipContractOptions {
    name?: string;
    account?: string;
    tokenSymbol?: string;
    validCurrencies?: string[];
    minAmount?: number;
    maxAmount?: number;
    /**
     * Provably-fair commit-reveal draws (recommended). When omitted the legacy
     * RNG (block ids plus an uncommitted per-bet server seed) is used.
     */
    fairness?: FairnessManager | FairnessOptions | boolean;
}

export function createCoinflipContract(options: CoinflipContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const tokenSymbol = options.tokenSymbol || DEFAULT_TOKEN_SYMBOL;
    const validCurrencies = options.validCurrencies || [tokenSymbol];
    const minAmount = options.minAmount ?? DEFAULT_MIN_AMOUNT;
    const maxAmount = options.maxAmount ?? DEFAULT_MAX_AMOUNT;
    const fairSupport = createFairnessSupport(name, () => account, resolveFairnessOption(options.fairness));
    const fairness = fairSupport.fairness;

    const state = {
        streamer: null as any,
        adapter: null as any,
        balanceCache: null as { balance: BigNumber; timestamp: number } | null,
        balanceCacheTimeout: 30000,
        betQueue: [] as Array<() => Promise<void>>,
        processingQueue: false,
        pendingPayouts: new BigNumber(0)
    };

    const flipSchema = z.object({
        guess: z.enum(['heads', 'tails']),
        seed: z.string().max(64).optional()
    });

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
            getLogger().error('[CoinflipContract] Error fetching balance:', error);
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
                    getLogger().error('[CoinflipContract] Queue processing error:', error);
                }
            }
        }

        state.processingQueue = false;
    };

    const processFlip = async (payload: { guess: 'heads' | 'tails'; seed?: string }, ctx: any): Promise<void> => {
        if (!ctx.transfer) {
            throw new Error('Transfer context required for flip');
        }

        const sender = ctx.sender;
        const amountRaw = ctx.transfer.rawAmount;

        try {
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

            const amountCurrency = parsedAmount.asset;
            const transaction = await state.streamer.getTransaction(ctx.block.number, ctx.transaction.id);
            const verify = await state.streamer.verifyTransfer(transaction, sender, account, amountRaw);

            const balance = await getBalance();
            const availableBalance = balance.minus(state.pendingPayouts);

            if (verify) {
                if (!validCurrencies.includes(amountCurrency)) {
                    await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] You sent an invalid currency.');
                    return;
                }

                if (amountParsed.isLessThan(minAmount)) {
                    await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, `[Refund] Bet amount too small. Minimum: ${minAmount} ${amountCurrency}.`);
                    return;
                }

                if (amountParsed.isGreaterThan(maxAmount)) {
                    await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, `[Refund] You sent too much. Maximum: ${maxAmount} ${amountCurrency}.`);
                    return;
                }

                const potentialPayout = amountParsed.multipliedBy(2);

                if (potentialPayout.isGreaterThan(availableBalance)) {
                    await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] The server cannot afford this bet payout.');
                    return;
                }

                state.pendingPayouts = state.pendingPayouts.plus(potentialPayout);
                let payoutIncremented = true;

                try {
                    let generatedGuess: 'heads' | 'tails';
                    let serverSeed: string | null = null;
                    let proof: FairDrawProof | null = null;

                    if (fairness) {
                        const draw = await fairness.draw({ type: 'coin' }, {
                            clientSeed: payload.seed || sender,
                            blockId: ctx.block.id
                        });
                        generatedGuess = draw.outcome;
                        proof = draw.proof;
                    } else {
                        serverSeed = randomUUID();
                        generatedGuess = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id, serverSeed, payload.seed ?? '');
                    }

                    const userWon = generatedGuess === payload.guess;
                    const eventData: Record<string, any> = {
                        guess: payload.guess,
                        previousBlockId: ctx.block.previousId,
                        blockId: ctx.block.id,
                        transactionId: ctx.transaction.id,
                        userWon: userWon ? 'true' : 'false'
                    };

                    if (proof) {
                        eventData.player = sender;
                        eventData.result = generatedGuess;
                        eventData.fairness = proof;
                        eventData.outcomeSpec = { type: 'coin' };
                    } else {
                        eventData.serverSeed = serverSeed;
                    }

                    if (userWon) {
                        await state.adapter.addEvent(new Date(), name, 'flip', payload, {
                            action: 'transfer',
                            data: { date: new Date(), ...eventData }
                        });

                        const winMemo = proof
                            ? `[Winner] | Guess: ${payload.guess} | Server Roll: ${generatedGuess}${formatFairnessMemo(proof)}`
                            : `[Winner] | Guess: ${payload.guess} | Server Roll: ${generatedGuess} | Previous block id: ${ctx.block.previousId} | BlockID: ${ctx.block.id} | Trx ID: ${ctx.transaction.id} | Server Seed: ${serverSeed}`;
                        await state.streamer.transferHiveTokens(account, sender, formatBlockchainAmount(potentialPayout), parsedAmount.asset, winMemo);
                        // Invalidate balance cache after payout
                        state.balanceCache = null;
                        return;
                    }

                    await state.adapter.addEvent(new Date(), name, 'flip', payload, {
                        action: 'transfer',
                        data: eventData
                    });

                    const loseMemo = proof
                        ? `[Lost] | Guess: ${payload.guess} | Server Roll: ${generatedGuess}${formatFairnessMemo(proof)}`
                        : `[Lost] | Guess: ${payload.guess} | Server Roll: ${generatedGuess} | Previous block id: ${ctx.block.previousId} | BlockID: ${ctx.block.id} | Trx ID: ${ctx.transaction.id} | Server Seed: ${serverSeed}`;
                    await state.streamer.transferHiveTokens(account, sender, '0.001', parsedAmount.asset, loseMemo);
                } finally {
                    if (payoutIncremented) {
                        state.pendingPayouts = state.pendingPayouts.minus(potentialPayout);
                        payoutIncremented = false;
                    }
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            getLogger().error('[CoinflipContract] Flip processing error:', {
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
                    }
                }
            } catch (refundError) {
                getLogger().error('[CoinflipContract] Failed to refund after error:', refundError);
            }

            throw error;
        }
    };

    const flip = async (payload: { guess: 'heads' | 'tails'; seed?: string }, ctx: any): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            state.betQueue.push(async () => {
                try {
                    await processFlip(payload, ctx);
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
            create: async (lifecycle) => {
                const { streamer, adapter } = lifecycle;
                account = resolveContractAccount('createCoinflipContract', options.account, lifecycle);
                state.streamer = streamer;
                state.adapter = adapter;
                await fairSupport.initialize(adapter);
            },
            destroy: () => {
                state.betQueue = [];
                state.processingQueue = false;
            }
        },
        actions: {
            flip: action(flip, {
                schema: flipSchema,
                trigger: 'transfer',
                description: 'Bet on heads or tails by transferring to the house account; winners receive 2x.'
            }),
            ...fairSupport.actions
        }
    });
}
