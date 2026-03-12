import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    assertAssetMatches,
    createContractState,
    emitContractEvent,
    getIncomingPayment,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender,
    toBigNumber
} from './helpers';

const DEFAULT_NAME = 'insurancepool';

export interface InsurancePoolContractOptions {
    name?: string;
}

export function createInsurancePoolContract(options: InsurancePoolContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createPoolSchema = z.object({
        poolId: identifierSchema,
        title: z.string().min(3).max(140),
        asset: assetSchema,
        premiumAmount: amountSchema,
        coverageCap: amountSchema,
        coverageDays: z.number().int().min(1).max(3650),
        metadata: z.record(z.any()).optional()
    });

    const poolIdSchema = z.object({
        poolId: identifierSchema
    });

    const fileClaimSchema = z.object({
        poolId: identifierSchema,
        claimId: identifierSchema,
        amount: amountSchema,
        reason: z.string().min(3).max(500)
    });

    const approveClaimSchema = z.object({
        claimId: identifierSchema,
        amount: amountSchema.optional(),
        note: z.string().max(280).optional()
    });

    const expireSchema = z.object({
        poolId: identifierSchema.optional()
    }).optional();

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS insurance_pools (
                    pool_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    premium_amount TEXT NOT NULL,
                    coverage_cap TEXT NOT NULL,
                    coverage_days INTEGER NOT NULL,
                    reserve_balance TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS insurance_policies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pool_id TEXT NOT NULL,
                    holder TEXT NOT NULL,
                    premium_paid TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    status TEXT NOT NULL,
                    purchased_at DATETIME NOT NULL,
                    expires_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(pool_id, holder)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS insurance_claims (
                    claim_id TEXT PRIMARY KEY,
                    pool_id TEXT NOT NULL,
                    holder TEXT NOT NULL,
                    requested_amount TEXT NOT NULL,
                    approved_amount TEXT,
                    reason TEXT NOT NULL,
                    status TEXT NOT NULL,
                    note TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createPool = async (payload: z.infer<typeof createPoolSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT pool_id FROM insurance_pools WHERE pool_id = ?', [payload.poolId]);
        if (existing.length > 0) {
            throw new Error(`Pool ${payload.poolId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO insurance_pools (
                pool_id, owner, title, asset, premium_amount, coverage_cap, coverage_days, reserve_balance, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.poolId,
                owner,
                payload.title,
                payload.asset,
                payload.premiumAmount,
                payload.coverageCap,
                payload.coverageDays,
                '0',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createPool', payload, {
            action: 'insurance_pool_created',
            data: {
                poolId: payload.poolId,
                owner
            }
        });
    };

    const fundPool = async (payload: z.infer<typeof poolIdSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const pools = await state.adapter.query('SELECT * FROM insurance_pools WHERE pool_id = ?', [payload.poolId]);
        if (pools.length === 0) {
            throw new Error(`Pool ${payload.poolId} does not exist`);
        }

        const pool = pools[0];
        if (pool.owner !== owner) {
            throw new Error('Only the pool owner can fund the reserve');
        }

        assertAssetMatches(payment.asset, pool.asset);
        const reserve = toBigNumber(pool.reserve_balance).plus(payment.amount);
        await state.adapter.query(
            'UPDATE insurance_pools SET reserve_balance = ?, updated_at = ? WHERE pool_id = ?',
            [reserve.toFixed(), new Date(), payload.poolId]
        );

        await emitContractEvent(state.adapter, name, 'fundPool', payload, {
            action: 'insurance_pool_funded',
            data: {
                poolId: payload.poolId,
                owner,
                reserveBalance: reserve.toFixed()
            }
        });
    };

    const buyPolicy = async (payload: z.infer<typeof poolIdSchema>, ctx: any) => {
        const holder = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const pools = await state.adapter.query('SELECT * FROM insurance_pools WHERE pool_id = ?', [payload.poolId]);
        if (pools.length === 0) {
            throw new Error(`Pool ${payload.poolId} does not exist`);
        }

        const pool = pools[0];
        assertAssetMatches(payment.asset, pool.asset);
        if (!toBigNumber(payment.amount).eq(pool.premium_amount)) {
            throw new Error(`Policy premium is ${pool.premium_amount} ${pool.asset}`);
        }

        const policyRows = await state.adapter.query('SELECT * FROM insurance_policies WHERE pool_id = ? AND holder = ?', [payload.poolId, holder]);
        const now = new Date();
        const baseDate = policyRows.length > 0 && parseDateValue(policyRows[0].expires_at) && parseDateValue(policyRows[0].expires_at)! > now
            ? parseDateValue(policyRows[0].expires_at)!
            : now;
        const expiresAt = new Date(baseDate.getTime() + Number(pool.coverage_days) * 24 * 60 * 60 * 1000);

        await state.adapter.query(
            `INSERT INTO insurance_policies (
                pool_id, holder, premium_paid, asset, status, purchased_at, expires_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pool_id, holder)
            DO UPDATE SET premium_paid = excluded.premium_paid, asset = excluded.asset, status = excluded.status, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
            [payload.poolId, holder, payment.amount, payment.asset, 'active', now, expiresAt, now]
        );

        const reserve = toBigNumber(pool.reserve_balance).plus(payment.amount);
        await state.adapter.query(
            'UPDATE insurance_pools SET reserve_balance = ?, updated_at = ? WHERE pool_id = ?',
            [reserve.toFixed(), new Date(), payload.poolId]
        );

        await emitContractEvent(state.adapter, name, 'buyPolicy', payload, {
            action: 'insurance_policy_purchased',
            data: {
                poolId: payload.poolId,
                holder,
                expiresAt
            }
        });
    };

    const fileClaim = async (payload: z.infer<typeof fileClaimSchema>, ctx: any) => {
        const holder = requireSender(ctx);
        const pools = await state.adapter.query('SELECT * FROM insurance_pools WHERE pool_id = ?', [payload.poolId]);
        const policies = await state.adapter.query('SELECT * FROM insurance_policies WHERE pool_id = ? AND holder = ?', [payload.poolId, holder]);
        if (pools.length === 0 || policies.length === 0) {
            throw new Error('Insurance policy does not exist');
        }

        const pool = pools[0];
        const policy = policies[0];
        if (policy.status !== 'active') {
            throw new Error('Insurance policy is not active');
        }

        if ((parseDateValue(policy.expires_at) || new Date()) <= new Date()) {
            throw new Error('Insurance policy has expired');
        }

        if (toBigNumber(payload.amount).gt(pool.coverage_cap)) {
            throw new Error('Claim exceeds the coverage cap');
        }

        const existing = await state.adapter.query('SELECT claim_id FROM insurance_claims WHERE claim_id = ?', [payload.claimId]);
        if (existing.length > 0) {
            throw new Error(`Claim ${payload.claimId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO insurance_claims (
                claim_id, pool_id, holder, requested_amount, approved_amount, reason, status, note, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [payload.claimId, payload.poolId, holder, payload.amount, null, payload.reason, 'pending', '', new Date(), new Date()]
        );

        await emitContractEvent(state.adapter, name, 'fileClaim', payload, {
            action: 'insurance_claim_filed',
            data: {
                claimId: payload.claimId,
                poolId: payload.poolId,
                holder,
                amount: payload.amount
            }
        });
    };

    const approveClaim = async (payload: z.infer<typeof approveClaimSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const claimRows = await state.adapter.query('SELECT * FROM insurance_claims WHERE claim_id = ?', [payload.claimId]);
        if (claimRows.length === 0) {
            throw new Error(`Claim ${payload.claimId} does not exist`);
        }

        const claim = claimRows[0];
        if (claim.status !== 'pending') {
            throw new Error(`Claim ${payload.claimId} has already been ${claim.status}`);
        }

        const poolRows = await state.adapter.query('SELECT * FROM insurance_pools WHERE pool_id = ?', [claim.pool_id]);
        const pool = poolRows[0];
        if (pool.owner !== owner) {
            throw new Error('Only the pool owner can approve claims');
        }

        const approvedAmount = payload.amount || claim.requested_amount;
        if (toBigNumber(approvedAmount).gt(pool.reserve_balance)) {
            throw new Error('Pool reserve cannot cover the approved claim amount');
        }

        const nextReserve = toBigNumber(pool.reserve_balance).minus(approvedAmount);
        await state.adapter.query(
            'UPDATE insurance_pools SET reserve_balance = ?, updated_at = ? WHERE pool_id = ?',
            [nextReserve.toFixed(), new Date(), pool.pool_id]
        );
        await state.adapter.query(
            'UPDATE insurance_claims SET approved_amount = ?, status = ?, note = ?, updated_at = ? WHERE claim_id = ?',
            [approvedAmount, 'approved', payload.note || '', new Date(), payload.claimId]
        );

        await emitContractEvent(state.adapter, name, 'approveClaim', payload, {
            action: 'insurance_claim_approved',
            data: {
                claimId: payload.claimId,
                poolId: pool.pool_id,
                holder: claim.holder,
                approvedAmount,
                asset: pool.asset
            }
        });
    };

    const expirePolicies = async (payload: { poolId?: string } = {}, _ctx: any) => {
        const policies = payload.poolId
            ? await state.adapter.query('SELECT * FROM insurance_policies WHERE pool_id = ?', [payload.poolId])
            : await state.adapter.query('SELECT * FROM insurance_policies', []);
        const now = new Date();

        for (const policy of policies) {
            const expiresAt = parseDateValue(policy.expires_at);
            if (policy.status === 'active' && expiresAt && expiresAt < now) {
                await state.adapter.query(
                    'UPDATE insurance_policies SET status = ?, updated_at = ? WHERE pool_id = ? AND holder = ?',
                    ['expired', now, policy.pool_id, policy.holder]
                );

                await emitContractEvent(state.adapter, name, 'expirePolicies', payload, {
                    action: 'insurance_policy_expired',
                    data: {
                        poolId: policy.pool_id,
                        holder: policy.holder
                    }
                });
            }
        }
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ adapter }) => {
                state.adapter = adapter;
                await initialize();
            }
        },
        actions: {
            createPool: action(createPool, { schema: createPoolSchema, trigger: 'custom_json' }),
            fundPool: action(fundPool, { schema: poolIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            buyPolicy: action(buyPolicy, { schema: poolIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            fileClaim: action(fileClaim, { schema: fileClaimSchema, trigger: 'custom_json' }),
            approveClaim: action(approveClaim, { schema: approveClaimSchema, trigger: 'custom_json' }),
            expirePolicies: action(expirePolicies, { schema: expireSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
