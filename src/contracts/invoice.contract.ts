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

const DEFAULT_NAME = 'invoices';

export interface InvoiceContractOptions {
    name?: string;
}

export function createInvoiceContract(options: InvoiceContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createInvoiceSchema = z.object({
        invoiceId: identifierSchema,
        payer: z.string().min(3).max(32),
        title: z.string().min(3).max(140),
        description: z.string().max(1000).optional(),
        amount: amountSchema,
        asset: assetSchema,
        dueAt: z.string().optional(),
        allowPartial: z.boolean().optional(),
        metadata: z.record(z.any()).optional()
    });

    const invoiceIdSchema = z.object({
        invoiceId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS invoices (
                    invoice_id TEXT PRIMARY KEY,
                    issuer TEXT NOT NULL,
                    payer TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    total_amount TEXT NOT NULL,
                    outstanding_amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    due_at DATETIME,
                    allow_partial INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS invoice_payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_id TEXT NOT NULL,
                    payer TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    source TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createInvoice = async (payload: z.infer<typeof createInvoiceSchema>, ctx: any) => {
        const issuer = requireSender(ctx);
        const existing = await state.adapter.query('SELECT invoice_id FROM invoices WHERE invoice_id = ?', [payload.invoiceId]);
        if (existing.length > 0) {
            throw new Error(`Invoice ${payload.invoiceId} already exists`);
        }

        const dueAt = parseDateValue(payload.dueAt);
        await state.adapter.query(
            `INSERT INTO invoices (
                invoice_id, issuer, payer, title, description, total_amount, outstanding_amount, asset, due_at, allow_partial, status, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.invoiceId,
                issuer,
                payload.payer,
                payload.title,
                payload.description || '',
                payload.amount,
                payload.amount,
                payload.asset,
                dueAt,
                payload.allowPartial ? 1 : 0,
                'open',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createInvoice', payload, {
            action: 'invoice_created',
            data: {
                invoiceId: payload.invoiceId,
                issuer,
                payer: payload.payer,
                amount: payload.amount,
                asset: payload.asset
            }
        });
    };

    const payInvoice = async (payload: z.infer<typeof invoiceIdSchema>, ctx: any) => {
        const payer = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM invoices WHERE invoice_id = ?', [payload.invoiceId]);
        if (rows.length === 0) {
            throw new Error(`Invoice ${payload.invoiceId} does not exist`);
        }

        const invoice = rows[0];
        if (invoice.status === 'paid' || invoice.status === 'cancelled') {
            throw new Error('Invoice is not payable');
        }

        if (invoice.payer !== payer) {
            throw new Error('Only the designated payer can pay this invoice');
        }

        assertAssetMatches(payment.asset, invoice.asset);

        const outstanding = toBigNumber(invoice.outstanding_amount);
        if (!invoice.allow_partial && !toBigNumber(payment.amount).eq(outstanding)) {
            throw new Error('This invoice requires full payment');
        }

        if (toBigNumber(payment.amount).gt(outstanding)) {
            throw new Error('Payment exceeds the outstanding amount');
        }

        const nextOutstanding = outstanding.minus(payment.amount);
        const nextStatus = nextOutstanding.eq(0)
            ? 'paid'
            : 'partially_paid';

        await state.adapter.query(
            'INSERT INTO invoice_payments (invoice_id, payer, amount, asset, source, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [payload.invoiceId, payer, payment.amount, payment.asset, payment.source, ctx.transaction.id, new Date()]
        );

        await state.adapter.query(
            'UPDATE invoices SET outstanding_amount = ?, status = ?, updated_at = ? WHERE invoice_id = ?',
            [nextOutstanding.toFixed(), nextStatus, new Date(), payload.invoiceId]
        );

        await emitContractEvent(state.adapter, name, 'payInvoice', payload, {
            action: 'invoice_payment_received',
            data: {
                invoiceId: payload.invoiceId,
                payer,
                amount: payment.amount,
                asset: payment.asset,
                outstandingAmount: nextOutstanding.toFixed(),
                status: nextStatus
            }
        });
    };

    const cancelInvoice = async (payload: z.infer<typeof invoiceIdSchema>, ctx: any) => {
        const issuer = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM invoices WHERE invoice_id = ?', [payload.invoiceId]);
        if (rows.length === 0) {
            throw new Error(`Invoice ${payload.invoiceId} does not exist`);
        }

        const invoice = rows[0];
        if (invoice.issuer !== issuer) {
            throw new Error('Only the invoice issuer can cancel this invoice');
        }

        if (invoice.status === 'paid') {
            throw new Error('Paid invoices cannot be cancelled');
        }

        await state.adapter.query(
            'UPDATE invoices SET status = ?, updated_at = ? WHERE invoice_id = ?',
            ['cancelled', new Date(), payload.invoiceId]
        );

        await emitContractEvent(state.adapter, name, 'cancelInvoice', payload, {
            action: 'invoice_cancelled',
            data: {
                invoiceId: payload.invoiceId,
                issuer
            }
        });
    };

    const closeOverdueInvoices = async (_payload: { invoiceId?: string } = {}, _ctx: any) => {
        const invoices = await state.adapter.query(
            'SELECT * FROM invoices WHERE status IN (?, ?)',
            ['open', 'partially_paid']
        );
        const now = new Date();

        for (const invoice of invoices) {
            const dueAt = parseDateValue(invoice.due_at);
            if (dueAt && dueAt < now) {
                await state.adapter.query(
                    'UPDATE invoices SET status = ?, updated_at = ? WHERE invoice_id = ?',
                    ['overdue', now, invoice.invoice_id]
                );

                await emitContractEvent(state.adapter, name, 'closeOverdueInvoices', { invoiceId: invoice.invoice_id }, {
                    action: 'invoice_overdue',
                    data: {
                        invoiceId: invoice.invoice_id,
                        payer: invoice.payer
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
            createInvoice: action(createInvoice, { schema: createInvoiceSchema, trigger: 'custom_json' }),
            payInvoice: action(payInvoice, { schema: invoiceIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            cancelInvoice: action(cancelInvoice, { schema: invoiceIdSchema, trigger: 'custom_json' }),
            closeOverdueInvoices: action(closeOverdueInvoices, {
                schema: z.object({ invoiceId: identifierSchema.optional() }).optional(),
                trigger: ['custom_json', 'time']
            })
        }
    });
}
