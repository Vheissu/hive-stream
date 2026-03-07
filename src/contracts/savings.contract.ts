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

const DEFAULT_NAME = 'savings';

export interface SavingsContractOptions {
    name?: string;
}

export function createSavingsContract(options: SavingsContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createGoalSchema = z.object({
        goalId: identifierSchema,
        title: z.string().min(3).max(140),
        targetAmount: amountSchema,
        asset: assetSchema,
        deadline: z.string().optional(),
        allowEarlyWithdraw: z.boolean().optional(),
        metadata: z.record(z.any()).optional()
    });

    const goalIdSchema = z.object({
        goalId: identifierSchema
    });

    const withdrawSchema = z.object({
        goalId: identifierSchema,
        amount: amountSchema.optional(),
        note: z.string().max(280).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS savings_goals (
                    goal_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    target_amount TEXT NOT NULL,
                    current_amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    deadline DATETIME,
                    allow_early_withdraw INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS savings_contributions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    goal_id TEXT NOT NULL,
                    contributor TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    source TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS savings_withdrawals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    goal_id TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    note TEXT,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createGoal = async (payload: z.infer<typeof createGoalSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT goal_id FROM savings_goals WHERE goal_id = ?', [payload.goalId]);
        if (existing.length > 0) {
            throw new Error(`Goal ${payload.goalId} already exists`);
        }

        const deadline = parseDateValue(payload.deadline);
        if (deadline && deadline <= new Date()) {
            throw new Error('Goal deadline must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO savings_goals (
                goal_id, owner, title, target_amount, current_amount, asset, deadline, allow_early_withdraw, status, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.goalId,
                owner,
                payload.title,
                payload.targetAmount,
                '0',
                payload.asset,
                deadline,
                payload.allowEarlyWithdraw ? 1 : 0,
                'open',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createGoal', payload, {
            action: 'savings_goal_created',
            data: {
                goalId: payload.goalId,
                owner
            }
        });
    };

    const contribute = async (payload: z.infer<typeof goalIdSchema>, ctx: any) => {
        const contributor = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const goals = await state.adapter.query('SELECT * FROM savings_goals WHERE goal_id = ?', [payload.goalId]);
        if (goals.length === 0) {
            throw new Error(`Goal ${payload.goalId} does not exist`);
        }

        const goal = goals[0];
        if (goal.status !== 'open' && goal.status !== 'funded') {
            throw new Error('Goal is not accepting contributions');
        }

        assertAssetMatches(payment.asset, goal.asset);
        const currentAmount = toBigNumber(goal.current_amount).plus(payment.amount);
        const status = currentAmount.gte(goal.target_amount)
            ? 'funded'
            : goal.status;

        await state.adapter.query(
            'INSERT INTO savings_contributions (goal_id, contributor, amount, asset, source, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [payload.goalId, contributor, payment.amount, payment.asset, payment.source, ctx.transaction.id, new Date()]
        );

        await state.adapter.query(
            'UPDATE savings_goals SET current_amount = ?, status = ?, updated_at = ? WHERE goal_id = ?',
            [currentAmount.toFixed(), status, new Date(), payload.goalId]
        );

        await emitContractEvent(state.adapter, name, 'contribute', payload, {
            action: 'savings_contribution_received',
            data: {
                goalId: payload.goalId,
                contributor,
                amount: payment.amount,
                asset: payment.asset,
                currentAmount: currentAmount.toFixed(),
                status
            }
        });
    };

    const withdraw = async (payload: z.infer<typeof withdrawSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const goals = await state.adapter.query('SELECT * FROM savings_goals WHERE goal_id = ?', [payload.goalId]);
        if (goals.length === 0) {
            throw new Error(`Goal ${payload.goalId} does not exist`);
        }

        const goal = goals[0];
        if (goal.owner !== owner) {
            throw new Error('Only the goal owner can withdraw funds');
        }

        const goalMet = toBigNumber(goal.current_amount).gte(goal.target_amount);
        if (!goalMet && !goal.allow_early_withdraw) {
            throw new Error('Goal has not been met and early withdrawals are disabled');
        }

        const amount = payload.amount || goal.current_amount;
        if (toBigNumber(amount).gt(goal.current_amount)) {
            throw new Error('Withdrawal amount exceeds available goal balance');
        }

        const remaining = toBigNumber(goal.current_amount).minus(amount);
        const nextStatus = remaining.eq(0)
            ? 'withdrawn'
            : goal.status;

        await state.adapter.query(
            'INSERT INTO savings_withdrawals (goal_id, owner, amount, note, created_at) VALUES (?, ?, ?, ?, ?)',
            [payload.goalId, owner, amount, payload.note || '', new Date()]
        );
        await state.adapter.query(
            'UPDATE savings_goals SET current_amount = ?, status = ?, updated_at = ? WHERE goal_id = ?',
            [remaining.toFixed(), nextStatus, new Date(), payload.goalId]
        );

        await emitContractEvent(state.adapter, name, 'withdraw', payload, {
            action: 'savings_withdrawal_requested',
            data: {
                goalId: payload.goalId,
                owner,
                amount,
                asset: goal.asset,
                remainingAmount: remaining.toFixed()
            }
        });
    };

    const closeGoal = async (payload: z.infer<typeof goalIdSchema>, ctx: any) => {
        const goals = await state.adapter.query('SELECT * FROM savings_goals WHERE goal_id = ?', [payload.goalId]);
        if (goals.length === 0) {
            throw new Error(`Goal ${payload.goalId} does not exist`);
        }

        const goal = goals[0];
        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== goal.owner) {
                throw new Error('Only the goal owner can close this goal');
            }
        }

        await state.adapter.query(
            'UPDATE savings_goals SET status = ?, updated_at = ? WHERE goal_id = ?',
            ['closed', new Date(), payload.goalId]
        );

        await emitContractEvent(state.adapter, name, 'closeGoal', payload, {
            action: 'savings_goal_closed',
            data: {
                goalId: payload.goalId,
                owner: goal.owner,
                currentAmount: goal.current_amount,
                asset: goal.asset
            }
        });
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
            createGoal: action(createGoal, { schema: createGoalSchema, trigger: 'custom_json' }),
            contribute: action(contribute, { schema: goalIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            withdraw: action(withdraw, { schema: withdrawSchema, trigger: 'custom_json' }),
            closeGoal: action(closeGoal, { schema: goalIdSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
