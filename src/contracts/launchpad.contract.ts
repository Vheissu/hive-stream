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

const DEFAULT_NAME = 'launchpad';

export interface LaunchpadContractOptions {
    name?: string;
}

export function createLaunchpadContract(options: LaunchpadContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

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
        metadata: z.record(z.any()).optional()
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
            `
        ]);
    };

    const createSale = async (payload: z.infer<typeof createSaleSchema>, ctx: any) => {
        const creator = requireSender(ctx);
        const existing = await state.adapter.query('SELECT sale_id FROM launchpad_sales WHERE sale_id = ?', [payload.saleId]);
        if (existing.length > 0) {
            throw new Error(`Sale ${payload.saleId} already exists`);
        }

        const closesAt = parseDateValue(payload.closesAt);
        if (!closesAt || closesAt <= new Date()) {
            throw new Error('Sale close time must be in the future');
        }

        if (payload.maxUnitsPerBuyer && payload.minUnitsPerBuyer && payload.maxUnitsPerBuyer < payload.minUnitsPerBuyer) {
            throw new Error('Maximum units per buyer cannot be less than the minimum');
        }

        await state.adapter.query(
            `INSERT INTO launchpad_sales (
                sale_id, creator, title, token_symbol, purchase_asset, unit_price, total_units, units_sold, closes_at,
                min_units_per_buyer, max_units_per_buyer, status, metadata, created_at, finalized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                'open',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createSale', payload, {
            action: 'launchpad_sale_created',
            data: {
                saleId: payload.saleId,
                creator
            }
        });
    };

    const contribute = async (payload: z.infer<typeof saleIdSchema>, ctx: any) => {
        const buyer = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM launchpad_sales WHERE sale_id = ?', [payload.saleId]);
        if (rows.length === 0) {
            throw new Error(`Sale ${payload.saleId} does not exist`);
        }

        const sale = rows[0];
        if (sale.status !== 'open') {
            throw new Error('Sale is not open');
        }

        if ((parseDateValue(sale.closes_at) || new Date()) <= new Date()) {
            throw new Error('Sale has already closed');
        }

        assertAssetMatches(payment.asset, sale.purchase_asset);

        const units = toBigNumber(payment.amount).dividedBy(sale.unit_price);
        if (!units.isInteger()) {
            throw new Error('Contribution amount must match a whole number of sale units');
        }

        const unitCount = units.toNumber();
        if (sale.min_units_per_buyer && unitCount < Number(sale.min_units_per_buyer)) {
            throw new Error('Contribution is below the minimum purchase size');
        }

        const existingRows = await state.adapter.query('SELECT * FROM launchpad_allocations WHERE sale_id = ? AND buyer = ?', [payload.saleId, buyer]);
        const existingUnits = existingRows.length > 0 ? Number(existingRows[0].units) : 0;
        const totalBuyerUnits = existingUnits + unitCount;

        if (sale.max_units_per_buyer && totalBuyerUnits > Number(sale.max_units_per_buyer)) {
            throw new Error('Contribution exceeds the per-buyer cap');
        }

        if (Number(sale.units_sold) + unitCount > Number(sale.total_units)) {
            throw new Error('Contribution exceeds the remaining sale allocation');
        }

        const totalPaid = existingRows.length > 0
            ? toBigNumber(existingRows[0].amount_paid).plus(payment.amount)
            : toBigNumber(payment.amount);

        await state.adapter.query(
            `INSERT INTO launchpad_allocations (sale_id, buyer, units, amount_paid, asset, claimed, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(sale_id, buyer)
             DO UPDATE SET units = excluded.units, amount_paid = excluded.amount_paid, asset = excluded.asset, updated_at = excluded.updated_at`,
            [payload.saleId, buyer, totalBuyerUnits, totalPaid.toFixed(), payment.asset, 0, new Date(), new Date()]
        );
        await state.adapter.query(
            'UPDATE launchpad_sales SET units_sold = ? WHERE sale_id = ?',
            [Number(sale.units_sold) + unitCount, payload.saleId]
        );

        await emitContractEvent(state.adapter, name, 'contribute', payload, {
            action: 'launchpad_contribution_received',
            data: {
                saleId: payload.saleId,
                buyer,
                units: unitCount,
                totalBuyerUnits
            }
        });
    };

    const finalizeSale = async (payload: z.infer<typeof saleIdSchema>, ctx: any) => {
        const rows = await state.adapter.query('SELECT * FROM launchpad_sales WHERE sale_id = ?', [payload.saleId]);
        if (rows.length === 0) {
            throw new Error(`Sale ${payload.saleId} does not exist`);
        }

        const sale = rows[0];
        if (sale.status === 'successful' || sale.status === 'closed') {
            return;
        }

        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== sale.creator) {
                throw new Error('Only the sale creator can finalize the sale');
            }
        }

        if ((parseDateValue(sale.closes_at) || new Date()) > new Date() && Number(sale.units_sold) < Number(sale.total_units)) {
            throw new Error('Sale cannot be finalized before it closes unless it sells out');
        }

        const status = Number(sale.units_sold) > 0 ? 'successful' : 'closed';
        await state.adapter.query(
            'UPDATE launchpad_sales SET status = ?, finalized_at = ? WHERE sale_id = ?',
            [status, new Date(), payload.saleId]
        );

        await emitContractEvent(state.adapter, name, 'finalizeSale', payload, {
            action: 'launchpad_sale_finalized',
            data: {
                saleId: payload.saleId,
                status,
                unitsSold: sale.units_sold
            }
        });
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
            [1, new Date(), payload.saleId, buyer]
        );

        await emitContractEvent(state.adapter, name, 'claimAllocation', payload, {
            action: 'launchpad_allocation_claim_requested',
            data: {
                saleId: payload.saleId,
                buyer,
                tokenSymbol: sale.token_symbol,
                units: allocation.units
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
            createSale: action(createSale, { schema: createSaleSchema, trigger: 'custom_json' }),
            contribute: action(contribute, { schema: saleIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            finalizeSale: action(finalizeSale, { schema: saleIdSchema, trigger: ['custom_json', 'time'] }),
            claimAllocation: action(claimAllocation, { schema: saleIdSchema, trigger: 'custom_json' })
        }
    });
}
