import { getLogger } from '../logger';
import BigNumber from '../bignumber';
import seedrandom from 'seedrandom';
import { randomUUID } from 'crypto';
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

const DEFAULT_NAME = 'coinflip';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_MIN_AMOUNT = 0.001;
const DEFAULT_MAX_AMOUNT = 20;
const DEFAULT_HOUSE_EDGE = 2;
const MAX_SEED_LENGTH = 64;
const SIDES = ['heads', 'tails'] as const;

type CoinSide = typeof SIDES[number];

// Legacy RNG, used only with `fairness: false`: block ids plus an uncommitted
// per-bet server seed. Not verifiable, and a block producer can bias it.
function rng(previousBlockId: string, blockId: string, transactionId: string, serverSeed: string, clientSeed = ''): CoinSide {
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
    /** House account that receives bets and pays winners. Defaults to the streamer username. */
    account?: string;
    /** Default accepted asset (HIVE). Winnings are always paid in the asset that was bet. */
    tokenSymbol?: string;
    /** Accepted assets (HIVE and/or HBD). Defaults to `[tokenSymbol]`. */
    validCurrencies?: string[];
    minAmount?: number;
    maxAmount?: number;
    /** House edge in percent (default 2). A win pays the stake x 2 x (100 - houseEdge) / 100, rounded down. */
    houseEdge?: number;
    /** Send a 0.001 notice transfer on losses (default false; results are always recorded as events). */
    notifyLosses?: boolean;
    /**
     * Provably-fair commit-reveal draws, on by default. Pass options or a
     * shared FairnessManager to customise, or `false` for the legacy RNG
     * (block ids plus an uncommitted server seed; not verifiable).
     */
    fairness?: FairnessManager | FairnessOptions | boolean;
}

type FlipPayload = { guess: unknown; seed?: string };

