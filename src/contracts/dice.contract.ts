import { getLogger } from '../logger';
import BigNumber from '../bignumber';
import seedrandom from 'seedrandom';
import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    blockTimeOf,
    createBetSettlement,
    createFairnessSupport,
    createHouseBankroll,
    formatBlockchainAmount,
    formatFairnessMemo,
    refundableField,
    resolveContractAccount,
    verifyIncomingTransfer
} from './helpers';
import { resolveFairnessOption, type FairDrawProof, type FairnessManager, type FairnessOptions } from '../fairness/manager';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'hivedice';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_HOUSE_EDGE = 1;
const DEFAULT_MIN_BET = 1;
const DEFAULT_MAX_BET = 10;
const MIN_ROLL = 2;
const MAX_ROLL = 96;
const MAX_SEED_LENGTH = 64;

// Legacy block-derived RNG, used only with `fairness: false`. Biasable by the
// block producer and not verifiable by players.
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
    /** House account that receives bets and pays winners. Defaults to the streamer username. */
    account?: string;
    /** Default accepted asset (HIVE). Winnings are always paid in the asset that was bet. */
    tokenSymbol?: string;
    /** Accepted assets (HIVE and/or HBD). Defaults to `[tokenSymbol]`. */
    validCurrencies?: string[];
    /** House edge in percent (default 1). A win pays the fair odds x (100 - houseEdge) / 100, rounded down. */
    houseEdge?: number;
    minBet?: number;
    maxBet?: number;
    /** Send a 0.001 notice transfer on losses (default false; results are always recorded as events). */
    notifyLosses?: boolean;
    /**
     * Provably-fair commit-reveal draws, on by default. Pass options or a
     * shared FairnessManager to customise, or `false` for the legacy block-id
     * RNG (not verifiable, and a block producer can bias it).
     */
    fairness?: FairnessManager | FairnessOptions | boolean;
}

type RollPayload = { roll: unknown; seed?: string };

