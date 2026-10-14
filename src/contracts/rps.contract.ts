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

const DEFAULT_NAME = 'rps';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_MIN_AMOUNT = 0.001;
const DEFAULT_MAX_AMOUNT = 20;
const DEFAULT_HOUSE_EDGE = 2;
const MAX_SEED_LENGTH = 64;

const MOVES = ['rock', 'paper', 'scissors'] as const;

type Move = typeof MOVES[number];

// Legacy RNG, used only with `fairness: false`: block ids plus an uncommitted
// per-bet server seed. Not verifiable, and a block producer can bias it.
function rng(previousBlockId: string, blockId: string, transactionId: string, serverSeed: string, clientSeed = ''): Move {
    if (!previousBlockId || !blockId || !transactionId || !serverSeed) {
        throw new Error('Invalid RNG parameters');
    }

    const random = seedrandom(`${previousBlockId}${blockId}${transactionId}${clientSeed}${serverSeed}`).double();
    const randomRoll = Math.floor(random * 3);

    return MOVES[randomRoll];
}

export interface RpsContractOptions {
    name?: string;
    /** House account that receives bets and pays winners. Defaults to the streamer username. */
    account?: string;
    /** Default accepted asset (HIVE). Winnings are always paid in the asset that was bet. */
    tokenSymbol?: string;
    /** Accepted assets (HIVE and/or HBD). Defaults to `[tokenSymbol]`. */
    validCurrencies?: string[];
    minAmount?: number;
    maxAmount?: number;
    /** House edge in percent (default 2). A win pays the stake x 2 x (100 - houseEdge) / 100, rounded down; ties are refunded. */
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

type PlayPayload = { move: unknown; seed?: string };

const beats = (player: Move, opponent: Move): boolean => {
    return (
        (player === 'rock' && opponent === 'scissors') ||
        (player === 'scissors' && opponent === 'paper') ||
        (player === 'paper' && opponent === 'rock')
    );
};

export function createRpsContract(options: RpsContractOptions = {}) {
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

    const bankroll = createHouseBankroll({ streamer: () => state.streamer, account: () => account, logPrefix: '[RpsContract]' });

    // Typed but permissive: an unknown move or a long seed is refunded by the
    // handler instead of failing validation and keeping the stake.
    const playSchema = z.object({
        move: refundableField(z.enum(MOVES)),
        seed: z.string().optional()
    });

    const processPlay = async (payload: PlayPayload, ctx: ContractContext): Promise<void> => {
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
            logPrefix: '[RpsContract]',
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

            if (!MOVES.includes(payload.move as Move)) {
                await settlement.refund('[Refund] Move must be rock, paper or scissors.');
                return;
            }

            if (payload.seed !== undefined && (typeof payload.seed !== 'string' || payload.seed.length > MAX_SEED_LENGTH)) {
                await settlement.refund(`[Refund] Seed must be a string of at most ${MAX_SEED_LENGTH} characters.`);
                return;
            }

            const move = payload.move as Move;
            const payout = bet.value.multipliedBy(payoutMultiplier).decimalPlaces(3, BigNumber.ROUND_DOWN);

            if (payout.isGreaterThan(await bankroll.available(bet.asset))) {
                await settlement.refund('[Refund] The server cannot afford this bet payout.');
                return;
            }

            bankroll.reserve(bet.asset, payout);
            reserved = payout;

            let serverMove: Move;
            let serverSeed: string | null = null;
            let proof: FairDrawProof | null = null;

            if (fairness) {
                const draw = await fairness.draw({ type: 'int', min: 0, max: 2 }, {
                    clientSeed: payload.seed || player,
                    blockId: ctx.block.id
                });
                serverMove = MOVES[draw.outcome];
                proof = draw.proof;
            } else {
                serverSeed = randomUUID();
                serverMove = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id, serverSeed, payload.seed ?? '');
            }

            const seedMemo = proof ? formatFairnessMemo(proof) : ` | Seed: ${serverSeed}`;

            let result: 'win' | 'lose' | 'tie' = 'lose';

            if (serverMove === move) {
                result = 'tie';
            } else if (beats(move, serverMove)) {
                result = 'win';
            }

            if (state.adapter?.addEvent) {
                await state.adapter.addEvent(blockTimeOf(ctx), name, 'play', payload, {
                    action: 'rps_result',
                    data: {
                        player,
                        playerMove: move,
                        serverMove,
                        ...(proof
                            ? { fairness: proof, outcomeSpec: { type: 'int', min: 0, max: 2 } }
                            : { serverSeed }),
                        result,
                        amount: formatBlockchainAmount(bet.value),
                        payout: result === 'win' ? formatBlockchainAmount(payout) : result === 'tie' ? formatBlockchainAmount(bet.value) : '0',
                        asset: bet.asset,
                        blockId: ctx.block.id,
                        transactionId: operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex)
                    }
                });
            }

            if (result === 'win') {
                await settlement.send(player, formatBlockchainAmount(payout), bet.asset, `[Winner] | You: ${move} | Server: ${serverMove}${seedMemo}`);
            } else if (result === 'tie') {
                await settlement.send(player, bet.amount, bet.asset, `[Tie] | You: ${move} | Server: ${serverMove}${seedMemo}`);
            } else if (notifyLosses) {
                await settlement.send(player, '0.001', bet.asset, `[Lost] | You: ${move} | Server: ${serverMove}${seedMemo}`);
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            getLogger().error('[RpsContract] Play processing error:', {
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

    const play = (payload: PlayPayload, ctx: ContractContext): Promise<void> => {
        // Serialize bets so bankroll checks see every in-flight payout.
        const run = state.queue.then(() => processPlay(payload, ctx));
        state.queue = run.catch(() => undefined);
        return run;
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { streamer, adapter } = lifecycle;
                account = resolveContractAccount('createRpsContract', options.account, lifecycle);
                state.streamer = streamer;
                state.adapter = adapter;
                await fairSupport.initialize(adapter);
            },
            destroy: () => {
                state.queue = Promise.resolve();
            }
        },
        actions: {
            play: action(play, {
                schema: playSchema,
                trigger: 'transfer',
                description: `Play provably-fair rock-paper-scissors against the house by transferring a wager. \`move\` must be "rock", "paper" or "scissors" and \`seed\` (optional client seed) at most ${MAX_SEED_LENGTH} characters; anything else is refunded. Wins pay 2x the stake less the house edge (2% by default); ties are refunded.`
            }),
            ...fairSupport.actions
        }
    });
}
