import BigNumber from '../bignumber';
import { z } from 'zod';
import { getLogger } from '../logger';
import { action, defineContract } from './contract';
import {
    blockTimeOf,
    createBetSettlement,
    createFairnessSupport,
    emitContractEvent,
    formatFairnessMemo,
    requireSender,
    requireTransferContext,
    toBigNumber,
    resolveContractAccount
} from './helpers';
import { parseMultiplierCents, formatMultiplierCents } from '../fairness/core';
import { FairnessManager, resolveFairnessOption, type FairnessOptions } from '../fairness/manager';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'limbo';
const PRECISION = 3;

export interface LimboContractOptions {
    name?: string;
    /** House account that receives bets and pays winners. Defaults to the streamer username. */
    account?: string;
    /** Accepted assets. Defaults to HIVE. */
    assets?: string[];
    /** House edge in basis points (default 100 = 1%). */
    houseEdgeBps?: number;
    minBet?: string;
    maxBet?: string;
    /** Lowest and highest target multipliers a player may choose. */
    minTarget?: string;
    maxTarget?: string;
    /** Absolute cap on any single payout, in the bet's asset. */
    maxPayout?: string;
    /** Cap any single payout at this share of the available bankroll (basis points, default 100 = 1%). */
    maxPayoutBankrollBps?: number;
    /** Send a 0.001 notice transfer on losses (default false; results are always recorded as events). */
    notifyLosses?: boolean;
    /** Fairness configuration. Always enabled for this game; defaults to block-entropy commit-reveal. */
    fairness?: FairnessManager | FairnessOptions;
}