export function createDiceContract(options: DiceContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const tokenSymbol = options.tokenSymbol || DEFAULT_TOKEN_SYMBOL;
    const houseEdge = options.houseEdge ?? DEFAULT_HOUSE_EDGE;
    const minBet = options.minBet ?? DEFAULT_MIN_BET;
    const maxBet = options.maxBet ?? DEFAULT_MAX_BET;
    const validCurrencies = options.validCurrencies || [tokenSymbol];
    const notifyLosses = options.notifyLosses ?? false;
    const fairSupport = createFairnessSupport(name, () => account, resolveFairnessOption(options.fairness ?? true));
    const fairness = fairSupport.fairness;

    if (!Number.isFinite(houseEdge) || houseEdge < 0 || houseEdge >= 100) {
        throw new Error('houseEdge must be a percentage from 0 to below 100 (e.g. 1 for 1%)');
    }

    if (houseEdge > 0 && houseEdge < 1) {
        getLogger().warn(`[${name}] houseEdge is a percentage since 5.0: ${houseEdge} means ${houseEdge}%, not ${houseEdge * 100}%`);
    }

    const state = {
        streamer: null as any,
        adapter: null as any,
        queue: Promise.resolve() as Promise<unknown>
    };

    const bankroll = createHouseBankroll({ streamer: () => state.streamer, account: () => account, logPrefix: '[DiceContract]' });

    // Typed but permissive: out-of-range rolls and long seeds are refunded by
    // the handler instead of failing validation and keeping the stake.
    const rollSchema = z.object({
        roll: refundableField(z.number().int().min(MIN_ROLL).max(MAX_ROLL)),
        seed: z.string().optional()
    });

    const processRoll = async (payload: RollPayload, ctx: ContractContext): Promise<void> => {
        const bet = await verifyIncomingTransfer(state.streamer, ctx, account);
        const player = bet.from;
        const settlement = createBetSettlement({
            streamer: state.streamer,
            adapter: state.adapter,
            contract: name,
            account,
            ctx,
            player,
            amount: bet.amount,
            asset: bet.asset,
            logPrefix: '[DiceContract]',
            onSent: (asset, amount) => bankroll.debit(asset, amount)
        });

        if (await settlement.alreadySettled()) {
            return;
        }

        let reserved: BigNumber | null = null;

        try {
            if (!validCurrencies.includes(bet.asset)) {
                await settlement.refund('[Refund] Invalid bet currency.');
                return;
            }

            if (bet.value.isLessThan(minBet) || bet.value.isGreaterThan(maxBet)) {
                await settlement.refund('[Refund] You sent an invalid bet amount.');
                return;
            }

            const roll = payload.roll;

            if (typeof roll !== 'number' || !Number.isInteger(roll) || roll < MIN_ROLL || roll > MAX_ROLL) {
                await settlement.refund(`[Refund] Roll must be a whole number between ${MIN_ROLL} and ${MAX_ROLL}.`);
                return;
            }

            if (payload.seed !== undefined && (typeof payload.seed !== 'string' || payload.seed.length > MAX_SEED_LENGTH)) {
                await settlement.refund(`[Refund] Seed must be a string of at most ${MAX_SEED_LENGTH} characters.`);
                return;
            }

            const availableBalance = await bankroll.available(bet.asset);

            if (availableBalance.isLessThan(new BigNumber(minBet).multipliedBy(2))) {
                await settlement.refund('[Refund] The server could not fulfill your bet.');
                return;
            }

            const multiplier = new BigNumber(100).minus(houseEdge).dividedBy(roll);
            const payout = bet.value.multipliedBy(multiplier).decimalPlaces(3, BigNumber.ROUND_DOWN);
            const tokensWon = formatBlockchainAmount(payout);

            if (payout.isGreaterThan(availableBalance)) {
                await settlement.refund('[Refund] The server could not fulfill your bet.');
                return;
            }

            bankroll.reserve(bet.asset, payout);
            reserved = payout;

            let random: number;
            let proof: FairDrawProof | null = null;

            if (fairness) {
                const draw = await fairness.draw({ type: 'dice', sides: 100 }, {
                    clientSeed: payload.seed || player,
                    blockId: ctx.block.id
                });
                random = draw.outcome;
                proof = draw.proof;
            } else {
                random = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id);
            }

            const won = random < roll;
            const fairMemo = formatFairnessMemo(proof);

            if (state.adapter?.addEvent) {
                await state.adapter.addEvent(blockTimeOf(ctx), name, 'roll', payload, {
                    action: 'dice_result',
                    data: {
                        player,
                        guess: roll,
                        roll: random,
                        result: won ? 'win' : 'lose',
                        amount: formatBlockchainAmount(bet.value),
                        payout: won ? tokensWon : '0',
                        asset: bet.asset,
                        transactionId: operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex),
                        ...(proof ? { fairness: proof, outcomeSpec: { type: 'dice', sides: 100 } } : {})
                    }
                });
            }

            if (won) {
                await settlement.send(player, tokensWon, bet.asset, `You won ${tokensWon} ${bet.asset}. Roll: ${random}, Your guess: ${roll}${fairMemo}`);
            } else if (notifyLosses) {
                await settlement.send(player, '0.001', bet.asset, `You lost ${formatBlockchainAmount(bet.value)} ${bet.asset}. Roll: ${random}, Your guess: ${roll}${fairMemo}`);
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            getLogger().error('[DiceContract] Roll processing error:', {
                sender: player,
                amount: bet.rawAmount,
                payload,
                message: error.message
            });

            await settlement.refundAfterError(error);
            throw error;
        } finally {
            if (reserved) {
                bankroll.release(bet.asset, reserved);
            }
        }
    };

    const roll = (payload: RollPayload, ctx: ContractContext): Promise<void> => {
        // Serialize bets so bankroll checks see every in-flight payout.
        const run = state.queue.then(() => processRoll(payload, ctx));
        state.queue = run.catch(() => undefined);
        return run;
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
                state.queue = Promise.resolve();
            }
        },
        actions: {
            roll: action(roll, {
                schema: rollSchema,
                trigger: 'transfer',
                description: `Bet by transferring to the house account; you win when the provably-fair 1-100 roll is below your guess. \`roll\` must be a whole number from ${MIN_ROLL} to ${MAX_ROLL} (the win chance is roll - 1 percent) and \`seed\` (optional client seed) at most ${MAX_SEED_LENGTH} characters; anything else is refunded.`
            }),
            ...fairSupport.actions
        }
    });
}
