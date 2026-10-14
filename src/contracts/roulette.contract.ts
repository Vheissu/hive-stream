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

const DEFAULT_NAME = 'roulette';
const DEFAULT_TOKEN_SYMBOL = 'HIVE';
const DEFAULT_MIN_AMOUNT = 0.001;
const DEFAULT_MAX_AMOUNT = 20;
const MAX_SEED_LENGTH = 64;

const BET_TYPES = ['straight', 'color', 'parity', 'dozen', 'column', 'range'] as const;
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

type RouletteColor = 'red' | 'black';
type RouletteParity = 'odd' | 'even';
type RouletteRange = 'low' | 'high';
type RouletteSpinPayload = { betType: unknown; value: unknown; seed?: string };

type NormalizedSpinPayload =
    | { betType: 'straight'; value: number; seed?: string }
    | { betType: 'color'; value: RouletteColor; seed?: string }
    | { betType: 'parity'; value: RouletteParity; seed?: string }
    | { betType: 'dozen'; value: 1 | 2 | 3; seed?: string }
    | { betType: 'column'; value: 1 | 2 | 3; seed?: string }
    | { betType: 'range'; value: RouletteRange; seed?: string };

export interface RouletteContractOptions {
    name?: string;
    /** House account that receives bets and pays winners. Defaults to the streamer username. */
    account?: string;
    /** Default accepted asset (HIVE). Winnings are always paid in the asset that was bet. */
    tokenSymbol?: string;
    /** Accepted assets (HIVE and/or HBD). Defaults to `[tokenSymbol]`. */
    validCurrencies?: string[];
    minAmount?: number;
    maxAmount?: number;
    /** Send a 0.001 notice transfer on losses (default false; results are always recorded as events). */
    notifyLosses?: boolean;
    /**
     * Provably-fair commit-reveal draws, on by default. Pass options or a
     * shared FairnessManager to customise, or `false` for the legacy RNG
     * (block ids plus an uncommitted server seed; not verifiable).
     */
    fairness?: FairnessManager | FairnessOptions | boolean;
}

// Legacy RNG, used only with `fairness: false`: block ids plus an uncommitted
// per-bet server seed. Not verifiable, and a block producer can bias it.
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
        default:
            throw new Error(`Bet type must be one of ${BET_TYPES.join(', ')}`);
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

// Typed but permissive: an unknown bet type, an out-of-range value or a long
// seed is refunded by the handler instead of failing validation and keeping
// the stake.
const spinSchema = z.object({
    betType: refundableField(z.enum(BET_TYPES)),
    value: refundableField(z.union([z.string(), z.number().int()])),
    seed: z.string().optional()
});

