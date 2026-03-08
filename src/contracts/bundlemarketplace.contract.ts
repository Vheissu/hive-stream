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
    parseJson,
    requireSender,
    toBigNumber
} from './helpers';

const DEFAULT_NAME = 'bundlemarketplace';

export interface BundleMarketplaceContractOptions {
    name?: string;
}

export function createBundleMarketplaceContract(options: BundleMarketplaceContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createBundleSchema = z.object({
        bundleId: identifierSchema,
        title: z.string().min(3).max(140),
        price: amountSchema,
        asset: assetSchema,
        items: z.array(z.string().min(1).max(140)).min(1).max(25),
        inventory: z.number().int().min(1).max(1000000).optional(),
        metadata: z.record(z.any()).optional()
    });

    const idSchema = z.object({
        bundleId: identifierSchema
    });

    const updateSchema = z.object({
        bundleId: identifierSchema,
        title: z.string().min(3).max(140).optional(),
        price: amountSchema.optional(),
        inventory: z.number().int().min(0).max(1000000).optional(),
        active: z.boolean().optional(),
        metadata: z.record(z.any()).optional()
    });

    const fulfillSchema = z.object({
        purchaseId: z.number().int().min(1),
        notes: z.string().max(280).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS bundle_marketplace_bundles (
                    bundle_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    items_json TEXT NOT NULL,
                    inventory INTEGER,
                    sold_count INTEGER NOT NULL,
                    active INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS bundle_marketplace_purchases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bundle_id TEXT NOT NULL,
                    buyer TEXT NOT NULL,
                    amount_paid TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    status TEXT NOT NULL,
                    notes TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createBundle = async (payload: z.infer<typeof createBundleSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT bundle_id FROM bundle_marketplace_bundles WHERE bundle_id = ?', [payload.bundleId]);
        if (existing.length > 0) {
            throw new Error(`Bundle ${payload.bundleId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO bundle_marketplace_bundles (
                bundle_id, owner, title, price, asset, items_json, inventory, sold_count, active, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.bundleId,
                owner,
                payload.title,
                payload.price,
                payload.asset,
                JSON.stringify(payload.items),
                payload.inventory || null,
                0,
                1,
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createBundle', payload, {
            action: 'bundle_created',
            data: {
                bundleId: payload.bundleId,
                owner
            }
        });
    };

    const updateBundle = async (payload: z.infer<typeof updateSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM bundle_marketplace_bundles WHERE bundle_id = ?', [payload.bundleId]);
        if (rows.length === 0) {
            throw new Error(`Bundle ${payload.bundleId} does not exist`);
        }

        const bundle = rows[0];
        if (bundle.owner !== owner) {
            throw new Error('Only the bundle owner can update the bundle');
        }

        await state.adapter.query(
            `UPDATE bundle_marketplace_bundles
             SET title = ?, price = ?, inventory = ?, active = ?, metadata = ?, updated_at = ?
             WHERE bundle_id = ?`,
            [
                payload.title || bundle.title,
                payload.price || bundle.price,
                typeof payload.inventory === 'number' ? payload.inventory : bundle.inventory,
                typeof payload.active === 'boolean' ? (payload.active ? 1 : 0) : bundle.active,
                JSON.stringify(payload.metadata || parseJson(bundle.metadata, {})),
                new Date(),
                payload.bundleId
            ]
        );

        await emitContractEvent(state.adapter, name, 'updateBundle', payload, {
            action: 'bundle_updated',
            data: {
                bundleId: payload.bundleId,
                owner
            }
        });
    };

    const buyBundle = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const buyer = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM bundle_marketplace_bundles WHERE bundle_id = ?', [payload.bundleId]);
        if (rows.length === 0) {
            throw new Error(`Bundle ${payload.bundleId} does not exist`);
        }

        const bundle = rows[0];
        if (!bundle.active) {
            throw new Error('Bundle is not active');
        }

        assertAssetMatches(payment.asset, bundle.asset);
        if (!toBigNumber(payment.amount).eq(bundle.price)) {
            throw new Error(`Bundle price is ${bundle.price} ${bundle.asset}`);
        }

        if (bundle.inventory !== null && Number(bundle.inventory) <= 0) {
            throw new Error('Bundle is out of stock');
        }

        await state.adapter.query(
            'INSERT INTO bundle_marketplace_purchases (bundle_id, buyer, amount_paid, asset, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [payload.bundleId, buyer, payment.amount, payment.asset, 'paid', '', new Date(), new Date()]
        );

        const nextInventory = bundle.inventory === null ? null : Number(bundle.inventory) - 1;
        await state.adapter.query(
            'UPDATE bundle_marketplace_bundles SET inventory = ?, sold_count = ?, updated_at = ? WHERE bundle_id = ?',
            [nextInventory, Number(bundle.sold_count) + 1, new Date(), payload.bundleId]
        );

        await emitContractEvent(state.adapter, name, 'buyBundle', payload, {
            action: 'bundle_purchased',
            data: {
                bundleId: payload.bundleId,
                buyer,
                items: parseJson<string[]>(bundle.items_json, [])
            }
        });
    };

    const fulfillPurchase = async (payload: z.infer<typeof fulfillSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const purchaseRows = await state.adapter.query('SELECT * FROM bundle_marketplace_purchases WHERE id = ?', [payload.purchaseId]);
        if (purchaseRows.length === 0) {
            throw new Error(`Purchase ${payload.purchaseId} does not exist`);
        }

        const purchase = purchaseRows[0];
        const bundleRows = await state.adapter.query('SELECT * FROM bundle_marketplace_bundles WHERE bundle_id = ?', [purchase.bundle_id]);
        const bundle = bundleRows[0];
        if (bundle.owner !== owner) {
            throw new Error('Only the bundle owner can fulfill purchases');
        }

        await state.adapter.query(
            'UPDATE bundle_marketplace_purchases SET status = ?, notes = ?, updated_at = ? WHERE id = ?',
            ['fulfilled', payload.notes || '', new Date(), payload.purchaseId]
        );

        await emitContractEvent(state.adapter, name, 'fulfillPurchase', payload, {
            action: 'bundle_purchase_fulfilled',
            data: {
                purchaseId: payload.purchaseId,
                bundleId: purchase.bundle_id,
                buyer: purchase.buyer
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
            createBundle: action(createBundle, { schema: createBundleSchema, trigger: 'custom_json' }),
            updateBundle: action(updateBundle, { schema: updateSchema, trigger: 'custom_json' }),
            buyBundle: action(buyBundle, { schema: idSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            fulfillPurchase: action(fulfillPurchase, { schema: fulfillSchema, trigger: 'custom_json' })
        }
    });
}
