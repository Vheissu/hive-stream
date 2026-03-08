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

const DEFAULT_NAME = 'paywall';

export interface PaywallContractOptions {
    name?: string;
}

export function createPaywallContract(options: PaywallContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createResourceSchema = z.object({
        resourceId: identifierSchema,
        title: z.string().min(3).max(140),
        price: amountSchema,
        asset: assetSchema,
        accessDays: z.number().int().min(1).max(3650),
        maxPurchasesPerAccount: z.number().int().min(1).max(100000).optional(),
        metadata: z.record(z.any()).optional()
    });

    const resourceIdSchema = z.object({
        resourceId: identifierSchema
    });

    const revokeSchema = z.object({
        resourceId: identifierSchema,
        account: z.string().min(3).max(32)
    });

    const expireSchema = z.object({
        resourceId: identifierSchema.optional()
    }).optional();

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS paywall_resources (
                    resource_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    access_days INTEGER NOT NULL,
                    max_purchases_per_account INTEGER,
                    active INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS paywall_access (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    resource_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    purchases INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    granted_at DATETIME NOT NULL,
                    expires_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(resource_id, account)
                )
            `
        ]);
    };

    const createResource = async (payload: z.infer<typeof createResourceSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT resource_id FROM paywall_resources WHERE resource_id = ?', [payload.resourceId]);
        if (existing.length > 0) {
            throw new Error(`Resource ${payload.resourceId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO paywall_resources (
                resource_id, owner, title, price, asset, access_days, max_purchases_per_account, active, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.resourceId,
                owner,
                payload.title,
                payload.price,
                payload.asset,
                payload.accessDays,
                payload.maxPurchasesPerAccount || null,
                1,
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createResource', payload, {
            action: 'paywall_resource_created',
            data: {
                resourceId: payload.resourceId,
                owner
            }
        });
    };

    const grantAccess = async (payload: z.infer<typeof resourceIdSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM paywall_resources WHERE resource_id = ?', [payload.resourceId]);
        if (rows.length === 0) {
            throw new Error(`Resource ${payload.resourceId} does not exist`);
        }

        const resource = rows[0];
        if (!resource.active) {
            throw new Error('Resource is not active');
        }

        assertAssetMatches(payment.asset, resource.asset);
        if (toBigNumber(payment.amount).lt(resource.price)) {
            throw new Error('Payment amount is below the resource price');
        }

        const accessRows = await state.adapter.query(
            'SELECT * FROM paywall_access WHERE resource_id = ? AND account = ?',
            [payload.resourceId, account]
        );

        const now = new Date();
        const baseDate = accessRows.length > 0 && parseDateValue(accessRows[0].expires_at) && parseDateValue(accessRows[0].expires_at)! > now
            ? parseDateValue(accessRows[0].expires_at)!
            : now;
        const nextExpires = new Date(baseDate.getTime() + Number(resource.access_days) * 24 * 60 * 60 * 1000);
        const purchases = accessRows.length > 0 ? Number(accessRows[0].purchases) + 1 : 1;

        if (resource.max_purchases_per_account && purchases > Number(resource.max_purchases_per_account)) {
            throw new Error('Purchase exceeds the per-account limit for this resource');
        }

        await state.adapter.query(
            `INSERT INTO paywall_access (resource_id, account, purchases, status, granted_at, expires_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(resource_id, account)
             DO UPDATE SET purchases = excluded.purchases, status = excluded.status, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
            [payload.resourceId, account, purchases, 'active', now, nextExpires, now]
        );

        await emitContractEvent(state.adapter, name, 'grantAccess', payload, {
            action: 'paywall_access_granted',
            data: {
                resourceId: payload.resourceId,
                account,
                expiresAt: nextExpires,
                source: payment.source
            }
        });
    };

    const revokeAccess = async (payload: z.infer<typeof revokeSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM paywall_resources WHERE resource_id = ?', [payload.resourceId]);
        if (rows.length === 0) {
            throw new Error(`Resource ${payload.resourceId} does not exist`);
        }

        const resource = rows[0];
        if (resource.owner !== owner) {
            throw new Error('Only the resource owner can revoke access');
        }

        await state.adapter.query(
            'UPDATE paywall_access SET status = ?, updated_at = ? WHERE resource_id = ? AND account = ?',
            ['revoked', new Date(), payload.resourceId, payload.account]
        );

        await emitContractEvent(state.adapter, name, 'revokeAccess', payload, {
            action: 'paywall_access_revoked',
            data: {
                resourceId: payload.resourceId,
                account: payload.account,
                revokedBy: owner
            }
        });
    };

    const expireAccess = async (payload: { resourceId?: string } = {}, _ctx: any) => {
        const rows = payload.resourceId
            ? await state.adapter.query('SELECT * FROM paywall_access WHERE resource_id = ?', [payload.resourceId])
            : await state.adapter.query('SELECT * FROM paywall_access', []);
        const now = new Date();

        for (const access of rows) {
            const expiresAt = parseDateValue(access.expires_at);
            if (expiresAt && expiresAt < now && access.status === 'active') {
                await state.adapter.query(
                    'UPDATE paywall_access SET status = ?, updated_at = ? WHERE resource_id = ? AND account = ?',
                    ['expired', now, access.resource_id, access.account]
                );

                await emitContractEvent(state.adapter, name, 'expireAccess', payload, {
                    action: 'paywall_access_expired',
                    data: {
                        resourceId: access.resource_id,
                        account: access.account
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
            createResource: action(createResource, { schema: createResourceSchema, trigger: 'custom_json' }),
            grantAccess: action(grantAccess, { schema: resourceIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            revokeAccess: action(revokeAccess, { schema: revokeSchema, trigger: 'custom_json' }),
            expireAccess: action(expireAccess, { schema: expireSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
