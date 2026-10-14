import { z } from 'zod';
import BigNumber from '../bignumber';
import { getLogger } from '../logger';
import { operationRecordId } from '../types/hive-stream';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    createContractState,
    formatBlockchainAmount,
    emitContractEvent,
    getIncomingPayment,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender,
    resolveContractAccount,
    toBigNumber
} from './helpers';

const DEFAULT_NAME = 'launchpad';

export interface LaunchpadContractOptions {
    name?: string;
    /**
     * Account that receives contributions and sends refunds (unfilled
     * portions, and every contribution when a sale misses its soft cap).
     * Contributions must be sent to it. Defaults to the streamer username.
     */
    account?: string;
}

export function createLaunchpadContract(options: LaunchpadContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState({ streamer: null as any });
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';

    const createSaleSchema = z.object({
        saleId: identifierSchema,
        title: z.string().min(3).max(140),
        tokenSymbol: z.string().min(1).max(20),
        purchaseAsset: assetSchema,
        unitPrice: amountSchema,
        totalUnits: z.number().int().min(1).max(100000000),
        closesAt: z.string(),
        minUnitsPerBuyer: z.number().int().min(1).max(100000000).optional(),
        maxUnitsPerBuyer: z.number().int().min(1).max(100000000).optional(),
        // Minimum units that must sell; below it the sale fails and every contribution is refunded.
        softCap: z.number().int().min(1).max(100000000).optional(),
        metadata: z.record(z.string(), z.any()).optional()
    });

    const saleIdSchema = z.object({
        saleId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS launchpad_sales (
                    sale_id TEXT PRIMARY KEY,
                    creator TEXT NOT NULL,
                    title TEXT NOT NULL,
                    token_symbol TEXT NOT NULL,
                    purchase_asset TEXT NOT NULL,
                    unit_price TEXT NOT NULL,
                    total_units INTEGER NOT NULL,
                    units_sold INTEGER NOT NULL,
                    closes_at DATETIME NOT NULL,
                    min_units_per_buyer INTEGER,
                    max_units_per_buyer INTEGER,
                    soft_cap INTEGER,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    finalized_at DATETIME
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS launchpad_allocations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sale_id TEXT NOT NULL,
                    buyer TEXT NOT NULL,
                    units INTEGER NOT NULL,
                    amount_paid TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    claimed INTEGER NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(sale_id, buyer)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS launchpad_refunds (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sale_id TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    memo TEXT NOT NULL,
                    reference TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    paid_at DATETIME
                )
            `
        ]);

        // Sales tables created before soft caps existed lack the column.
        try {
            await state.adapter.query('SELECT soft_cap FROM launchpad_sales LIMIT 1');
        } catch (error) {
            await state.adapter.query('ALTER TABLE launchpad_sales ADD COLUMN soft_cap INTEGER');
        }
    };

    const withTransaction = async <T>(work: (adapter: any) => Promise<T>): Promise<T> => {
        if (typeof state.adapter?.runInTransaction === 'function') {
            return state.adapter.runInTransaction(work);
        }

        return work(state.adapter);
    };

    /**
     * Records a refund as `pending` together with the state change that
     * creates it; it is marked `refunded` only after the transfer is
     * broadcast, so a failed broadcast is retried by `finalizeSale`.
     */
    const queueRefund = async (
        adapter: any,
        ctx: any,
        refund: { saleId: string; recipient: string; amount: string; asset: string; kind: string; memo: string }
    ) => {
        await adapter.query(
            `INSERT INTO launchpad_refunds (sale_id, recipient, amount, asset, kind, memo, reference, status, created_at, paid_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                refund.saleId,
                refund.recipient,
                refund.amount,
                refund.asset,
                refund.kind,
                refund.memo,
                operationRecordId(ctx.transaction?.id ?? 'time', ctx.transaction?.operationIndex),
                'pending',
                blockTimeOf(ctx),
                null
            ]
        );
    };

    const flushRefunds = async (saleId: string, ctx: any) => {
        const pending = await state.adapter.query(
            'SELECT * FROM launchpad_refunds WHERE sale_id = ? AND status = ? ORDER BY id ASC',
            [saleId, 'pending']
        );

        for (const refund of pending) {
            try {
                await state.streamer.transferHiveTokens(account, refund.recipient, refund.amount, refund.asset, refund.memo);
            } catch (error) {
                getLogger().error(`[Launchpad] Refund ${refund.id} of ${refund.amount} ${refund.asset} to ${refund.recipient} failed; it stays pending and finalizeSale retries it:`, error);
                continue;
            }

            await state.adapter.query(
                'UPDATE launchpad_refunds SET status = ?, paid_at = ? WHERE id = ?',
                ['refunded', blockTimeOf(ctx), refund.id]
            );
        }
    };

    /** Formats a refund with the payment's own decimals, rounding down. */
    const formatRefund = (value: BigNumber, paidAmount: string): string => {
        const decimals = (paidAmount.split('.')[1] || '').length;
        return value.decimalPlaces(decimals, BigNumber.ROUND_DOWN).toFixed(decimals);
    };

    const createSale = async (payload: z.infer<typeof createSaleSchema>, ctx: any) => {
        const creator = requireSender(ctx);
        const existing = await state.adapter.query('SELECT sale_id FROM launchpad_sales WHERE sale_id = ?', [payload.saleId]);
        if (existing.length > 0) {
            throw new Error(`Sale ${payload.saleId} already exists`);
        }

        const closesAt = parseDateValue(payload.closesAt);
        if (!closesAt || closesAt <= blockTimeOf(ctx)) {
            throw new Error('Sale close time must be in the future');
        }

        if (payload.maxUnitsPerBuyer && payload.minUnitsPerBuyer && payload.maxUnitsPerBuyer < payload.minUnitsPerBuyer) {
            throw new Error('Maximum units per buyer cannot be less than the minimum');
        }

        if (payload.softCap && payload.softCap > payload.totalUnits) {
            throw new Error('Soft cap cannot be more than the total units');
        }

        await state.adapter.query(
            `INSERT INTO launchpad_sales (
                sale_id, creator, title, token_symbol, purchase_asset, unit_price, total_units, units_sold, closes_at,
                min_units_per_buyer, max_units_per_buyer, soft_cap, status, metadata, created_at, finalized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.saleId,
                creator,
                payload.title,
                payload.tokenSymbol,
                payload.purchaseAsset,
                payload.unitPrice,
                payload.totalUnits,
                0,
                closesAt,
                payload.minUnitsPerBuyer || null,
                payload.maxUnitsPerBuyer || null,
                payload.softCap || null,
                'open',
                JSON.stringify(payload.metadata || {}),
                blockTimeOf(ctx),
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createSale', payload, {
            action: 'launchpad_sale_created',
            data: {
                saleId: payload.saleId,
                creator,
                softCap: payload.softCap ?? null
            }
        }, blockTimeOf(ctx));
    };

    const contribute = async (payload: z.infer<typeof saleIdSchema>, ctx: any) => {
        const buyer = requireSender(ctx);
        const payment = getIncomingPayment(ctx);

        if (payment.to !== account) {
            throw new Error(`Contributions must be sent to ${account}`);
        }

        const now = blockTimeOf(ctx);
        const paid = toBigNumber(payment.amount);

        // A payment is never kept for units the buyer didn't get: anything
        // that can't be filled is refunded in the same step.
        const refundAll = async (reason: string) => {
            await withTransaction(async (adapter) => {
                await queueRefund(adapter, ctx, {
                    saleId: payload.saleId,
                    recipient: buyer,
                    amount: payment.amount,
                    asset: payment.asset,
                    kind: 'rejected_contribution',
                    memo: `[Refund] Sale ${payload.saleId}: ${reason}`
                });

                await adapter.addEvent?.(now, name, 'contribute', payload, {
                    action: 'launchpad_contribution_refunded',
                    data: {
                        saleId: payload.saleId,
                        buyer,
                        amount: payment.amount,
                        asset: payment.asset,
                        reason
                    }
                });
            });

            await flushRefunds(payload.saleId, ctx);
        };

        const rows = await state.adapter.query('SELECT * FROM launchpad_sales WHERE sale_id = ?', [payload.saleId]);
        if (rows.length === 0) {
            return refundAll('sale does not exist');
        }

        const sale = rows[0];
        if (sale.status !== 'open') {
            return refundAll('sale is not open');
        }

        if ((parseDateValue(sale.closes_at) || now) <= now) {
            return refundAll('sale has already closed');
        }

        if (payment.asset !== sale.purchase_asset) {
            return refundAll(`contributions must be paid in ${sale.purchase_asset}`);
        }

        const unitPrice = toBigNumber(sale.unit_price);
        const affordableUnits = paid.dividedToIntegerBy(unitPrice).toNumber();
        const remainingUnits = Math.max(Number(sale.total_units) - Number(sale.units_sold), 0);

        const existingRows = await state.adapter.query('SELECT * FROM launchpad_allocations WHERE sale_id = ? AND buyer = ?', [payload.saleId, buyer]);
        const existingUnits = existingRows.length > 0 ? Number(existingRows[0].units) : 0;
        const buyerRoom = sale.max_units_per_buyer
            ? Math.max(Number(sale.max_units_per_buyer) - existingUnits, 0)
            : Number.MAX_SAFE_INTEGER;

        const unitCount = Math.min(affordableUnits, remainingUnits, buyerRoom);

        if (unitCount <= 0) {
            const reason = affordableUnits <= 0
                ? `payment is below the unit price of ${sale.unit_price} ${sale.purchase_asset}`
                : remainingUnits <= 0
                    ? 'sale is sold out'
                    : 'per-buyer cap reached';
            return refundAll(reason);
        }

        if (sale.min_units_per_buyer && unitCount < Number(sale.min_units_per_buyer)) {
            return refundAll('contribution is below the minimum purchase size');
        }

        const cost = unitPrice.multipliedBy(unitCount);
        const excess = paid.minus(cost);
        const refundAmount = excess.gt(0) ? formatRefund(excess, payment.amount) : null;
        const totalBuyerUnits = existingUnits + unitCount;
        const totalPaid = existingRows.length > 0
            ? toBigNumber(existingRows[0].amount_paid).plus(cost)
            : cost;

        await withTransaction(async (adapter) => {
            await adapter.query(
                `INSERT INTO launchpad_allocations (sale_id, buyer, units, amount_paid, asset, claimed, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(sale_id, buyer)
                 DO UPDATE SET units = excluded.units, amount_paid = excluded.amount_paid, asset = excluded.asset, updated_at = excluded.updated_at`,
                [payload.saleId, buyer, totalBuyerUnits, totalPaid.toFixed(), payment.asset, 0, now, now]
            );
            await adapter.query(
                'UPDATE launchpad_sales SET units_sold = ? WHERE sale_id = ?',
                [Number(sale.units_sold) + unitCount, payload.saleId]
            );

            if (refundAmount && toBigNumber(refundAmount).gt(0)) {
                await queueRefund(adapter, ctx, {
                    saleId: payload.saleId,
                    recipient: buyer,
                    amount: refundAmount,
                    asset: payment.asset,
                    kind: 'unfilled_portion',
                    memo: `[Refund] Sale ${payload.saleId}: ${unitCount} units filled, unfilled portion returned`
                });
            }

            await adapter.addEvent?.(now, name, 'contribute', payload, {
                action: 'launchpad_contribution_received',
                data: {
                    saleId: payload.saleId,
                    buyer,
                    units: unitCount,
                    totalBuyerUnits,
                    cost: cost.toFixed(),
                    refunded: refundAmount
                }
            });
        });

        await flushRefunds(payload.saleId, ctx);
    };

    const finalizeSale = async (payload: z.infer<typeof saleIdSchema>, ctx: any) => {
        const rows = await state.adapter.query('SELECT * FROM launchpad_sales WHERE sale_id = ?', [payload.saleId]);
        if (rows.length === 0) {
            throw new Error(`Sale ${payload.saleId} does not exist`);
        }

        const sale = rows[0];
        if (sale.status === 'successful' || sale.status === 'closed' || sale.status === 'failed') {
            // Already finalized: only retry refunds whose broadcast failed.
            await flushRefunds(payload.saleId, ctx);
            return;
        }

        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== sale.creator) {
                throw new Error('Only the sale creator can finalize the sale');
            }
        }

        if ((parseDateValue(sale.closes_at) || blockTimeOf(ctx)) > blockTimeOf(ctx) && Number(sale.units_sold) < Number(sale.total_units)) {
            throw new Error('Sale cannot be finalized before it closes unless it sells out');
        }

        const unitsSold = Number(sale.units_sold);
        const softCap = sale.soft_cap ? Number(sale.soft_cap) : 0;
        const status = unitsSold === 0
            ? 'closed'
            : softCap > 0 && unitsSold < softCap
                ? 'failed'
                : 'successful';

        await withTransaction(async (adapter) => {
            if (status === 'failed') {
                const allocations = await adapter.query('SELECT * FROM launchpad_allocations WHERE sale_id = ?', [payload.saleId]);

                for (const allocation of allocations) {
                    if (toBigNumber(allocation.amount_paid).lte(0)) {
                        continue;
                    }

                    await queueRefund(adapter, ctx, {
                        saleId: payload.saleId,
                        recipient: allocation.buyer,
                        amount: formatBlockchainAmount(allocation.amount_paid, 3),
                        asset: allocation.asset,
                        kind: 'soft_cap_refund',
                        memo: `[Refund] Sale ${payload.saleId} did not reach its soft cap`
                    });
                }
            }

            await adapter.query(
                'UPDATE launchpad_sales SET status = ?, finalized_at = ? WHERE sale_id = ?',
                [status, blockTimeOf(ctx), payload.saleId]
            );

            await adapter.addEvent?.(blockTimeOf(ctx), name, 'finalizeSale', payload, {
                action: 'launchpad_sale_finalized',
                data: {
                    saleId: payload.saleId,
                    status,
                    unitsSold: sale.units_sold,
                    softCap: softCap || null
                }
            });
        });

        await flushRefunds(payload.saleId, ctx);
    };

    const claimAllocation = async (payload: z.infer<typeof saleIdSchema>, ctx: any) => {
        const buyer = requireSender(ctx);
        const saleRows = await state.adapter.query('SELECT * FROM launchpad_sales WHERE sale_id = ?', [payload.saleId]);
        const allocationRows = await state.adapter.query('SELECT * FROM launchpad_allocations WHERE sale_id = ? AND buyer = ?', [payload.saleId, buyer]);
        if (saleRows.length === 0 || allocationRows.length === 0) {
            throw new Error('Sale allocation does not exist');
        }

        const sale = saleRows[0];
        const allocation = allocationRows[0];
        if (sale.status !== 'successful') {
            throw new Error('Sale is not ready for claims');
        }

        if (allocation.claimed) {
            throw new Error('Allocation already claimed');
        }

        await state.adapter.query(
            'UPDATE launchpad_allocations SET claimed = ?, updated_at = ? WHERE sale_id = ? AND buyer = ?',
            [1, blockTimeOf(ctx), payload.saleId, buyer]
        );

        await emitContractEvent(state.adapter, name, 'claimAllocation', payload, {
            action: 'launchpad_allocation_claim_requested',
            data: {
                saleId: payload.saleId,
                buyer,
                tokenSymbol: sale.token_symbol,
                units: allocation.units
            }
        }, blockTimeOf(ctx));
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                account = resolveContractAccount('createLaunchpadContract', options.account, lifecycle);
                state.adapter = lifecycle.adapter;
                state.streamer = lifecycle.streamer;
                await initialize();
            }
        },
        actions: {
            createSale: action(createSale, {
                schema: createSaleSchema,
                trigger: 'custom_json',
                description: 'Open a token sale. Optional softCap is the minimum units that must sell; below it the sale fails and contributions are refunded.'
            }),
            contribute: action(contribute, {
                schema: saleIdSchema,
                trigger: ['transfer', 'recurrent_transfer'],
                description: 'Buy sale units by sending payment to the launchpad account. Whole units are filled up to what remains; any unfilled portion is refunded.',
                // Contributions go to the launchpad account: the streamer
                // username unless options.account names another account.
                ...(options.account ? { guards: { allowedRecipients: [options.account] } } : {})
            }),
            finalizeSale: action(finalizeSale, {
                schema: saleIdSchema,
                trigger: ['custom_json', 'time'],
                description: 'Finalize a closed or sold-out sale. A sale below its soft cap fails and every contribution is refunded; calling it again retries failed refunds.'
            }),
            claimAllocation: action(claimAllocation, { schema: saleIdSchema, trigger: 'custom_json' })
        }
    });
}
