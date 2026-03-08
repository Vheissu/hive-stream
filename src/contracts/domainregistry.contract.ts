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

const DEFAULT_NAME = 'domains';
const domainNameSchema = z.string().min(3).max(63).regex(/^[a-z0-9-]+$/, 'Invalid domain label');

export interface DomainRegistryContractOptions {
    name?: string;
}

export function createDomainRegistryContract(options: DomainRegistryContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createNamespaceSchema = z.object({
        namespace: domainNameSchema,
        title: z.string().min(3).max(140),
        registrationPrice: amountSchema,
        asset: assetSchema,
        renewalDays: z.number().int().min(1).max(3650),
        metadata: z.record(z.any()).optional()
    });

    const registerNameSchema = z.object({
        namespace: domainNameSchema,
        label: domainNameSchema,
        target: z.string().min(1).max(280),
        years: z.number().int().min(1).max(20).optional(),
        metadata: z.record(z.any()).optional()
    });

    const transferSchema = z.object({
        namespace: domainNameSchema,
        label: domainNameSchema,
        to: z.string().min(3).max(32)
    });

    const expireSchema = z.object({
        namespace: domainNameSchema.optional()
    }).optional();

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS domain_namespaces (
                    namespace TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    registration_price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    renewal_days INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS domain_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    namespace TEXT NOT NULL,
                    label TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    target TEXT NOT NULL,
                    status TEXT NOT NULL,
                    expires_at DATETIME NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(namespace, label)
                )
            `
        ]);
    };

    const createNamespace = async (payload: z.infer<typeof createNamespaceSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT namespace FROM domain_namespaces WHERE namespace = ?', [payload.namespace]);
        if (existing.length > 0) {
            throw new Error(`Namespace ${payload.namespace} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO domain_namespaces (
                namespace, owner, title, registration_price, asset, renewal_days, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.namespace,
                owner,
                payload.title,
                payload.registrationPrice,
                payload.asset,
                payload.renewalDays,
                JSON.stringify(payload.metadata || {}),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createNamespace', payload, {
            action: 'domain_namespace_created',
            data: {
                namespace: payload.namespace,
                owner
            }
        });
    };

    const registerName = async (payload: z.infer<typeof registerNameSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const namespaceRows = await state.adapter.query('SELECT * FROM domain_namespaces WHERE namespace = ?', [payload.namespace]);
        if (namespaceRows.length === 0) {
            throw new Error(`Namespace ${payload.namespace} does not exist`);
        }

        const namespace = namespaceRows[0];
        assertAssetMatches(payment.asset, namespace.asset);

        const termYears = payload.years || 1;
        const expectedAmount = toBigNumber(namespace.registration_price).multipliedBy(termYears);
        if (!toBigNumber(payment.amount).eq(expectedAmount)) {
            throw new Error(`Registration requires ${expectedAmount.toFixed()} ${namespace.asset}`);
        }

        const existing = await state.adapter.query('SELECT * FROM domain_records WHERE namespace = ? AND label = ?', [payload.namespace, payload.label]);
        if (existing.length > 0) {
            const record = existing[0];
            const expiresAt = parseDateValue(record.expires_at);
            if (record.status === 'active' && expiresAt && expiresAt > new Date()) {
                throw new Error('Domain name is already registered');
            }
        }

        const expiresAt = new Date(Date.now() + termYears * Number(namespace.renewal_days) * 24 * 60 * 60 * 1000);
        await state.adapter.query(
            `INSERT INTO domain_records (
                namespace, label, owner, target, status, expires_at, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(namespace, label)
            DO UPDATE SET owner = excluded.owner, target = excluded.target, status = excluded.status, expires_at = excluded.expires_at, metadata = excluded.metadata, updated_at = excluded.updated_at`,
            [
                payload.namespace,
                payload.label,
                owner,
                payload.target,
                'active',
                expiresAt,
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'registerName', payload, {
            action: 'domain_registered',
            data: {
                namespace: payload.namespace,
                label: payload.label,
                owner,
                expiresAt
            }
        });
    };

    const renewName = async (payload: z.infer<typeof registerNameSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const namespaceRows = await state.adapter.query('SELECT * FROM domain_namespaces WHERE namespace = ?', [payload.namespace]);
        const recordRows = await state.adapter.query('SELECT * FROM domain_records WHERE namespace = ? AND label = ?', [payload.namespace, payload.label]);
        if (namespaceRows.length === 0 || recordRows.length === 0) {
            throw new Error('Domain record does not exist');
        }

        const namespace = namespaceRows[0];
        const record = recordRows[0];
        if (record.owner !== owner) {
            throw new Error('Only the domain owner can renew the name');
        }

        assertAssetMatches(payment.asset, namespace.asset);
        const termYears = payload.years || 1;
        const expectedAmount = toBigNumber(namespace.registration_price).multipliedBy(termYears);
        if (!toBigNumber(payment.amount).eq(expectedAmount)) {
            throw new Error(`Renewal requires ${expectedAmount.toFixed()} ${namespace.asset}`);
        }

        const baseDate = parseDateValue(record.expires_at) && parseDateValue(record.expires_at)! > new Date()
            ? parseDateValue(record.expires_at)!
            : new Date();
        const expiresAt = new Date(baseDate.getTime() + termYears * Number(namespace.renewal_days) * 24 * 60 * 60 * 1000);

        await state.adapter.query(
            'UPDATE domain_records SET expires_at = ?, status = ?, updated_at = ? WHERE namespace = ? AND label = ?',
            [expiresAt, 'active', new Date(), payload.namespace, payload.label]
        );

        await emitContractEvent(state.adapter, name, 'renewName', payload, {
            action: 'domain_renewed',
            data: {
                namespace: payload.namespace,
                label: payload.label,
                owner,
                expiresAt
            }
        });
    };

    const transferName = async (payload: z.infer<typeof transferSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM domain_records WHERE namespace = ? AND label = ?', [payload.namespace, payload.label]);
        if (rows.length === 0) {
            throw new Error('Domain record does not exist');
        }

        const record = rows[0];
        if (record.owner !== owner) {
            throw new Error('Only the domain owner can transfer the name');
        }

        await state.adapter.query(
            'UPDATE domain_records SET owner = ?, updated_at = ? WHERE namespace = ? AND label = ?',
            [payload.to, new Date(), payload.namespace, payload.label]
        );

        await emitContractEvent(state.adapter, name, 'transferName', payload, {
            action: 'domain_transferred',
            data: {
                namespace: payload.namespace,
                label: payload.label,
                from: owner,
                to: payload.to
            }
        });
    };

    const expireNames = async (payload: { namespace?: string } = {}, _ctx: any) => {
        const rows = payload.namespace
            ? await state.adapter.query('SELECT * FROM domain_records WHERE namespace = ?', [payload.namespace])
            : await state.adapter.query('SELECT * FROM domain_records', []);
        const now = new Date();

        for (const record of rows) {
            const expiresAt = parseDateValue(record.expires_at);
            if (expiresAt && expiresAt < now && record.status === 'active') {
                await state.adapter.query(
                    'UPDATE domain_records SET status = ?, updated_at = ? WHERE namespace = ? AND label = ?',
                    ['expired', now, record.namespace, record.label]
                );

                await emitContractEvent(state.adapter, name, 'expireNames', payload, {
                    action: 'domain_expired',
                    data: {
                        namespace: record.namespace,
                        label: record.label,
                        owner: record.owner
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
            createNamespace: action(createNamespace, { schema: createNamespaceSchema, trigger: 'custom_json' }),
            registerName: action(registerName, { schema: registerNameSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            renewName: action(renewName, { schema: registerNameSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            transferName: action(transferName, { schema: transferSchema, trigger: 'custom_json' }),
            expireNames: action(expireNames, { schema: expireSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
