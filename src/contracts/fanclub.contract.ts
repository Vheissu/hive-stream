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
    requireSender
} from './helpers';

const DEFAULT_NAME = 'fanclub';

export interface FanClubContractOptions {
    name?: string;
}

export function createFanClubContract(options: FanClubContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const perkSchema = z.object({
        perkId: identifierSchema,
        minPoints: z.number().int().min(0),
        title: z.string().min(1).max(80)
    });

    const createClubSchema = z.object({
        clubId: identifierSchema,
        title: z.string().min(3).max(140),
        joinPrice: amountSchema,
        asset: assetSchema,
        perks: z.array(perkSchema).max(25).optional(),
        metadata: z.record(z.any()).optional()
    });

    const clubIdSchema = z.object({
        clubId: identifierSchema
    });

    const progressSchema = z.object({
        clubId: identifierSchema,
        account: z.string().min(3).max(32),
        points: z.number().int().min(1).max(1000000),
        note: z.string().max(280).optional()
    });

    const redeemSchema = z.object({
        clubId: identifierSchema,
        perkId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS fan_clubs (
                    club_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    join_price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    perks_json TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS fan_club_members (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    club_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    status TEXT NOT NULL,
                    renewals INTEGER NOT NULL,
                    points INTEGER NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(club_id, account)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS fan_club_redemptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    club_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    perk_id TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    UNIQUE(club_id, account, perk_id)
                )
            `
        ]);
    };

    const createClub = async (payload: z.infer<typeof createClubSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT club_id FROM fan_clubs WHERE club_id = ?', [payload.clubId]);
        if (existing.length > 0) {
            throw new Error(`Club ${payload.clubId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO fan_clubs (
                club_id, owner, title, join_price, asset, perks_json, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [payload.clubId, owner, payload.title, payload.joinPrice, payload.asset, JSON.stringify(payload.perks || []), JSON.stringify(payload.metadata || {}), new Date()]
        );

        await emitContractEvent(state.adapter, name, 'createClub', payload, {
            action: 'fan_club_created',
            data: {
                clubId: payload.clubId,
                owner
            }
        });
    };

    const joinClub = async (payload: z.infer<typeof clubIdSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM fan_clubs WHERE club_id = ?', [payload.clubId]);
        if (rows.length === 0) {
            throw new Error(`Club ${payload.clubId} does not exist`);
        }

        const club = rows[0];
        assertAssetMatches(payment.asset, club.asset);
        if (payment.amount !== club.join_price) {
            throw new Error(`Club join price is ${club.join_price} ${club.asset}`);
        }

        const members = await state.adapter.query('SELECT * FROM fan_club_members WHERE club_id = ? AND account = ?', [payload.clubId, account]);
        const renewals = members.length > 0 ? Number(members[0].renewals) + 1 : 1;
        const points = members.length > 0 ? Number(members[0].points) : 0;

        await state.adapter.query(
            `INSERT INTO fan_club_members (club_id, account, status, renewals, points, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(club_id, account)
             DO UPDATE SET status = excluded.status, renewals = excluded.renewals, updated_at = excluded.updated_at`,
            [payload.clubId, account, 'active', renewals, points, new Date(), new Date()]
        );

        await emitContractEvent(state.adapter, name, 'joinClub', payload, {
            action: 'fan_club_joined',
            data: {
                clubId: payload.clubId,
                account,
                renewals
            }
        });
    };

    const recordEngagement = async (payload: z.infer<typeof progressSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const clubRows = await state.adapter.query('SELECT * FROM fan_clubs WHERE club_id = ?', [payload.clubId]);
        const memberRows = await state.adapter.query('SELECT * FROM fan_club_members WHERE club_id = ? AND account = ?', [payload.clubId, payload.account]);
        if (clubRows.length === 0 || memberRows.length === 0) {
            throw new Error('Club or member does not exist');
        }

        const club = clubRows[0];
        if (club.owner !== owner) {
            throw new Error('Only the club owner can record engagement');
        }

        const member = memberRows[0];
        const nextPoints = Number(member.points) + payload.points;
        await state.adapter.query(
            'UPDATE fan_club_members SET points = ?, updated_at = ? WHERE club_id = ? AND account = ?',
            [nextPoints, new Date(), payload.clubId, payload.account]
        );

        await emitContractEvent(state.adapter, name, 'recordEngagement', payload, {
            action: 'fan_club_progress_recorded',
            data: {
                clubId: payload.clubId,
                account: payload.account,
                totalPoints: nextPoints,
                note: payload.note || ''
            }
        });
    };

    const redeemPerk = async (payload: z.infer<typeof redeemSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const clubRows = await state.adapter.query('SELECT * FROM fan_clubs WHERE club_id = ?', [payload.clubId]);
        const memberRows = await state.adapter.query('SELECT * FROM fan_club_members WHERE club_id = ? AND account = ?', [payload.clubId, account]);
        if (clubRows.length === 0 || memberRows.length === 0) {
            throw new Error('Club or member does not exist');
        }

        const club = clubRows[0];
        const member = memberRows[0];
        const perks = parseJson<Array<{ perkId: string; minPoints: number; title: string }>>(club.perks_json, []);
        const perk = perks.find(candidate => candidate.perkId === payload.perkId);
        if (!perk) {
            throw new Error('Perk does not exist');
        }

        if (Number(member.points) < perk.minPoints) {
            throw new Error('Member has not unlocked this perk');
        }

        const existing = await state.adapter.query(
            'SELECT id FROM fan_club_redemptions WHERE club_id = ? AND account = ? AND perk_id = ?',
            [payload.clubId, account, payload.perkId]
        );
        if (existing.length > 0) {
            throw new Error('Perk already redeemed');
        }

        await state.adapter.query(
            'INSERT INTO fan_club_redemptions (club_id, account, perk_id, created_at) VALUES (?, ?, ?, ?)',
            [payload.clubId, account, payload.perkId, new Date()]
        );

        await emitContractEvent(state.adapter, name, 'redeemPerk', payload, {
            action: 'fan_club_perk_redeemed',
            data: {
                clubId: payload.clubId,
                account,
                perkId: payload.perkId,
                title: perk.title
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
            createClub: action(createClub, { schema: createClubSchema, trigger: 'custom_json' }),
            joinClub: action(joinClub, { schema: clubIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            recordEngagement: action(recordEngagement, { schema: progressSchema, trigger: 'custom_json' }),
            redeemPerk: action(redeemPerk, { schema: redeemSchema, trigger: 'custom_json' })
        }
    });
}
