import { getLogger } from '../logger';
import BigNumber from '../bignumber';
import seedrandom from 'seedrandom';
import { z } from 'zod';
import { action, defineContract } from './contract';
import { createFairnessSupport, formatBlockchainAmount, formatFairnessMemo, parseBlockchainAmount, resolveContractAccount } from './helpers';
import { resolveFairnessOption, type FairDrawProof, type FairnessManager, type FairnessOptions } from '../fairness/manager';

const DEFAULT_NAME = 'hivedice';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_HOUSE_EDGE = 0.05;
const DEFAULT_MIN_BET = 1;
const DEFAULT_MAX_BET = 10;

// Legacy block-derived RNG. Biasable by the block producer; prefer the
// `fairness` option (commit-reveal) for real-money games.
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
    /**
     * Provably-fair commit-reveal draws (recommended). `true` uses defaults;
     * pass options or a shared FairnessManager to customise. When omitted the
     * legacy block-id RNG is used for backwards compatibility.
     */
    fairness?: FairnessManager | FairnessOptions | boolean;
}

export function createDiceContract(options: DiceContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const tokenSymbol = options.tokenSymbol || DEFAULT_TOKEN_SYMBOL;
    const houseEdge = options.houseEdge ?? DEFAULT_HOUSE_EDGE;
    const minBet = options.minBet ?? DEFAULT_MIN_BET;
    const maxBet = options.maxBet ?? DEFAULT_MAX_BET;
    const validCurrencies = options.validCurrencies || [tokenSymbol];
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

    const rollSchema = z.object({
        roll: z.number().int().min(2).max(96),
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
            getLogger().error('[DiceContract] Error fetching balance:', error);
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
                    getLogger().error('[DiceContract] Queue processing error:', error);
                }
            }
        }

        state.processingQueue = false;
    };

    const processRoll = async (payload: { roll: number; seed?: string }, ctx: any): Promise<void> => {
        if (!ctx.transfer) {
            throw new Error('Transfer context required for roll');
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
                if (availableBalance.isLessThan(new BigNumber(minBet * 2))) {
                    await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] The server could not fulfill your bet.');
                    return;
                }

                if (!validCurrencies.includes(amountCurrency)) {
                    await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] Invalid bet currency.');
                    return;
                }

                if (amountParsed.isLessThan(minBet) || amountParsed.isGreaterThan(maxBet)) {
                    await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] You sent an invalid bet amount.');
                    return;
                }

                const roll = payload.roll;
                const multiplier = new BigNumber(1).minus(houseEdge).multipliedBy(100).dividedBy(roll);
                const tokensWonBN = amountParsed.multipliedBy(multiplier);
                const tokensWon = formatBlockchainAmount(tokensWonBN);

                if (tokensWonBN.isGreaterThan(availableBalance)) {
                    await state.streamer.transferHiveTokens(account, sender, parsedAmount.amount, parsedAmount.asset, '[Refund] The server could not fulfill your bet.');
                    return;
                }

                state.pendingPayouts = state.pendingPayouts.plus(tokensWonBN);
                let payoutIncremented = true;

                let random: number;
                let proof: FairDrawProof | null = null;

                if (fairness) {
                    const draw = await fairness.draw({ type: 'dice', sides: 100 }, {
                        clientSeed: payload.seed || sender,
                        blockId: ctx.block.id
                    });
                    random = draw.outcome;
                    proof = draw.proof;
                } else {
                    random = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id);
                }

                const fairMemo = formatFairnessMemo(proof);
                const winningMemo = `You won ${tokensWon} ${tokenSymbol}. Roll: ${random}, Your guess: ${roll}${fairMemo}`;
                const losingMemo = `You lost ${formatBlockchainAmount(amountParsed)} ${tokenSymbol}. Roll: ${random}, Your guess: ${roll}${fairMemo}`;

                if (proof && state.adapter?.addEvent) {
                    await state.adapter.addEvent(new Date(), name, 'roll', payload, {
                        action: 'dice_result',
                        data: {
                            player: sender,
                            guess: roll,
                            roll: random,
                            result: random < roll ? 'win' : 'lose',
                            amount: formatBlockchainAmount(amountParsed),
                            payout: random < roll ? tokensWon : '0',
                            asset: amountCurrency,
                            transactionId: ctx.transaction.id,
                            fairness: proof,
                            outcomeSpec: { type: 'dice', sides: 100 }
                        }
                    });
                }

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
            getLogger().error('[DiceContract] Roll processing error:', {
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
                getLogger().error('[DiceContract] Failed to refund after error:', refundError);
            }

            throw error;
        }
    };

    const roll = async (payload: { roll: number; seed?: string }, ctx: any): Promise<void> => {
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
            create: async (lifecycle) => {
                const { streamer, adapter } = lifecycle;
                account = resolveContractAccount('createDiceContract', options.account, lifecycle);
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
            roll: action(roll, {
                schema: rollSchema,
                trigger: 'transfer',
                description: 'Bet by transferring to the house account; wins when the 1-100 roll is below your guess.'
            }),
            ...fairSupport.actions,
            testauto: action(() => {
                getLogger().debug('[DiceContract] test');
            }, {
                trigger: 'time'
            })
        }
    });
}
