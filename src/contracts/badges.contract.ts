import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    createContractState,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    requireSender,
    getIncomingPayment,
    toBigNumber
} from './helpers';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'badges';
const accountSchema = z.string().min(3).max(16);

const ruleSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('payment_total'),
        asset: assetSchema,
        minAmount: amountSchema
    }),
    z.object({
        type: z.literal('checkin_count'),
        minCount: z.number().int().min(1).max(10000),
        periodSeconds: z.number().int().min(60).max(31 * 24 * 60 * 60).default(86400),
        consecutive: z.boolean().default(false)
    })
]);

export type BadgeRule = z.infer<typeof ruleSchema>;

export interface BadgesContractOptions {
    name?: string;
    /** Account that receives `payment_total` rule payments. Required to use payment rules. */
    account?: string;
    /** When set, only these accounts can define badges. */
    admins?: string[];
}

export function createBadgesContract(options: BadgesContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const account = options.account;
    const admins = options.admins;
    const state = createContractState();

    const badgeIdSchema = z.object({ badgeId: identifierSchema });

    const defineBadgeSchema = z.object({
        badgeId: identifierSchema,
        title: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
        imageUrl: z.string().url().max(500).optional(),
        issuers: z.array(accountSchema).max(20).optional(),
        maxSupply: z.number().int().min(1).optional(),
        rule: ruleSchema.optional()
    });

    const issueSchema = z.object({
        badgeId: identifierSchema,
        recipient: accountSchema,
        reason: z.string().max(280).optional(),
        evidence: z.string().max(500).optional()
    });

    const revokeSchema = z.object({
        badgeId: identifierSchema,
        recipient: accountSchema,
        reason: z.string().max(280)
    });

    const updateIssuersSchema = z.object({
        badgeId: identifierSchema,
        add: z.array(accountSchema).max(20).optional(),
        remove: z.array(accountSchema).max(20).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS badges (
                    badge_id TEXT PRIMARY KEY,
                    creator TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    image_url TEXT,
                    issuers TEXT NOT NULL,
                    max_supply INTEGER,
                    issued_count INTEGER NOT NULL,
                    rule TEXT,
                    created_at TEXT NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS badge_awards (
                    badge_id TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    issuer TEXT NOT NULL,
                    reason TEXT,
                    evidence TEXT,
                    status TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    awarded_at TEXT NOT NULL,
                    revoked_at TEXT,
                    revoke_reason TEXT,
                    PRIMARY KEY (badge_id, recipient)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS badge_progress (
                    badge_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    total TEXT NOT NULL,
                    checkins INTEGER NOT NULL,
                    last_checkin_at TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (badge_id, account)
                )
            `
        ]);
    };

    const nowOf = (ctx: ContractContext): Date => ctx.block?.time instanceof Date && !Number.isNaN(ctx.block.time.getTime())
        ? ctx.block.time
        : new Date();

    const getBadge = async (badgeId: string) => {
        const rows = await state.adapter.query('SELECT * FROM badges WHERE badge_id = ?', [badgeId]);

        if (rows.length === 0) {
            throw new Error(`Badge ${badgeId} does not exist`);
        }

        const badge = rows[0];
        return {
            ...badge,
            issuers: JSON.parse(badge.issuers) as string[],
            rule: badge.rule ? JSON.parse(badge.rule) as BadgeRule : null
        };
    };

    const award = async (badge: any, recipient: string, issuer: string, ctx: ContractContext, reason?: string, evidence?: string): Promise<boolean> => {
        const existing = await state.adapter.query(
            'SELECT status FROM badge_awards WHERE badge_id = ? AND recipient = ?',
            [badge.badge_id, recipient]
        );

        if (existing.length > 0 && existing[0].status === 'active') {
            return false;
        }

        if (badge.max_supply !== null && badge.max_supply !== undefined && Number(badge.issued_count) >= Number(badge.max_supply)) {
            throw new Error(`Badge ${badge.badge_id} has reached its maximum supply`);
        }

        const now = nowOf(ctx).toISOString();

        if (existing.length > 0) {
            await state.adapter.query(
                `UPDATE badge_awards SET issuer = ?, reason = ?, evidence = ?, status = ?, transaction_id = ?, awarded_at = ?,
                 revoked_at = ?, revoke_reason = ? WHERE badge_id = ? AND recipient = ?`,
                [issuer, reason ?? null, evidence ?? null, 'active', operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex), now, null, null, badge.badge_id, recipient]
            );
        } else {
            await state.adapter.query(
                `INSERT INTO badge_awards (badge_id, recipient, issuer, reason, evidence, status, transaction_id, awarded_at, revoked_at, revoke_reason)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [badge.badge_id, recipient, issuer, reason ?? null, evidence ?? null, 'active', operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex), now, null, null]
            );
        }

        await state.adapter.query('UPDATE badges SET issued_count = issued_count + 1 WHERE badge_id = ?', [badge.badge_id]);

        await emitContractEvent(state.adapter, name, 'award', { badgeId: badge.badge_id, recipient }, {
            action: 'badge_awarded',
            data: { badgeId: badge.badge_id, recipient, issuer, reason: reason ?? null }
        });

        return true;
    };

    const defineBadge = async (payload: z.infer<typeof defineBadgeSchema>, ctx: ContractContext) => {
        const creator = requireSender(ctx);

        if (admins && !admins.includes(creator)) {
            throw new Error(`${creator} cannot define badges`);
        }

        if (payload.rule?.type === 'payment_total' && !account) {
            throw new Error('payment_total rules require the contract to be configured with an account');
        }

        const existing = await state.adapter.query('SELECT badge_id FROM badges WHERE badge_id = ?', [payload.badgeId]);

        if (existing.length > 0) {
            throw new Error(`Badge ${payload.badgeId} already exists`);
        }

        const issuers = [...new Set([creator, ...(payload.issuers || [])])];

        await state.adapter.query(
            `INSERT INTO badges (badge_id, creator, title, description, image_url, issuers, max_supply, issued_count, rule, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.badgeId, creator, payload.title, payload.description ?? null, payload.imageUrl ?? null,
                JSON.stringify(issuers), payload.maxSupply ?? null, 0,
                payload.rule ? JSON.stringify(payload.rule) : null, nowOf(ctx).toISOString()
            ]
        );

        await emitContractEvent(state.adapter, name, 'defineBadge', payload, {
            action: 'badge_defined',
            data: { badgeId: payload.badgeId, creator, issuers, rule: payload.rule ?? null }
        });
    };

    const issueBadge = async (payload: z.infer<typeof issueSchema>, ctx: ContractContext) => {
        const issuer = requireSender(ctx);
        const badge = await getBadge(payload.badgeId);

        if (!badge.issuers.includes(issuer)) {
            throw new Error(`${issuer} is not an issuer of ${payload.badgeId}`);
        }

        const awarded = await award(badge, payload.recipient, issuer, ctx, payload.reason, payload.evidence);

        if (!awarded) {
            throw new Error(`${payload.recipient} already holds ${payload.badgeId}`);
        }
    };

    const revokeBadge = async (payload: z.infer<typeof revokeSchema>, ctx: ContractContext) => {
        const issuer = requireSender(ctx);
        const badge = await getBadge(payload.badgeId);

        if (!badge.issuers.includes(issuer)) {
            throw new Error(`${issuer} is not an issuer of ${payload.badgeId}`);
        }

        const rows = await state.adapter.query(
            'SELECT status FROM badge_awards WHERE badge_id = ? AND recipient = ?',
            [payload.badgeId, payload.recipient]
        );

        if (rows.length === 0 || rows[0].status !== 'active') {
            throw new Error(`${payload.recipient} does not hold ${payload.badgeId}`);
        }

        await state.adapter.query(
            'UPDATE badge_awards SET status = ?, revoked_at = ?, revoke_reason = ? WHERE badge_id = ? AND recipient = ?',
            ['revoked', nowOf(ctx).toISOString(), payload.reason, payload.badgeId, payload.recipient]
        );
        await state.adapter.query('UPDATE badges SET issued_count = issued_count - 1 WHERE badge_id = ?', [payload.badgeId]);

        await emitContractEvent(state.adapter, name, 'revokeBadge', payload, {
            action: 'badge_revoked',
            data: { badgeId: payload.badgeId, recipient: payload.recipient, issuer, reason: payload.reason }
        });
    };

    const updateIssuers = async (payload: z.infer<typeof updateIssuersSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const badge = await getBadge(payload.badgeId);

        if (sender !== badge.creator) {
            throw new Error('Only the badge creator can change issuers');
        }

        const remove = new Set(payload.remove || []);
        remove.delete(badge.creator);
        const issuers = [...new Set([...badge.issuers, ...(payload.add || [])])].filter((issuer) => !remove.has(issuer));

        await state.adapter.query('UPDATE badges SET issuers = ? WHERE badge_id = ?', [JSON.stringify(issuers), payload.badgeId]);

        await emitContractEvent(state.adapter, name, 'updateIssuers', payload, {
            action: 'badge_issuers_updated',
            data: { badgeId: payload.badgeId, issuers }
        });
    };

    const loadProgress = async (badgeId: string, holder: string) => {
        const rows = await state.adapter.query('SELECT * FROM badge_progress WHERE badge_id = ? AND account = ?', [badgeId, holder]);
        return rows[0] || null;
    };

    const saveProgress = async (existing: any, badgeId: string, holder: string, total: string, checkins: number, lastCheckinAt: string | null, now: string) => {
        if (existing) {
            await state.adapter.query(
                'UPDATE badge_progress SET total = ?, checkins = ?, last_checkin_at = ?, updated_at = ? WHERE badge_id = ? AND account = ?',
                [total, checkins, lastCheckinAt, now, badgeId, holder]
            );
            return;
        }

        await state.adapter.query(
            'INSERT INTO badge_progress (badge_id, account, total, checkins, last_checkin_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [badgeId, holder, total, checkins, lastCheckinAt, now]
        );
    };

    const contribute = async (payload: z.infer<typeof badgeIdSchema>, ctx: ContractContext) => {
        const transferCtx = getIncomingPayment(ctx);
        const sender = requireSender(ctx);

        if (!account || transferCtx.to !== account) {
            throw new Error(`Badge contributions must be sent to ${account ?? 'the configured account'}`);
        }

        const badge = await getBadge(payload.badgeId);

        if (badge.rule?.type !== 'payment_total') {
            throw new Error(`Badge ${payload.badgeId} is not earned by payments`);
        }

        if (transferCtx.asset !== badge.rule.asset) {
            throw new Error(`Badge ${payload.badgeId} counts ${badge.rule.asset} payments only`);
        }

        const progress = await loadProgress(payload.badgeId, sender);
        const total = toBigNumber(progress?.total ?? '0').plus(transferCtx.amount);
        const now = nowOf(ctx).toISOString();

        await saveProgress(progress, payload.badgeId, sender, total.toFixed(), Number(progress?.checkins ?? 0), progress?.last_checkin_at ?? null, now);

        if (total.gte(badge.rule.minAmount)) {
            await award(badge, sender, 'rule:payment_total', ctx, `Contributed ${total.toFixed(3)} ${badge.rule.asset}`);
        }
    };

    const checkIn = async (payload: z.infer<typeof badgeIdSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const badge = await getBadge(payload.badgeId);

        if (badge.rule?.type !== 'checkin_count') {
            throw new Error(`Badge ${payload.badgeId} is not earned by check-ins`);
        }

        const rule = badge.rule;
        const periodMs = (rule.periodSeconds ?? 86400) * 1000;
        const now = nowOf(ctx);
        const progress = await loadProgress(payload.badgeId, sender);
        const last = progress?.last_checkin_at ? new Date(progress.last_checkin_at) : null;

        if (last && now.getTime() - last.getTime() < periodMs) {
            throw new Error('Already checked in for this period');
        }

        let checkins = Number(progress?.checkins ?? 0) + 1;

        // Consecutive rules restart the streak when a whole period was skipped.
        if (rule.consecutive && last && now.getTime() - last.getTime() >= periodMs * 2) {
            checkins = 1;
        }

        await saveProgress(progress, payload.badgeId, sender, progress?.total ?? '0', checkins, now.toISOString(), now.toISOString());

        await emitContractEvent(state.adapter, name, 'checkIn', payload, {
            action: 'badge_checkin',
            data: { badgeId: payload.badgeId, account: sender, checkins }
        });

        if (checkins >= rule.minCount) {
            await award(badge, sender, 'rule:checkin_count', ctx, `${checkins} check-ins`);
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
            defineBadge: action(defineBadge, {
                schema: defineBadgeSchema,
                trigger: 'custom_json',
                ...(admins ? { guards: { allowedSenders: admins } } : {}),
                description: 'Define a non-transferable badge with issuers, optional supply cap and an optional earning rule.'
            }),
            issueBadge: action(issueBadge, {
                schema: issueSchema,
                trigger: 'custom_json',
                description: 'Issuer-only: award a badge to an account.'
            }),
            revokeBadge: action(revokeBadge, {
                schema: revokeSchema,
                trigger: 'custom_json',
                description: 'Issuer-only: revoke a badge with a public reason.'
            }),
            updateIssuers: action(updateIssuers, {
                schema: updateIssuersSchema,
                trigger: 'custom_json',
                description: 'Creator-only: add or remove issuers (the creator always remains an issuer).'
            }),
            contribute: action(contribute, {
                schema: badgeIdSchema,
                trigger: ['transfer', 'recurrent_transfer'],
                description: 'Count a payment toward a payment_total badge; the badge is awarded when the threshold is reached.'
            }),
            checkIn: action(checkIn, {
                schema: badgeIdSchema,
                trigger: 'custom_json',
                description: 'Record a periodic check-in toward a checkin_count badge (optionally requiring consecutive periods).'
            })
        }
    });
}
