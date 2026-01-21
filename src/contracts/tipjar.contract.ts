import { z } from 'zod';
import { action, defineContract } from './contract';

const DEFAULT_NAME = 'tipjar';

export interface TipJarContractOptions {
    name?: string;
}

export function createTipJarContract(options: TipJarContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;

    const state = {
        adapter: null as any
    };

    const tipSchema = z.object({
        message: z.string().max(280).optional()
    });

    const initializeTables = async () => {
        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS tipjar_tips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_account TEXT NOT NULL,
                amount TEXT NOT NULL,
                asset TEXT NOT NULL,
                message TEXT,
                block_number INTEGER NOT NULL,
                transaction_id TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        `);
    };

    const tip = async (payload: { message?: string }, ctx: any) => {
        if (!ctx.transfer) {
            throw new Error('Transfer context required for tips');
        }

        await state.adapter.query(
            'INSERT INTO tipjar_tips (from_account, amount, asset, message, block_number, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [ctx.sender, ctx.transfer.amount, ctx.transfer.asset, payload.message || '', ctx.block.number, ctx.transaction.id, new Date()]
        );

        await state.adapter.addEvent(new Date(), name, 'tip', payload, {
            action: 'tip_received',
            data: {
                from: ctx.sender,
                amount: ctx.transfer.amount,
                asset: ctx.transfer.asset,
                message: payload.message || ''
            }
        });
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ adapter }) => {
                state.adapter = adapter;
                await initializeTables();
            }
        },
        actions: {
            tip: action(tip, {
                schema: tipSchema,
                trigger: 'transfer'
            })
        }
    });
}
