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

const DEFAULT_NAME = 'questpass';

export interface QuestPassContractOptions {
    name?: string;
}

export function createQuestPassContract(options: QuestPassContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const tierSchema = z.object({
        tierId: identifierSchema,
        minPoints: z.number().int().min(0),
        rewardType: z.string().min(1).max(40),
        rewardValue: z.string().min(1).max(140)
    });

    const createSeasonSchema = z.object({
        seasonId: identifierSchema,
        title: z.string().min(3).max(140),
        passPrice: amountSchema,
        asset: assetSchema,
        tiers: z.array(tierSchema).min(1).max(25),
        metadata: z.record(z.any()).optional()
    });

    const seasonIdSchema = z.object({
        seasonId: identifierSchema
    });

    const recordProgressSchema = z.object({
        seasonId: identifierSchema,
        account: z.string().min(3).max(32),
        points: z.number().int().min(1).max(1000000),
        sourceId: identifierSchema.optional(),
        note: z.string().max(280).optional()
    });

    const claimRewardSchema = z.object({
        seasonId: identifierSchema,
        tierId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS quest_pass_seasons (
                    season_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    pass_price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    tiers_json TEXT NOT NULL,
                    active INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS quest_pass_holders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    season_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    status TEXT NOT NULL,
                    points INTEGER NOT NULL,
                    purchases INTEGER NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(season_id, account)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS quest_pass_claims (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    season_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    tier_id TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    UNIQUE(season_id, account, tier_id)
                )
            `
        ]);
    };

    const createSeason = async (payload: z.infer<typeof createSeasonSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT season_id FROM quest_pass_seasons WHERE season_id = ?', [payload.seasonId]);
        if (existing.length > 0) {
            throw new Error(`Season ${payload.seasonId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO quest_pass_seasons (
                season_id, owner, title, pass_price, asset, tiers_json, active, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.seasonId,
                owner,
                payload.title,
                payload.passPrice,
                payload.asset,
                JSON.stringify(payload.tiers),
                1,
                JSON.stringify(payload.metadata || {}),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createSeason', payload, {
            action: 'quest_pass_season_created',
            data: {
                seasonId: payload.seasonId,
                owner
            }
        });
    };

    const buyPass = async (payload: z.infer<typeof seasonIdSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const seasonRows = await state.adapter.query('SELECT * FROM quest_pass_seasons WHERE season_id = ?', [payload.seasonId]);
        if (seasonRows.length === 0) {
            throw new Error(`Season ${payload.seasonId} does not exist`);
        }

        const season = seasonRows[0];
        if (!season.active) {
            throw new Error('Season is not active');
        }

        assertAssetMatches(payment.asset, season.asset);
        if (!toBigNumber(payment.amount).eq(season.pass_price)) {
            throw new Error(`Pass price is ${season.pass_price} ${season.asset}`);
        }

        const holderRows = await state.adapter.query('SELECT * FROM quest_pass_holders WHERE season_id = ? AND account = ?', [payload.seasonId, account]);
        const purchases = holderRows.length > 0 ? Number(holderRows[0].purchases) + 1 : 1;
        const points = holderRows.length > 0 ? Number(holderRows[0].points) : 0;

        await state.adapter.query(
            `INSERT INTO quest_pass_holders (season_id, account, status, points, purchases, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(season_id, account)
             DO UPDATE SET status = excluded.status, purchases = excluded.purchases, updated_at = excluded.updated_at`,
            [payload.seasonId, account, 'active', points, purchases, new Date(), new Date()]
        );

        await emitContractEvent(state.adapter, name, 'buyPass', payload, {
            action: 'quest_pass_purchased',
            data: {
                seasonId: payload.seasonId,
                account,
                purchases
            }
        });
    };

    const recordProgress = async (payload: z.infer<typeof recordProgressSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const seasonRows = await state.adapter.query('SELECT * FROM quest_pass_seasons WHERE season_id = ?', [payload.seasonId]);
        if (seasonRows.length === 0) {
            throw new Error(`Season ${payload.seasonId} does not exist`);
        }

        const season = seasonRows[0];
        if (season.owner !== sender) {
            throw new Error('Only the season owner can record progress');
        }

        const holderRows = await state.adapter.query('SELECT * FROM quest_pass_holders WHERE season_id = ? AND account = ?', [payload.seasonId, payload.account]);
        if (holderRows.length === 0) {
            throw new Error('Quest pass holder does not exist');
        }

        const holder = holderRows[0];
        const nextPoints = Number(holder.points) + payload.points;
        await state.adapter.query(
            'UPDATE quest_pass_holders SET points = ?, updated_at = ? WHERE season_id = ? AND account = ?',
            [nextPoints, new Date(), payload.seasonId, payload.account]
        );

        await emitContractEvent(state.adapter, name, 'recordProgress', payload, {
            action: 'quest_progress_recorded',
            data: {
                seasonId: payload.seasonId,
                account: payload.account,
                points: payload.points,
                totalPoints: nextPoints,
                sourceId: payload.sourceId || null
            }
        });
    };

    const claimReward = async (payload: z.infer<typeof claimRewardSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const seasonRows = await state.adapter.query('SELECT * FROM quest_pass_seasons WHERE season_id = ?', [payload.seasonId]);
        const holderRows = await state.adapter.query('SELECT * FROM quest_pass_holders WHERE season_id = ? AND account = ?', [payload.seasonId, account]);
        if (seasonRows.length === 0 || holderRows.length === 0) {
            throw new Error('Quest pass holder does not exist for this season');
        }

        const season = seasonRows[0];
        const holder = holderRows[0];
        const tiers = parseJson<Array<{ tierId: string; minPoints: number; rewardType: string; rewardValue: string }>>(season.tiers_json, []);
        const tier = tiers.find(candidate => candidate.tierId === payload.tierId);
        if (!tier) {
            throw new Error('Reward tier does not exist');
        }

        if (Number(holder.points) < tier.minPoints) {
            throw new Error('Account has not reached this reward tier yet');
        }

        const existing = await state.adapter.query(
            'SELECT id FROM quest_pass_claims WHERE season_id = ? AND account = ? AND tier_id = ?',
            [payload.seasonId, account, payload.tierId]
        );
        if (existing.length > 0) {
            throw new Error('Reward tier already claimed');
        }

        await state.adapter.query(
            'INSERT INTO quest_pass_claims (season_id, account, tier_id, created_at) VALUES (?, ?, ?, ?)',
            [payload.seasonId, account, payload.tierId, new Date()]
        );

        await emitContractEvent(state.adapter, name, 'claimReward', payload, {
            action: 'quest_reward_claim_requested',
            data: {
                seasonId: payload.seasonId,
                account,
                tierId: payload.tierId,
                rewardType: tier.rewardType,
                rewardValue: tier.rewardValue
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
            createSeason: action(createSeason, { schema: createSeasonSchema, trigger: 'custom_json' }),
            buyPass: action(buyPass, { schema: seasonIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            recordProgress: action(recordProgress, { schema: recordProgressSchema, trigger: 'custom_json' }),
            claimReward: action(claimReward, { schema: claimRewardSchema, trigger: 'custom_json' })
        }
    });
}