export function createLimboContract(options: LimboContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const assets = options.assets || ['HIVE'];
    const houseEdgeBps = options.houseEdgeBps ?? 100;
    const minBet = toBigNumber(options.minBet ?? '0.1');
    const maxBet = toBigNumber(options.maxBet ?? '100');
    const minTargetCents = parseMultiplierCents(options.minTarget ?? '1.01');
    const maxTargetCents = parseMultiplierCents(options.maxTarget ?? '1000');
    const maxPayout = options.maxPayout !== undefined ? toBigNumber(options.maxPayout) : null;
    const maxPayoutBankrollBps = options.maxPayoutBankrollBps ?? 100;
    const notifyLosses = options.notifyLosses ?? false;

    if (!Number.isInteger(houseEdgeBps) || houseEdgeBps < 0 || houseEdgeBps >= 10000) {
        throw new Error('houseEdgeBps must be an integer between 0 and 9999');
    }

    if (minTargetCents === null || maxTargetCents === null || minTargetCents <= 100 || maxTargetCents < minTargetCents) {
        throw new Error('Targets must be multipliers above 1.00 with minTarget <= maxTarget');
    }

    if (!Number.isInteger(maxPayoutBankrollBps) || maxPayoutBankrollBps < 1 || maxPayoutBankrollBps > 10000) {
        throw new Error('maxPayoutBankrollBps must be an integer between 1 and 10000');
    }

    const fairSupport = createFairnessSupport(name, () => account, resolveFairnessOption(options.fairness ?? true));
    const fairness = fairSupport.fairness!;

    const state = {
        streamer: null as any,
        adapter: null as any,
        queue: Promise.resolve() as Promise<unknown>,
        pendingPayouts: new BigNumber(0)
    };

    const betSchema = z.object({
        target: z.union([z.string(), z.number()]).optional(),
        seed: z.string().max(64).optional()
    });

    const getBankroll = async (asset: string): Promise<BigNumber> => {
        const accounts = await state.streamer.getClient().database.getAccounts([account]);
        const info = accounts?.[0];

        if (!info) {
            return new BigNumber(0);
        }

        const raw = asset === 'HBD' ? info.hbd_balance : info.balance;
        const [value] = String(raw ?? '0').split(' ');
        return toBigNumber(value || '0');
    };

    const processBet = async (payload: z.infer<typeof betSchema>, ctx: ContractContext) => {
        const transferCtx = requireTransferContext(ctx);
        const player = requireSender(ctx);

        if (transferCtx.to !== account) {
            throw new Error(`Bets must be sent to ${account}`);
        }

        const amount = toBigNumber(transferCtx.amount);
        const asset = transferCtx.asset;
        // Writes a settlement key before the first transfer, so a re-run of
        // this operation (errorPolicy 'retry', replay after a crash) cannot
        // draw and pay again.
        const settlement = createBetSettlement({
            streamer: state.streamer,
            adapter: state.adapter,
            contract: name,
            account,
            ctx,
            player,
            amount: amount.toFixed(PRECISION),
            asset,
            logPrefix: '[LimboContract]'
        });
        const transfer = (to: string, value: string, transferAsset: string, memo: string) => settlement.send(to, value, transferAsset, memo);

        if (await settlement.alreadySettled()) {
            return;
        }

        const refund = async (reason: string) => {
            await transfer(player, amount.toFixed(PRECISION), asset, `[Refund] ${reason}`);
            await emitContractEvent(state.adapter, name, 'bet', payload, {
                action: 'limbo_refund',
                data: { player, reason, amount: amount.toFixed(PRECISION), asset, transactionId: operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex) }
            }, blockTimeOf(ctx));
        };

        if (!assets.includes(asset)) {
            await refund(`Unsupported asset ${asset}`);
            return;
        }

        if (amount.lt(minBet) || amount.gt(maxBet)) {
            await refund(`Bets must be between ${minBet.toFixed(PRECISION)} and ${maxBet.toFixed(PRECISION)} ${asset}`);
            return;
        }

        const targetCents = payload.target === undefined ? null : parseMultiplierCents(payload.target);

        if (targetCents === null || targetCents < minTargetCents! || targetCents > maxTargetCents!) {
            await refund(`Target must be between ${formatMultiplierCents(minTargetCents!)}x and ${formatMultiplierCents(maxTargetCents!)}x`);
            return;
        }

        const payout = amount.multipliedBy(targetCents).dividedBy(100).decimalPlaces(PRECISION, BigNumber.ROUND_DOWN);
        const bankroll = (await getBankroll(asset)).minus(state.pendingPayouts);
        const bankrollCap = bankroll.multipliedBy(maxPayoutBankrollBps).dividedBy(10000);

        if (maxPayout && payout.gt(maxPayout)) {
            await refund(`Maximum payout is ${maxPayout.toFixed(PRECISION)} ${asset}`);
            return;
        }

        if (payout.gt(bankrollCap)) {
            await refund('The house cannot cover this payout right now');
            return;
        }

        state.pendingPayouts = state.pendingPayouts.plus(payout);

        try {
            let draw;

            try {
                draw = await fairness.draw({ type: 'crash', houseEdgeBps }, {
                    clientSeed: payload.seed || player,
                    blockId: ctx.block.id
                });
            } catch (error) {
                // No outcome was produced, so the player must get their stake back.
                await refund('The bet could not be settled');
                throw error;
            }

            const won = draw.outcome.multiplierCents >= targetCents;
            const target = formatMultiplierCents(targetCents);

            await emitContractEvent(state.adapter, name, 'bet', payload, {
                action: 'limbo_result',
                data: {
                    player,
                    amount: amount.toFixed(PRECISION),
                    asset,
                    target,
                    result: draw.outcome.multiplier,
                    won,
                    payout: won ? payout.toFixed(PRECISION) : '0.000',
                    transactionId: operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex),
                    fairness: draw.proof,
                    outcomeSpec: { type: 'crash', houseEdgeBps }
                }
            }, blockTimeOf(ctx));

            const fairMemo = formatFairnessMemo(draw.proof);

            if (won) {
                await transfer(player, payout.toFixed(PRECISION), asset, `[Win] Target ${target}x | Result ${draw.outcome.multiplier}x${fairMemo}`);
            } else if (notifyLosses) {
                await transfer(player, '0.001', asset, `[Lost] Target ${target}x | Result ${draw.outcome.multiplier}x${fairMemo}`);
            }
        } finally {
            state.pendingPayouts = state.pendingPayouts.minus(payout);
        }
    };

    const bet = (payload: z.infer<typeof betSchema>, ctx: ContractContext): Promise<void> => {
        // Serialize bets so bankroll checks see every in-flight payout.
        const run = state.queue.then(() => processBet(payload, ctx));
        state.queue = run.catch((error) => {
            getLogger().error('[LimboContract] Bet processing error:', error);
        });
        return run;
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { streamer, adapter } = lifecycle;
                account = resolveContractAccount('createLimboContract', options.account, lifecycle);
                state.streamer = streamer;
                state.adapter = adapter;
                await fairSupport.initialize(adapter);
            }
        },
        actions: {
            bet: action(bet, {
                schema: betSchema,
                trigger: 'transfer',
                description: 'Bet with a target multiplier (e.g. "2.5"); you win bet x target when the provably-fair result reaches it.'
            }),
            ...fairSupport.actions
        }
    });
}
