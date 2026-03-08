import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assertAssetMatches,
    createContractState,
    emitContractEvent,
    getIncomingPayment,
    identifierSchema,
    initializeTables,
    parseJson,
    requireSender,
    toBigNumber,
    uniqueItems
} from './helpers';

const DEFAULT_NAME = 'revenuesplit';

export interface RevenueSplitContractOptions {
    name?: string;
}

export function createRevenueSplitContract(options: RevenueSplitContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const recipientSchema = z.object({
        account: z.string().min(3).max(32),
        bps: z.number().int().min(1).max(10000)
    });

    const createSplitSchema = z.object({
        splitId: identifierSchema,
        title: z.string().min(3).max(140),
        recipients: z.array(recipientSchema).min(1).max(25),
        metadata: z.record(z.any()).optional()
    });

    const splitIdSchema = z.object({
        splitId: identifierSchema
    });

    const updateSplitSchema = z.object({
        splitId: identifierSchema,
        recipients: z.array(recipientSchema).min(1).max(25),
        metadata: z.record(z.any()).optional()
    });

    const withdrawSchema = z.object({
        splitId: identifierSchema.optional(),
        asset: z.string().min(3).max(16).optional()
    }).optional();

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS revenue_splits (
                    split_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    recipients_json TEXT NOT NULL,
                    active INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS revenue_split_balances (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    split_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    balance TEXT NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(split_id, account, asset)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS revenue_split_distributions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    split_id TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    payer TEXT NOT NULL,
                    reference TEXT,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const validateRecipients = (owner: string, recipients: Array<z.infer<typeof recipientSchema>>) => {
        const accounts = uniqueItems(recipients.map(recipient => recipient.account));
        if (accounts.length !== recipients.length) {
            throw new Error('Recipient accounts must be unique');
        }

        if (!accounts.includes(owner)) {
            accounts.push(owner);
        }

        const totalBps = recipients.reduce((sum, recipient) => sum + recipient.bps, 0);
        if (totalBps !== 10000) {
            throw new Error('Recipient basis points must total 10000');
        }
    };

    const createSplit = async (payload: z.infer<typeof createSplitSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        validateRecipients(owner, payload.recipients);

        const existing = await state.adapter.query('SELECT split_id FROM revenue_splits WHERE split_id = ?', [payload.splitId]);
        if (existing.length > 0) {
            throw new Error(`Split ${payload.splitId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO revenue_splits (
                split_id, owner, title, recipients_json, active, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.splitId,
                owner,
                payload.title,
                JSON.stringify(payload.recipients),
                1,
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createSplit', payload, {
            action: 'revenue_split_created',
            data: {
                splitId: payload.splitId,
                owner
            }
        });
    };

    const updateSplit = async (payload: z.infer<typeof updateSplitSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM revenue_splits WHERE split_id = ?', [payload.splitId]);
        if (rows.length === 0) {
            throw new Error(`Split ${payload.splitId} does not exist`);
        }

        const split = rows[0];
        if (split.owner !== owner) {
            throw new Error('Only the split owner can update recipients');
        }

        validateRecipients(owner, payload.recipients);

        await state.adapter.query(
            'UPDATE revenue_splits SET recipients_json = ?, metadata = ?, updated_at = ? WHERE split_id = ?',
            [JSON.stringify(payload.recipients), JSON.stringify(payload.metadata || parseJson(split.metadata, {})), new Date(), payload.splitId]
        );

        await emitContractEvent(state.adapter, name, 'updateSplit', payload, {
            action: 'revenue_split_updated',
            data: {
                splitId: payload.splitId,
                owner
            }
        });
    };

    const distribute = async (payload: { splitId: string }, ctx: any) => {
        const payer = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM revenue_splits WHERE split_id = ?', [payload.splitId]);
        if (rows.length === 0) {
            throw new Error(`Split ${payload.splitId} does not exist`);
        }

        const split = rows[0];
        if (!split.active) {
            throw new Error('Revenue split is not active');
        }

        const recipients = parseJson<Array<{ account: string; bps: number }>>(split.recipients_json, []);
        let allocated = toBigNumber(0);

        for (let index = 0; index < recipients.length; index++) {
            const recipient = recipients[index];
            const share = index === recipients.length - 1
                ? toBigNumber(payment.amount).minus(allocated)
                : toBigNumber(payment.amount).multipliedBy(recipient.bps).dividedBy(10000).decimalPlaces(8, 1);
            allocated = allocated.plus(share);

            const balanceRows = await state.adapter.query(
                'SELECT * FROM revenue_split_balances WHERE split_id = ? AND account = ? AND asset = ?',
                [payload.splitId, recipient.account, payment.asset]
            );
            const currentBalance = balanceRows.length > 0 ? toBigNumber(balanceRows[0].balance) : toBigNumber(0);
            const nextBalance = currentBalance.plus(share);

            await state.adapter.query(
                `INSERT INTO revenue_split_balances (split_id, account, asset, balance, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(split_id, account, asset)
                 DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,
                [payload.splitId, recipient.account, payment.asset, nextBalance.toFixed(), new Date()]
            );
        }

        await state.adapter.query(
            'INSERT INTO revenue_split_distributions (split_id, amount, asset, payer, reference, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [payload.splitId, payment.amount, payment.asset, payer, payment.memo || '', new Date()]
        );

        await emitContractEvent(state.adapter, name, 'distribute', payload, {
            action: 'revenue_split_distributed',
            data: {
                splitId: payload.splitId,
                payer,
                amount: payment.amount,
                asset: payment.asset,
                recipients
            }
        });
    };

    const withdraw = async (payload: { splitId?: string; asset?: string } = {}, ctx: any) => {
        const account = requireSender(ctx);
        const balances = payload.splitId
            ? await state.adapter.query(
                'SELECT * FROM revenue_split_balances WHERE split_id = ? AND account = ?',
                [payload.splitId, account]
            )
            : await state.adapter.query(
                'SELECT * FROM revenue_split_balances WHERE account = ?',
                [account]
            );

        const filtered = balances.filter((balance: any) => !payload.asset || balance.asset === payload.asset);
        if (filtered.length === 0) {
            throw new Error('No withdrawable revenue split balances found');
        }

        for (const balance of filtered) {
            if (toBigNumber(balance.balance).lte(0)) {
                continue;
            }

            await state.adapter.query(
                'UPDATE revenue_split_balances SET balance = ?, updated_at = ? WHERE split_id = ? AND account = ? AND asset = ?',
                ['0', new Date(), balance.split_id, account, balance.asset]
            );

            await emitContractEvent(state.adapter, name, 'withdraw', payload, {
                action: 'revenue_split_withdrawal_requested',
                data: {
                    splitId: balance.split_id,
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
            createSplit: action(createSplit, { schema: createSplitSchema, trigger: 'custom_json' }),
            updateSplit: action(updateSplit, { schema: updateSplitSchema, trigger: 'custom_json' }),
            distribute: action(distribute, { schema: splitIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            withdraw: action(withdraw, { schema: withdrawSchema, trigger: 'custom_json' })
        }
    });
}
