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
    requireSender,
    toBigNumber
} from './helpers';

const DEFAULT_NAME = 'payroll';

export interface PayrollContractOptions {
    name?: string;
}

export function createPayrollContract(options: PayrollContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createPayrollSchema = z.object({
        payrollId: identifierSchema,
        title: z.string().min(3).max(140),
        asset: assetSchema,
        intervalDays: z.number().int().min(1).max(3650),
        metadata: z.record(z.any()).optional()
    });

    const addRecipientSchema = z.object({
        payrollId: identifierSchema,
        account: z.string().min(3).max(32),
        amount: amountSchema
    });

    const idSchema = z.object({
        payrollId: identifierSchema
    });

    const withdrawSchema = z.object({
        payrollId: identifierSchema.optional()
    }).optional();

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS payroll_runs (
                    payroll_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    interval_days INTEGER NOT NULL,
                    budget_balance TEXT NOT NULL,
                    next_run_at DATETIME NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS payroll_recipients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    payroll_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    active INTEGER NOT NULL,
                    created_at DATETIME NOT NULL,
                    UNIQUE(payroll_id, account)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS payroll_balances (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    payroll_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    balance TEXT NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(payroll_id, account, asset)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS payroll_executions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    payroll_id TEXT NOT NULL,
                    run_amount TEXT NOT NULL,
                    recipient_count INTEGER NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createPayroll = async (payload: z.infer<typeof createPayrollSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT payroll_id FROM payroll_runs WHERE payroll_id = ?', [payload.payrollId]);
        if (existing.length > 0) {
            throw new Error(`Payroll ${payload.payrollId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO payroll_runs (
                payroll_id, owner, title, asset, interval_days, budget_balance, next_run_at, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.payrollId,
                owner,
                payload.title,
                payload.asset,
                payload.intervalDays,
                '0',
                new Date(),
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createPayroll', payload, {
            action: 'payroll_created',
            data: {
                payrollId: payload.payrollId,
                owner
            }
        });
    };

    const addRecipient = async (payload: z.infer<typeof addRecipientSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const runs = await state.adapter.query('SELECT * FROM payroll_runs WHERE payroll_id = ?', [payload.payrollId]);
        if (runs.length === 0) {
            throw new Error(`Payroll ${payload.payrollId} does not exist`);
        }

        const run = runs[0];
        if (run.owner !== owner) {
            throw new Error('Only the payroll owner can manage recipients');
        }

        await state.adapter.query(
            `INSERT INTO payroll_recipients (payroll_id, account, amount, active, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(payroll_id, account)
             DO UPDATE SET amount = excluded.amount, active = excluded.active`,
            [payload.payrollId, payload.account, payload.amount, 1, new Date()]
        );

        await emitContractEvent(state.adapter, name, 'addRecipient', payload, {
            action: 'payroll_recipient_added',
            data: {
                payrollId: payload.payrollId,
                account: payload.account,
                amount: payload.amount
            }
        });
    };

    const fundPayroll = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const runs = await state.adapter.query('SELECT * FROM payroll_runs WHERE payroll_id = ?', [payload.payrollId]);
        if (runs.length === 0) {
            throw new Error(`Payroll ${payload.payrollId} does not exist`);
        }

        const run = runs[0];
        if (run.owner !== owner) {
            throw new Error('Only the payroll owner can fund this payroll');
        }

        assertAssetMatches(payment.asset, run.asset);
        const budget = toBigNumber(run.budget_balance).plus(payment.amount);
        await state.adapter.query(
            'UPDATE payroll_runs SET budget_balance = ?, updated_at = ? WHERE payroll_id = ?',
            [budget.toFixed(), new Date(), payload.payrollId]
        );

        await emitContractEvent(state.adapter, name, 'fundPayroll', payload, {
            action: 'payroll_funded',
            data: {
                payrollId: payload.payrollId,
                budgetBalance: budget.toFixed()
            }
        });
    };

    const runPayroll = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const runs = await state.adapter.query('SELECT * FROM payroll_runs WHERE payroll_id = ?', [payload.payrollId]);
        if (runs.length === 0) {
            throw new Error(`Payroll ${payload.payrollId} does not exist`);
        }

        const run = runs[0];
        if (ctx.trigger !== 'time') {
            const owner = requireSender(ctx);
            if (run.owner !== owner) {
                throw new Error('Only the payroll owner can execute payroll runs');
            }
        }

        const recipients = await state.adapter.query('SELECT * FROM payroll_recipients WHERE payroll_id = ? AND active = ?', [payload.payrollId, 1]);
        if (recipients.length === 0) {
            throw new Error('Payroll has no active recipients');
        }

        const totalAmount = recipients.reduce((sum: any, recipient: any) => sum.plus(recipient.amount), toBigNumber(0));
        if (totalAmount.gt(run.budget_balance)) {
            throw new Error('Payroll budget cannot cover this run');
        }

        for (const recipient of recipients) {
            const balanceRows = await state.adapter.query(
                'SELECT * FROM payroll_balances WHERE payroll_id = ? AND account = ? AND asset = ?',
                [payload.payrollId, recipient.account, run.asset]
            );
            const nextBalance = (balanceRows.length > 0 ? toBigNumber(balanceRows[0].balance) : toBigNumber(0)).plus(recipient.amount);
            await state.adapter.query(
                `INSERT INTO payroll_balances (payroll_id, account, asset, balance, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(payroll_id, account, asset)
                 DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,
                [payload.payrollId, recipient.account, run.asset, nextBalance.toFixed(), new Date()]
            );
        }

        const nextRunAt = new Date(Date.now() + Number(run.interval_days) * 24 * 60 * 60 * 1000);
        await state.adapter.query(
            'UPDATE payroll_runs SET budget_balance = ?, next_run_at = ?, updated_at = ? WHERE payroll_id = ?',
            [toBigNumber(run.budget_balance).minus(totalAmount).toFixed(), nextRunAt, new Date(), payload.payrollId]
        );
        await state.adapter.query(
            'INSERT INTO payroll_executions (payroll_id, run_amount, recipient_count, created_at) VALUES (?, ?, ?, ?)',
            [payload.payrollId, totalAmount.toFixed(), recipients.length, new Date()]
        );

        await emitContractEvent(state.adapter, name, 'runPayroll', payload, {
            action: 'payroll_run_executed',
            data: {
                payrollId: payload.payrollId,
                totalAmount: totalAmount.toFixed(),
                recipientCount: recipients.length
            }
        });
    };

    const withdrawPayroll = async (payload: { payrollId?: string } = {}, ctx: any) => {
        const account = requireSender(ctx);
        const balances = payload.payrollId
            ? await state.adapter.query('SELECT * FROM payroll_balances WHERE payroll_id = ? AND account = ?', [payload.payrollId, account])
            : await state.adapter.query('SELECT * FROM payroll_balances WHERE account = ?', [account]);
        if (balances.length === 0) {
            throw new Error('No payroll balance found');
        }

        for (const balance of balances) {
            if (toBigNumber(balance.balance).lte(0)) {
                continue;
            }

            await state.adapter.query(
                'UPDATE payroll_balances SET balance = ?, updated_at = ? WHERE payroll_id = ? AND account = ? AND asset = ?',
                ['0', new Date(), balance.payroll_id, account, balance.asset]
            );

            await emitContractEvent(state.adapter, name, 'withdrawPayroll', payload, {
                action: 'payroll_withdrawal_requested',
                data: {
                    payrollId: balance.payroll_id,
                    account,
                    amount: balance.balance,
                    asset: balance.asset
                }
            });
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
            createPayroll: action(createPayroll, { schema: createPayrollSchema, trigger: 'custom_json' }),
            addRecipient: action(addRecipient, { schema: addRecipientSchema, trigger: 'custom_json' }),
            fundPayroll: action(fundPayroll, { schema: idSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            runPayroll: action(runPayroll, { schema: idSchema, trigger: ['custom_json', 'time'] }),
            withdrawPayroll: action(withdrawPayroll, { schema: withdrawSchema, trigger: 'custom_json' })
        }
    });
}