export function createRouletteContract(options: RouletteContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const tokenSymbol = options.tokenSymbol || DEFAULT_TOKEN_SYMBOL;
    const validCurrencies = options.validCurrencies || [tokenSymbol];
    const minAmount = options.minAmount ?? DEFAULT_MIN_AMOUNT;
    const maxAmount = options.maxAmount ?? DEFAULT_MAX_AMOUNT;
    const notifyLosses = options.notifyLosses ?? false;
    const fairSupport = createFairnessSupport(name, () => account, resolveFairnessOption(options.fairness ?? true));
    const fairness = fairSupport.fairness;

    const state = {
        streamer: null as any,
        adapter: null as any,
        queue: Promise.resolve() as Promise<unknown>
    };

    const bankroll = createHouseBankroll({ streamer: () => state.streamer, account: () => account, logPrefix: '[RouletteContract]' });

    const processSpin = async (payload: RouletteSpinPayload, ctx: ContractContext): Promise<void> => {
        const incoming = await verifyIncomingTransfer(state.streamer, ctx, account);
        const player = incoming.from;
        const settlement = createBetSettlement({
            streamer: state.streamer,
            adapter: state.adapter,
            contract: name,
            account,
            ctx,
            player,
            amount: incoming.amount,
            asset: incoming.asset,
            logPrefix: '[RouletteContract]',
            onSent: (asset, amount) => bankroll.debit(asset, amount)
        });

        if (await settlement.alreadySettled()) {
            return;
        }

        let reserved: BigNumber | null = null;

        try {
            if (!validCurrencies.includes(incoming.asset)) {
                await settlement.refund('[Refund] You sent an invalid currency.');
                return;
            }

            if (incoming.value.isLessThan(minAmount)) {
                await settlement.refund(`[Refund] Bet amount too small. Minimum: ${minAmount} ${incoming.asset}.`);
                return;
            }

            if (incoming.value.isGreaterThan(maxAmount)) {
                await settlement.refund(`[Refund] You sent too much. Maximum: ${maxAmount} ${incoming.asset}.`);
                return;
            }

            let bet: NormalizedSpinPayload;

            try {
                bet = normalizeSpinPayload(payload);
            } catch (error) {
                await settlement.refund(`[Refund] ${error instanceof Error ? error.message : 'Invalid roulette bet'}.`);
                return;
            }

            if (bet.seed !== undefined && (typeof bet.seed !== 'string' || bet.seed.length > MAX_SEED_LENGTH)) {
                await settlement.refund(`[Refund] Seed must be a string of at most ${MAX_SEED_LENGTH} characters.`);
                return;
            }

            // Standard single-zero odds: payouts are whole multiples of the
            // stake, so the zero is the house edge at every bet size.
            const potentialPayout = incoming.value.multipliedBy(getPayoutMultiplier(bet)).decimalPlaces(3, BigNumber.ROUND_DOWN);

            if (potentialPayout.isGreaterThan(await bankroll.available(incoming.asset))) {
                await settlement.refund('[Refund] The server cannot afford this bet payout.');
                return;
            }

            bankroll.reserve(incoming.asset, potentialPayout);
            reserved = potentialPayout;

            let winningNumber: number;
            let serverSeed: string | null = null;
            let proof: FairDrawProof | null = null;

            if (fairness) {
                const draw = await fairness.draw({ type: 'roulette' }, {
                    clientSeed: bet.seed || player,
                    blockId: ctx.block.id
                });
                winningNumber = draw.outcome;
                proof = draw.proof;
            } else {
                serverSeed = randomUUID();
                winningNumber = rng(ctx.block.previousId, ctx.block.id, ctx.transaction.id, serverSeed, bet.seed ?? '');
            }

            const spinContext = getSpinContext(winningNumber);
            const won = isWinningBet(bet, winningNumber);

            if (state.adapter?.addEvent) {
                await state.adapter.addEvent(blockTimeOf(ctx), name, 'spin', payload, {
                    action: 'spin_result',
                    data: {
                        player,
                        betType: bet.betType,
                        betValue: String(bet.value),
                        winningNumber,
                        winningColor: spinContext.color,
                        winningParity: spinContext.parity,
                        winningRange: spinContext.range,
                        result: won ? 'win' : 'lose',
                        amount: formatBlockchainAmount(incoming.value),
                        payout: won ? formatBlockchainAmount(potentialPayout) : '0',
                        asset: incoming.asset,
                        ...(proof
                            ? { fairness: proof, outcomeSpec: { type: 'roulette' } }
                            : { serverSeed }),
                        blockId: ctx.block.id,
                        transactionId: operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex)
                    }
                });
            }

            const betDescription = describeBet(bet);
            const seedMemo = proof ? formatFairnessMemo(proof) : ` | Seed: ${serverSeed}`;

            if (won) {
                await settlement.send(
                    player,
                    formatBlockchainAmount(potentialPayout),
                    incoming.asset,
                    `[Winner] | Bet: ${betDescription} | Number: ${winningNumber} | Color: ${spinContext.color}${seedMemo}`
                );
            } else if (notifyLosses) {
                await settlement.send(
                    player,
                    '0.001',
                    incoming.asset,
                    `[Lost] | Bet: ${betDescription} | Number: ${winningNumber} | Color: ${spinContext.color}${seedMemo}`
                );
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            getLogger().error('[RouletteContract] Spin processing error:', {
                sender: player,
                amount: incoming.rawAmount,
                payload,
                message: error.message
            });

            await settlement.refundAfterError(error);
            throw error;
        } finally {
            if (reserved) {
                bankroll.release(incoming.asset, reserved);
            }
        }
    };

    const spin = (payload: RouletteSpinPayload, ctx: ContractContext): Promise<void> => {
        // Serialize bets so bankroll checks see every in-flight payout.
        const run = state.queue.then(() => processSpin(payload, ctx));
        state.queue = run.catch(() => undefined);
        return run;
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { streamer, adapter } = lifecycle;
                account = resolveContractAccount('createRouletteContract', options.account, lifecycle);
                state.streamer = streamer;
                state.adapter = adapter;
                await fairSupport.initialize(adapter);
            },
            destroy: () => {
                state.queue = Promise.resolve();
            }
        },
        actions: {
            spin: action(spin, {
                schema: spinSchema,
                trigger: 'transfer',
                description: `Place a provably-fair single-zero roulette bet by transferring to the house account. \`betType\`/\`value\`: straight 0-36 (pays 36x), color red/black, parity odd/even, range low/high (2x), dozen or column 1-3 (3x). \`seed\` (optional client seed) at most ${MAX_SEED_LENGTH} characters. Invalid bets are refunded.`
            }),
            ...fairSupport.actions
        }
    });
}
