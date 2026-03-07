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

const DEFAULT_NAME = 'subscriptions';

export interface SubscriptionContractOptions {
    name?: string;
}

export function createSubscriptionContract(options: SubscriptionContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createPlanSchema = z.object({
        planId: identifierSchema,
        title: z.string().min(3).max(140),
        price: amountSchema,
        asset: assetSchema,
        intervalDays: z.number().int().min(1).max(365),
        graceDays: z.number().int().min(0).max(90).optional(),
        metadata: z.record(z.any()).optional()
    });

    const updatePlanSchema = z.object({
        planId: identifierSchema,
        title: z.string().min(3).max(140).optional(),
        price: amountSchema.optional(),
        asset: assetSchema.optional(),
        intervalDays: z.number().int().min(1).max(365).optional(),
        graceDays: z.number().int().min(0).max(90).optional(),
        active: z.boolean().optional(),
        metadata: z.record(z.any()).optional()
    });

    const planIdSchema = z.object({
        planId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS subscription_plans (
                    plan_id TEXT PRIMARY KEY,
                    creator TEXT NOT NULL,
                    title TEXT NOT NULL,
                    price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    interval_days INTEGER NOT NULL,
                    grace_days INTEGER NOT NULL,
                    active INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS subscription_memberships (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id TEXT NOT NULL,
                    subscriber TEXT NOT NULL,
                    status TEXT NOT NULL,
                    starts_at DATETIME NOT NULL,
                    active_until DATETIME NOT NULL,
                    renewals INTEGER NOT NULL,
                    last_amount TEXT NOT NULL,
                    last_asset TEXT NOT NULL,
                    last_source TEXT NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(plan_id, subscriber)
                )
            `
        ]);
    };

    const createPlan = async (payload: z.infer<typeof createPlanSchema>, ctx: any) => {
        const creator = requireSender(ctx);
        const existing = await state.adapter.query('SELECT plan_id FROM subscription_plans WHERE plan_id = ?', [payload.planId]);
        if (existing.length > 0) {
            throw new Error(`Plan ${payload.planId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO subscription_plans (
                plan_id, creator, title, price, asset, interval_days, grace_days, active, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.planId,
                creator,
                payload.title,
                payload.price,
                payload.asset,
                payload.intervalDays,
                payload.graceDays || 0,
                1,
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createPlan', payload, {
            action: 'subscription_plan_created',
            data: {
                planId: payload.planId,
                creator
            }
        });
    };

    const updatePlan = async (payload: z.infer<typeof updatePlanSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM subscription_plans WHERE plan_id = ?', [payload.planId]);
        if (rows.length === 0) {
            throw new Error(`Plan ${payload.planId} does not exist`);
        }

        const plan = rows[0];
        if (plan.creator !== sender) {
            throw new Error('Only the plan creator can update this plan');
        }

        await state.adapter.query(
            `UPDATE subscription_plans
             SET title = ?, price = ?, asset = ?, interval_days = ?, grace_days = ?, active = ?, metadata = ?, updated_at = ?
             WHERE plan_id = ?`,
            [
                payload.title || plan.title,
                payload.price || plan.price,
                payload.asset || plan.asset,
                payload.intervalDays || plan.interval_days,
                typeof payload.graceDays === 'number' ? payload.graceDays : plan.grace_days,
                typeof payload.active === 'boolean' ? (payload.active ? 1 : 0) : plan.active,
                JSON.stringify(payload.metadata || JSON.parse(plan.metadata || '{}')),
                new Date(),
                payload.planId
            ]
        );

        await emitContractEvent(state.adapter, name, 'updatePlan', payload, {
            action: 'subscription_plan_updated',
            data: {
                planId: payload.planId,
                creator: sender
            }
        });
    };

    const subscribe = async (payload: z.infer<typeof planIdSchema>, ctx: any) => {
        const subscriber = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const planRows = await state.adapter.query('SELECT * FROM subscription_plans WHERE plan_id = ?', [payload.planId]);
        if (planRows.length === 0) {
            throw new Error(`Plan ${payload.planId} does not exist`);
        }

        const plan = planRows[0];
        if (!plan.active) {
            throw new Error('Plan is not active');
        }

        assertAssetMatches(payment.asset, plan.asset);
        if (toBigNumber(payment.amount).lt(plan.price)) {
            throw new Error('Payment amount is below the plan price');
        }

        const membershipRows = await state.adapter.query(
            'SELECT * FROM subscription_memberships WHERE plan_id = ? AND subscriber = ?',
            [payload.planId, subscriber]
        );

        const now = new Date();
        const baseDate = membershipRows.length > 0 && parseDateValue(membershipRows[0].active_until) && parseDateValue(membershipRows[0].active_until)! > now
            ? parseDateValue(membershipRows[0].active_until)!
            : now;
        const activeUntil = new Date(baseDate.getTime() + Number(plan.interval_days) * 24 * 60 * 60 * 1000);

        if (membershipRows.length === 0) {
            await state.adapter.query(
                `INSERT INTO subscription_memberships (
                    plan_id, subscriber, status, starts_at, active_until, renewals, last_amount, last_asset, last_source, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [payload.planId, subscriber, 'active', now, activeUntil, 1, payment.amount, payment.asset, payment.source, now]
            );
        } else {
            const membership = membershipRows[0];
            await state.adapter.query(
                `UPDATE subscription_memberships
                 SET status = ?, active_until = ?, renewals = ?, last_amount = ?, last_asset = ?, last_source = ?, updated_at = ?
                 WHERE plan_id = ? AND subscriber = ?`,
                [
                    'active',
                    activeUntil,
                    Number(membership.renewals || 0) + 1,
                    payment.amount,
                    payment.asset,
                    payment.source,
                    now,
                    payload.planId,
                    subscriber
                ]
            );
        }

        await emitContractEvent(state.adapter, name, 'subscribe', payload, {
            action: 'subscription_renewed',
            data: {
                planId: payload.planId,
                subscriber,
                activeUntil,
                source: payment.source
            }
        });
    };

    const cancel = async (payload: z.infer<typeof planIdSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const membershipRows = await state.adapter.query(
            'SELECT * FROM subscription_memberships WHERE plan_id = ? AND subscriber = ?',
            [payload.planId, sender]
        );
        if (membershipRows.length === 0) {
            throw new Error('Subscription does not exist');
        }

        await state.adapter.query(
            'UPDATE subscription_memberships SET status = ?, updated_at = ? WHERE plan_id = ? AND subscriber = ?',
            ['cancelled', new Date(), payload.planId, sender]
        );

        await emitContractEvent(state.adapter, name, 'cancelSubscription', payload, {
            action: 'subscription_cancelled',
            data: {
                planId: payload.planId,
                subscriber: sender
            }
        });
    };

    const expireMemberships = async (payload: { planId?: string } = {}, ctx: any) => {
        const plans = payload.planId
            ? await state.adapter.query('SELECT * FROM subscription_plans WHERE plan_id = ?', [payload.planId])
            : await state.adapter.query('SELECT * FROM subscription_plans', []);

        const now = new Date();
        for (const plan of plans) {
            const memberships = await state.adapter.query(
                'SELECT * FROM subscription_memberships WHERE plan_id = ? AND status = ?',
                [plan.plan_id, 'active']
            );

            for (const membership of memberships) {
                const activeUntil = parseDateValue(membership.active_until);
                if (!activeUntil) {
                    continue;
                }

                const graceEnd = new Date(activeUntil.getTime() + Number(plan.grace_days || 0) * 24 * 60 * 60 * 1000);
                if (graceEnd < now) {
                    await state.adapter.query(
                        'UPDATE subscription_memberships SET status = ?, updated_at = ? WHERE plan_id = ? AND subscriber = ?',
                        ['expired', now, membership.plan_id, membership.subscriber]
                    );

                    await emitContractEvent(state.adapter, name, 'expireMemberships', payload, {
                        action: 'subscription_expired',
                        data: {
                            planId: membership.plan_id,
                            subscriber: membership.subscriber
                        }
                    });
                }
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
            createPlan: action(createPlan, { schema: createPlanSchema, trigger: 'custom_json' }),
            updatePlan: action(updatePlan, { schema: updatePlanSchema, trigger: 'custom_json' }),
            subscribe: action(subscribe, { schema: planIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            cancelSubscription: action(cancel, { schema: planIdSchema, trigger: 'custom_json' }),
            expireMemberships: action(expireMemberships, {
                schema: z.object({ planId: identifierSchema.optional() }).optional(),
                trigger: ['custom_json', 'time']
            })
        }
    });
}