export function createCoinflipContract(options: CoinflipContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const tokenSymbol = options.tokenSymbol || DEFAULT_TOKEN_SYMBOL;
    const validCurrencies = options.validCurrencies || [tokenSymbol];
    const minAmount = options.minAmount ?? DEFAULT_MIN_AMOUNT;
    const maxAmount = options.maxAmount ?? DEFAULT_MAX_AMOUNT;
    const houseEdge = options.houseEdge ?? DEFAULT_HOUSE_EDGE;
    const notifyLosses = options.notifyLosses ?? false;
    const fairSupport = createFairnessSupport(name, () => account, resolveFairnessOption(options.fairness ?? true));
    const fairness = fairSupport.fairness;

    if (!Number.isFinite(houseEdge) || houseEdge < 0 || houseEdge >= 100) {
        throw new Error('houseEdge must be a percentage from 0 to below 100');
    }

    const payoutMultiplier = new BigNumber(2).multipliedBy(new BigNumber(100).minus(houseEdge)).dividedBy(100);

    const state = {
        streamer: null as any,
        adapter: null as any,
        queue: Promise.resolve() as Promise<unknown>
    };

    const bankroll = createHouseBankroll({ streamer: () => state.streamer, account: () => account, logPrefix: '[CoinflipContract]' });

    // Typed but permissive: an unknown guess or a long seed is refunded by the
    // handler instead of failing validation and keeping the stake.
    const flipSchema = z.object({
        guess: refundableField(z.enum(SIDES)),
        seed: z.string().optional()
    });

    const processFlip = async (payload: FlipPayload, ctx: ContractContext): Promise<void> => {
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
            logPrefix: '[CoinflipContract]',
            onSent: (asset, amount) => bankroll.debit(asset, amount)
        });

        if (await settlement.alreadySettled()) {
            return;
        }

        let reserved: BigNumber | null = null;

        try {
            if (!validCurrencies.includes(bet.asset)) {
                await settlement.refund('[Refund] You sent an invalid currency.');
                return;
            }

            if (bet.value.isLessThan(minAmount)) {
                await settlement.refund(`[Refund] Bet amount too small. Minimum: ${minAmount} ${bet.asset}.`);
                return;
            }

            if (bet.value.isGreaterThan(maxAmount)) {
                await settlement.refund(`[Refund] You sent too much. Maximum: ${maxAmount} ${bet.asset}.`);
                return;
            }

            if (!SIDES.includes(payload.guess as CoinSide)) {
                await settlement.refund('[Refund] Guess must be heads or tails.');
                return;
            }

            if (payload.seed !== undefined && (typeof payload.seed !== 'string' || payload.seed.length > MAX_SEED_LENGTH)) {
                await settlement.refund(`[Refund] Seed must be a string of at most ${MAX_SEED_LENGTH} characters.`);
                return;
            }

            const guess = payload.guess as CoinSide;
            const payout = bet.value.multipliedBy(payoutMultiplier).decimalPlaces(3, BigNumber.ROUND_DOWN);

            if (payout.isGreaterThan(await bankroll.available(bet.asset))) {
                await settlement.refund('[Refund] The server cannot afford this bet payout.');
                return;
            }

            bankroll.reserve(bet.asset, payout);
            reserved = payout;

            let result: CoinSide;
            let serverSeed: string | null = null;
            let proof: FairDrawProof | null = null;

            if (fairness) {
                const draw = await fairness.draw({ type: 'coin' }, {
                    clientSeed: payload.seed || player,
                    blockId: ctx.block.id
                });
                result = draw.outcome;
                proof = draw.proof;
            } else {
                serverSeed = randomUUID();
                result = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id, serverSeed, payload.seed ?? '');
            }

            const userWon = result === guess;

            if (state.adapter?.addEvent) {
                await state.adapter.addEvent(blockTimeOf(ctx), name, 'flip', payload, {
                    action: 'transfer',
                    data: {
                        date: blockTimeOf(ctx),
                        player,
                        guess,
                        result,
                        userWon: userWon ? 'true' : 'false',
                        amount: formatBlockchainAmount(bet.value),
                        payout: userWon ? formatBlockchainAmount(payout) : '0',
                        asset: bet.asset,
                        previousBlockId: ctx.block.previousId,
                        blockId: ctx.block.id,
                        transactionId: operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex),
                        ...(proof ? { fairness: proof, outcomeSpec: { type: 'coin' } } : { serverSeed })
                    }
                });
            }

            const proofMemo = proof
                ? formatFairnessMemo(proof)
                : ` | Previous block id: ${ctx.block.previousId} | BlockID: ${ctx.block.id} | Trx ID: ${ctx.transaction.id} | Server Seed: ${serverSeed}`;

            if (userWon) {
                await settlement.send(player, formatBlockchainAmount(payout), bet.asset, `[Winner] | Guess: ${guess} | Server Roll: ${result}${proofMemo}`);
            } else if (notifyLosses) {
                await settlement.send(player, '0.001', bet.asset, `[Lost] | Guess: ${guess} | Server Roll: ${result}${proofMemo}`);
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            getLogger().error('[CoinflipContract] Flip processing error:', {
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

    const flip = (payload: FlipPayload, ctx: ContractContext): Promise<void> => {
        // Serialize bets so bankroll checks see every in-flight payout.
        const run = state.queue.then(() => processFlip(payload, ctx));
        state.queue = run.catch(() => undefined);
        return run;
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
                state.queue = Promise.resolve();
            }
        },
        actions: {
            flip: action(flip, {
                schema: flipSchema,
                trigger: 'transfer',
                description: `Bet on a provably-fair coin flip by transferring to the house account. \`guess\` must be "heads" or "tails" and \`seed\` (optional client seed) at most ${MAX_SEED_LENGTH} characters; anything else is refunded. Winners receive 2x the stake less the house edge (2% by default).`
            }),
            ...fairSupport.actions
        }
    });
}
