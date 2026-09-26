import BigNumber from '../bignumber';
import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    createContractState,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender,
    requireTransferContext,
    toBigNumber,
    resolveContractAccount
} from './helpers';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'stakingpool';
const PRECISION = 3;
const MAX_COOLDOWN_SECONDS = 365 * 24 * 60 * 60;

// Reward rates allow up to 8 decimals so small per-second emissions are expressible.
const rateSchema = z.string().regex(/^\d+(?:\.\d{1,8})?$/, 'Invalid reward rate');

export interface StakingPoolContractOptions {
    name?: string;
    /** Custody account that receives stakes and reward funding and pays them out. Defaults to the streamer username. */
    account?: string;
    /** Accounts allowed to create pools and change reward rates. Defaults to the custody account. */
    admins?: string[];
    /** 'time' accrues `rewardRate` per second of block time; 'block' accrues per block. */
    accrual?: 'time' | 'block';
}

export function createStakingPoolContract(options: StakingPoolContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    // Shared with the action guards below, so the default (the custody
    // account) is filled in once the account is resolved.
    const admins: string[] = [...(options.admins ?? [])];
    const accrual = options.accrual ?? 'time';
    const state = createContractState({ streamer: null as any });

    const poolIdSchema = z.object({ poolId: identifierSchema });

    const createPoolSchema = z.object({
        poolId: identifierSchema,
        stakeAsset: assetSchema,
        rewardAsset: assetSchema,
        rewardRate: rateSchema,
        cooldownSeconds: z.number().int().min(0).max(MAX_COOLDOWN_SECONDS).default(0),
        minStake: amountSchema.optional(),
        endsAt: z.string().optional()
    });

    const unstakeSchema = z.object({
        poolId: identifierSchema,
        amount: amountSchema
    });

    const setRewardRateSchema = z.object({
        poolId: identifierSchema,
        rewardRate: rateSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS staking_pools (
                    pool_id TEXT PRIMARY KEY,
                    creator TEXT NOT NULL,
                    stake_asset TEXT NOT NULL,
                    reward_asset TEXT NOT NULL,
                    reward_rate TEXT NOT NULL,
                    cooldown_seconds INTEGER NOT NULL,
                    min_stake TEXT NOT NULL,
                    ends_at TEXT,
                    total_staked TEXT NOT NULL,
                    acc_reward_per_share TEXT NOT NULL,
                    last_accrual TEXT NOT NULL,
                    reward_reserve TEXT NOT NULL,
                    total_accrued TEXT NOT NULL,
                    total_claimed TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS staking_positions (
                    pool_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    staked TEXT NOT NULL,
                    reward_debt TEXT NOT NULL,
                    pending_rewards TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (pool_id, account)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS staking_unbonding (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pool_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    available_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    released_at TEXT
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS staking_claims (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pool_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    status TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            `
        ]);
    };

    const nowOf = (ctx: ContractContext): Date => ctx.block?.time instanceof Date && !Number.isNaN(ctx.block.time.getTime())
        ? ctx.block.time
        : new Date();

    const accrualPoint = (ctx: ContractContext, pool?: any): BigNumber => {
        if (accrual === 'block') {
            return new BigNumber(ctx.block?.number ?? 0);
        }

        let now = nowOf(ctx);

        if (pool?.ends_at) {
            const endsAt = new Date(pool.ends_at);
            if (endsAt < now) {
                now = endsAt;
            }
        }

        return new BigNumber(Math.floor(now.getTime() / 1000));
    };

    const transfer = async (to: string, amount: string, asset: string, memo: string) => {
        if (!state.streamer) {
            throw new Error('Staking pool contract is not attached to a streamer');
        }

        await state.streamer.transferHiveTokens(account, to, amount, asset, memo);
    };

    const withTransaction = async <T>(work: (adapter: any) => Promise<T>): Promise<T> => {
        if (typeof state.adapter?.runInTransaction === 'function') {
            return state.adapter.runInTransaction(work);
        }

        return work(state.adapter);
    };

    const loadPool = async (adapter: any, poolId: string) => {
        const rows = await adapter.query('SELECT * FROM staking_pools WHERE pool_id = ?', [poolId]);
        return rows[0] || null;
    };

    /**
     * Advances the pool's reward-per-share to `point`. Rewards only accrue
     * while something is staked and never exceed the funded reserve.
     */
    const accruePool = (pool: any, point: BigNumber) => {
        const last = toBigNumber(pool.last_accrual);
        const totalStaked = toBigNumber(pool.total_staked);
        let reserve = toBigNumber(pool.reward_reserve);
        let acc = toBigNumber(pool.acc_reward_per_share);
        let totalAccrued = toBigNumber(pool.total_accrued);

        if (point.gt(last) && totalStaked.gt(0) && reserve.gt(0)) {
            let reward = toBigNumber(pool.reward_rate).multipliedBy(point.minus(last));

            if (reward.gt(reserve)) {
                reward = reserve;
            }

            acc = acc.plus(reward.dividedBy(totalStaked));
            reserve = reserve.minus(reward);
            totalAccrued = totalAccrued.plus(reward);
        }

        return {
            ...pool,
            acc_reward_per_share: acc.toFixed(),
            reward_reserve: reserve.toFixed(),
            total_accrued: totalAccrued.toFixed(),
            last_accrual: BigNumber.max(point, last).toFixed()
        };
    };

    const savePool = async (adapter: any, pool: any) => {
        await adapter.query(
            `UPDATE staking_pools SET total_staked = ?, acc_reward_per_share = ?, last_accrual = ?, reward_reserve = ?,
             total_accrued = ?, total_claimed = ?, reward_rate = ? WHERE pool_id = ?`,
            [
                pool.total_staked, pool.acc_reward_per_share, pool.last_accrual, pool.reward_reserve,
                pool.total_accrued, pool.total_claimed, pool.reward_rate, pool.pool_id
            ]
        );
    };

    const loadPosition = async (adapter: any, poolId: string, holder: string) => {
        const rows = await adapter.query('SELECT * FROM staking_positions WHERE pool_id = ? AND account = ?', [poolId, holder]);

        return rows[0] || {
            pool_id: poolId,
            account: holder,
            staked: '0',
            reward_debt: '0',
            pending_rewards: '0',
            isNew: true
        };
    };

    /** Moves everything earned since the last settlement into pending_rewards. */
    const settlePosition = (position: any, pool: any) => {
        const staked = toBigNumber(position.staked);
        const acc = toBigNumber(pool.acc_reward_per_share);
        const earned = staked.multipliedBy(acc).minus(position.reward_debt);
        const pending = toBigNumber(position.pending_rewards).plus(BigNumber.max(earned, 0));

        return { ...position, pending_rewards: pending.toFixed(), reward_debt: staked.multipliedBy(acc).toFixed() };
    };

    const savePosition = async (adapter: any, position: any, pool: any, now: Date) => {
        const debt = toBigNumber(position.staked).multipliedBy(pool.acc_reward_per_share).toFixed();

        if (position.isNew) {
            await adapter.query(
                'INSERT INTO staking_positions (pool_id, account, staked, reward_debt, pending_rewards, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
                [position.pool_id, position.account, position.staked, debt, position.pending_rewards, now.toISOString()]
            );
            return;
        }

        await adapter.query(
            'UPDATE staking_positions SET staked = ?, reward_debt = ?, pending_rewards = ?, updated_at = ? WHERE pool_id = ? AND account = ?',
            [position.staked, debt, position.pending_rewards, now.toISOString(), position.pool_id, position.account]
        );
    };

    const isAdmin = (sender: string) => admins.includes(sender);

    const createPool = async (payload: z.infer<typeof createPoolSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);

        if (!isAdmin(sender)) {
            throw new Error(`${sender} cannot create staking pools`);
        }

        const existing = await state.adapter.query('SELECT pool_id FROM staking_pools WHERE pool_id = ?', [payload.poolId]);

        if (existing.length > 0) {
            throw new Error(`Pool ${payload.poolId} already exists`);
        }

        const endsAt = parseDateValue(payload.endsAt);
        const now = nowOf(ctx);

        await state.adapter.query(
            `INSERT INTO staking_pools (
                pool_id, creator, stake_asset, reward_asset, reward_rate, cooldown_seconds, min_stake, ends_at,
                total_staked, acc_reward_per_share, last_accrual, reward_reserve, total_accrued, total_claimed, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.poolId, sender, payload.stakeAsset, payload.rewardAsset, toBigNumber(payload.rewardRate).toFixed(),
                payload.cooldownSeconds, toBigNumber(payload.minStake ?? '0.001').toFixed(PRECISION),
                endsAt ? endsAt.toISOString() : null,
                '0', '0', accrualPoint(ctx).toFixed(), '0', '0', '0', now.toISOString()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createPool', payload, {
            action: 'staking_pool_created',
            data: { poolId: payload.poolId, creator: sender, accrual }
        }, blockTimeOf(ctx));
    };

    const refund = async (to: string, amount: string, asset: string, reason: string) => {
        await transfer(to, amount, asset, `[Refund] ${reason}`);
    };

    const fundRewards = async (payload: z.infer<typeof poolIdSchema>, ctx: ContractContext) => {
        const transferCtx = requireTransferContext(ctx);
        const sender = requireSender(ctx);

        if (transferCtx.to !== account) {
            throw new Error(`Reward funding must be sent to ${account}`);
        }

        const amount = toBigNumber(transferCtx.amount);
        const pool = await loadPool(state.adapter, payload.poolId);

        if (!pool) {
            await refund(sender, amount.toFixed(PRECISION), transferCtx.asset, `Pool ${payload.poolId} does not exist`);
            return;
        }

        if (transferCtx.asset !== pool.reward_asset) {
            await refund(sender, amount.toFixed(PRECISION), transferCtx.asset, `Rewards for ${payload.poolId} are paid in ${pool.reward_asset}`);
            return;
        }

        await withTransaction(async (adapter) => {
            const current = accruePool(await loadPool(adapter, payload.poolId), accrualPoint(ctx, pool));
            current.reward_reserve = toBigNumber(current.reward_reserve).plus(amount).toFixed();
            await savePool(adapter, current);
        });

        await emitContractEvent(state.adapter, name, 'fundRewards', payload, {
            action: 'staking_rewards_funded',
            data: { poolId: payload.poolId, funder: sender, amount: amount.toFixed(PRECISION), asset: transferCtx.asset }
        }, blockTimeOf(ctx));
    };

    const stake = async (payload: z.infer<typeof poolIdSchema>, ctx: ContractContext) => {
        const transferCtx = requireTransferContext(ctx);
        const staker = requireSender(ctx);

        if (transferCtx.to !== account) {
            throw new Error(`Stakes must be sent to ${account}`);
        }

        const amount = toBigNumber(transferCtx.amount);
        const pool = await loadPool(state.adapter, payload.poolId);

        if (!pool) {
            await refund(staker, amount.toFixed(PRECISION), transferCtx.asset, `Pool ${payload.poolId} does not exist`);
            return;
        }

        if (transferCtx.asset !== pool.stake_asset) {
            await refund(staker, amount.toFixed(PRECISION), transferCtx.asset, `${payload.poolId} accepts ${pool.stake_asset} only`);
            return;
        }

        if (amount.lt(pool.min_stake)) {
            await refund(staker, amount.toFixed(PRECISION), transferCtx.asset, `Minimum stake is ${pool.min_stake} ${pool.stake_asset}`);
            return;
        }

        const now = nowOf(ctx);

        if (pool.ends_at && now >= new Date(pool.ends_at)) {
            await refund(staker, amount.toFixed(PRECISION), transferCtx.asset, `${payload.poolId} has ended`);
            return;
        }

        const position = await withTransaction(async (adapter) => {
            const current = accruePool(await loadPool(adapter, payload.poolId), accrualPoint(ctx, pool));
            const settled = settlePosition(await loadPosition(adapter, payload.poolId, staker), current);

            settled.staked = toBigNumber(settled.staked).plus(amount).toFixed();
            current.total_staked = toBigNumber(current.total_staked).plus(amount).toFixed();

            await savePool(adapter, current);
            await savePosition(adapter, settled, current, now);
            return settled;
        });

        await emitContractEvent(state.adapter, name, 'stake', payload, {
            action: 'staking_staked',
            data: { poolId: payload.poolId, account: staker, amount: amount.toFixed(PRECISION), staked: position.staked }
        }, blockTimeOf(ctx));
    };

    const releaseUnbonding = async (entry: any, ctx: ContractContext) => {
        // Claim the row first; only the caller that flips it may transfer.
        await state.adapter.query(
            'UPDATE staking_unbonding SET status = ? WHERE id = ? AND status = ?',
            ['releasing', entry.id, 'unbonding']
        );
        const rows = await state.adapter.query('SELECT status FROM staking_unbonding WHERE id = ?', [entry.id]);

        if (rows[0]?.status !== 'releasing') {
            return false;
        }

        await transfer(entry.account, entry.amount, entry.asset, `Unstaked from ${entry.pool_id}`);
        await state.adapter.query(
            'UPDATE staking_unbonding SET status = ?, released_at = ? WHERE id = ?',
            ['released', nowOf(ctx).toISOString(), entry.id]
        );

        return true;
    };

    const unstake = async (payload: z.infer<typeof unstakeSchema>, ctx: ContractContext) => {
        const staker = requireSender(ctx);
        const amount = toBigNumber(payload.amount);

        if (amount.lte(0)) {
            throw new Error('Unstake amount must be greater than zero');
        }

        const pool = await loadPool(state.adapter, payload.poolId);

        if (!pool) {
            throw new Error(`Pool ${payload.poolId} does not exist`);
        }

        const now = nowOf(ctx);
        const availableAt = new Date(now.getTime() + Number(pool.cooldown_seconds) * 1000);

        const entryId = await withTransaction(async (adapter) => {
            const current = accruePool(await loadPool(adapter, payload.poolId), accrualPoint(ctx, pool));
            const settled = settlePosition(await loadPosition(adapter, payload.poolId, staker), current);

            if (toBigNumber(settled.staked).lt(amount)) {
                throw new Error(`Cannot unstake ${amount.toFixed(PRECISION)}; staked balance is ${toBigNumber(settled.staked).toFixed(PRECISION)}`);
            }

            settled.staked = toBigNumber(settled.staked).minus(amount).toFixed();
            current.total_staked = toBigNumber(current.total_staked).minus(amount).toFixed();

            await savePool(adapter, current);
            await savePosition(adapter, settled, current, now);
            await adapter.query(
                'INSERT INTO staking_unbonding (pool_id, account, amount, asset, available_at, status, created_at, released_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [payload.poolId, staker, amount.toFixed(PRECISION), pool.stake_asset, availableAt.toISOString(), 'unbonding', now.toISOString(), null]
            );
            const rows = await adapter.query(
                'SELECT id FROM staking_unbonding WHERE pool_id = ? AND account = ? ORDER BY id DESC LIMIT 1',
                [payload.poolId, staker]
            );
            return rows[0]?.id;
        });

        await emitContractEvent(state.adapter, name, 'unstake', payload, {
            action: 'staking_unstaked',
            data: { poolId: payload.poolId, account: staker, amount: amount.toFixed(PRECISION), availableAt: availableAt.toISOString() }
        }, blockTimeOf(ctx));

        if (Number(pool.cooldown_seconds) === 0) {
            const rows = await state.adapter.query('SELECT * FROM staking_unbonding WHERE id = ?', [entryId]);
            if (rows[0]) {
                await releaseUnbonding(rows[0], ctx);
            }
        }
    };

    const withdrawMatured = async (ctx: ContractContext, holder?: string): Promise<number> => {
        const now = nowOf(ctx).toISOString();
        const params: any[] = ['unbonding', now];
        let sql = 'SELECT * FROM staking_unbonding WHERE status = ? AND available_at <= ?';

        if (holder) {
            sql += ' AND account = ?';
            params.push(holder);
        }

        const matured = await state.adapter.query(`${sql} ORDER BY id ASC`, params);
        let released = 0;

        for (const entry of matured) {
            if (await releaseUnbonding(entry, ctx)) {
                released++;
            }
        }

        return released;
    };

    const withdraw = async (_payload: z.infer<typeof poolIdSchema>, ctx: ContractContext) => {
        const staker = requireSender(ctx);
        const released = await withdrawMatured(ctx, staker);

        if (released === 0) {
            throw new Error('Nothing is ready to withdraw yet');
        }
    };

    const releaseMatured = async (_payload: Record<string, never>, ctx: ContractContext) => {
        await withdrawMatured(ctx);
    };

    const claim = async (payload: z.infer<typeof poolIdSchema>, ctx: ContractContext) => {
        const staker = requireSender(ctx);
        const pool = await loadPool(state.adapter, payload.poolId);

        if (!pool) {
            throw new Error(`Pool ${payload.poolId} does not exist`);
        }

        const now = nowOf(ctx);

        const claimRef = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);
        const payout = await withTransaction(async (adapter) => {
            const current = accruePool(await loadPool(adapter, payload.poolId), accrualPoint(ctx, pool));
            const settled = settlePosition(await loadPosition(adapter, payload.poolId, staker), current);
            // Pay whole units of the asset's precision; the remainder stays pending.
            const amount = toBigNumber(settled.pending_rewards).decimalPlaces(PRECISION, BigNumber.ROUND_DOWN);

            if (amount.lte(0)) {
                return null;
            }

            settled.pending_rewards = toBigNumber(settled.pending_rewards).minus(amount).toFixed();
            current.total_claimed = toBigNumber(current.total_claimed).plus(amount).toFixed();

            await savePool(adapter, current);
            await savePosition(adapter, settled, current, now);
            await adapter.query(
                'INSERT INTO staking_claims (pool_id, account, amount, asset, status, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [payload.poolId, staker, amount.toFixed(PRECISION), pool.reward_asset, 'pending', claimRef, now.toISOString()]
            );
            return amount.toFixed(PRECISION);
        });

        if (!payout) {
            throw new Error('No rewards to claim');
        }

        await transfer(staker, payout, pool.reward_asset, `Staking rewards from ${payload.poolId}`);
        await state.adapter.query(
            'UPDATE staking_claims SET status = ? WHERE pool_id = ? AND account = ? AND transaction_id = ?',
            ['paid', payload.poolId, staker, claimRef]
        );

        await emitContractEvent(state.adapter, name, 'claim', payload, {
            action: 'staking_rewards_claimed',
            data: { poolId: payload.poolId, account: staker, amount: payout, asset: pool.reward_asset }
        }, blockTimeOf(ctx));
    };

    const setRewardRate = async (payload: z.infer<typeof setRewardRateSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);

        if (!isAdmin(sender)) {
            throw new Error(`${sender} cannot change reward rates`);
        }

        const pool = await loadPool(state.adapter, payload.poolId);

        if (!pool) {
            throw new Error(`Pool ${payload.poolId} does not exist`);
        }

        await withTransaction(async (adapter) => {
            // Accrue at the old rate up to now before switching.
            const current = accruePool(await loadPool(adapter, payload.poolId), accrualPoint(ctx, pool));
            current.reward_rate = toBigNumber(payload.rewardRate).toFixed();
            await savePool(adapter, current);
        });

        await emitContractEvent(state.adapter, name, 'setRewardRate', payload, {
            action: 'staking_rate_changed',
            data: { poolId: payload.poolId, rewardRate: payload.rewardRate }
        }, blockTimeOf(ctx));
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { adapter, streamer } = lifecycle;
                account = resolveContractAccount('createStakingPoolContract', options.account, lifecycle);

                if (admins.length === 0) {
                    admins.push(account);
                }

                state.adapter = adapter;
                state.streamer = streamer;
                await initialize();
            }
        },
        actions: {
            createPool: action(createPool, {
                schema: createPoolSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                guards: { allowedSenders: admins },
                description: 'Admin-only: create a pool with stake/reward assets, a reward rate per second (or block), cooldown and optional end time.'
            }),
            fundRewards: action(fundRewards, {
                schema: poolIdSchema,
                trigger: 'transfer',
                description: 'Top up a pool\'s reward reserve. Rewards never accrue beyond what has been funded.'
            }),
            stake: action(stake, {
                schema: poolIdSchema,
                trigger: 'transfer',
                description: 'Stake by transferring the pool\'s stake asset; wrong assets, tiny amounts and ended pools are refunded.'
            }),
            unstake: action(unstake, {
                schema: unstakeSchema,
                trigger: 'custom_json',
                description: 'Start unbonding part of your stake; funds are released after the pool\'s cooldown.'
            }),
            withdraw: action(withdraw, {
                schema: poolIdSchema,
                trigger: 'custom_json',
                description: 'Release your matured unbonding entries.'
            }),
            claim: action(claim, {
                schema: poolIdSchema,
                trigger: 'custom_json',
                description: 'Pay out accrued rewards (rounded down to the asset precision; the remainder stays pending).'
            }),
            setRewardRate: action(setRewardRate, {
                schema: setRewardRateSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                guards: { allowedSenders: admins },
                description: 'Admin-only: change the reward rate after settling accruals at the old rate.'
            }),
            releaseMatured: action(releaseMatured, {
                schema: z.object({}),
                trigger: 'time',
                description: 'Scheduled release of every matured unbonding entry.'
            })
        }
    });
}
