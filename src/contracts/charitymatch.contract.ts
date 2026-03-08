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

const DEFAULT_NAME = 'charitymatch';

export interface CharityMatchContractOptions {
    name?: string;
}

export function createCharityMatchContract(options: CharityMatchContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createCampaignSchema = z.object({
        campaignId: identifierSchema,
        title: z.string().min(3).max(140),
        beneficiary: z.string().min(3).max(32),
        asset: assetSchema,
        matchCap: amountSchema,
        matchBps: z.number().int().min(0).max(100000),
        closesAt: z.string(),
        metadata: z.record(z.any()).optional()
    });

    const campaignIdSchema = z.object({
        campaignId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS charity_match_campaigns (
                    campaign_id TEXT PRIMARY KEY,
                    sponsor TEXT NOT NULL,
                    title TEXT NOT NULL,
                    beneficiary TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    match_cap TEXT NOT NULL,
                    match_bps INTEGER NOT NULL,
                    total_donations TEXT NOT NULL,
                    matched_total TEXT NOT NULL,
                    status TEXT NOT NULL,
                    closes_at DATETIME NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    closed_at DATETIME
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS charity_match_donations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id TEXT NOT NULL,
                    donor TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createCampaign = async (payload: z.infer<typeof createCampaignSchema>, ctx: any) => {
        const sponsor = requireSender(ctx);
        const existing = await state.adapter.query('SELECT campaign_id FROM charity_match_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (existing.length > 0) {
            throw new Error(`Campaign ${payload.campaignId} already exists`);
        }

        const closesAt = parseDateValue(payload.closesAt);
        if (!closesAt || closesAt <= new Date()) {
            throw new Error('Campaign close time must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO charity_match_campaigns (
                campaign_id, sponsor, title, beneficiary, asset, match_cap, match_bps, total_donations, matched_total, status, closes_at, metadata, created_at, closed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.campaignId,
                sponsor,
                payload.title,
                payload.beneficiary,
                payload.asset,
                payload.matchCap,
                payload.matchBps,
                '0',
                '0',
                'open',
                closesAt,
                JSON.stringify(payload.metadata || {}),
                new Date(),
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createCampaign', payload, {
            action: 'charity_match_campaign_created',
            data: {
                campaignId: payload.campaignId,
                sponsor,
                beneficiary: payload.beneficiary
            }
        });
    };

    const donate = async (payload: z.infer<typeof campaignIdSchema>, ctx: any) => {
        const donor = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM charity_match_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (rows.length === 0) {
            throw new Error(`Campaign ${payload.campaignId} does not exist`);
        }

        const campaign = rows[0];
        if (campaign.status !== 'open') {
            throw new Error('Campaign is not open');
        }

        if ((parseDateValue(campaign.closes_at) || new Date()) <= new Date()) {
            throw new Error('Campaign has already closed');
        }

        assertAssetMatches(payment.asset, campaign.asset);

        const totalDonations = toBigNumber(campaign.total_donations).plus(payment.amount);
        const potentialMatch = totalDonations.multipliedBy(Number(campaign.match_bps)).dividedBy(10000);
        const nextMatched = potentialMatch.gt(campaign.match_cap)
            ? toBigNumber(campaign.match_cap)
            : potentialMatch;

        await state.adapter.query(
            'INSERT INTO charity_match_donations (campaign_id, donor, amount, asset, created_at) VALUES (?, ?, ?, ?, ?)',
            [payload.campaignId, donor, payment.amount, payment.asset, new Date()]
        );
        await state.adapter.query(
            'UPDATE charity_match_campaigns SET total_donations = ?, matched_total = ? WHERE campaign_id = ?',
            [totalDonations.toFixed(), nextMatched.toFixed(), payload.campaignId]
        );

        await emitContractEvent(state.adapter, name, 'donate', payload, {
            action: 'charity_donation_received',
            data: {
                campaignId: payload.campaignId,
                donor,
                amount: payment.amount,
                asset: payment.asset,
                totalDonations: totalDonations.toFixed(),
                matchedTotal: nextMatched.toFixed()
            }
        });
    };

    const closeCampaign = async (payload: z.infer<typeof campaignIdSchema>, ctx: any) => {
        const rows = await state.adapter.query('SELECT * FROM charity_match_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (rows.length === 0) {
            throw new Error(`Campaign ${payload.campaignId} does not exist`);
        }

        const campaign = rows[0];
        if (campaign.status === 'closed') {
            return;
        }

        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== campaign.sponsor) {
                throw new Error('Only the sponsor can close this campaign');
            }
        }

        if ((parseDateValue(campaign.closes_at) || new Date()) > new Date()) {
            throw new Error('Campaign cannot be closed before its close time');
        }

        await state.adapter.query(
            'UPDATE charity_match_campaigns SET status = ?, closed_at = ? WHERE campaign_id = ?',
            ['closed', new Date(), payload.campaignId]
        );

        await emitContractEvent(state.adapter, name, 'closeCampaign', payload, {
            action: 'charity_match_campaign_closed',
            data: {
                campaignId: payload.campaignId,
                beneficiary: campaign.beneficiary,
                totalDonations: campaign.total_donations,
                matchedTotal: campaign.matched_total,
                asset: campaign.asset
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
            createCampaign: action(createCampaign, { schema: createCampaignSchema, trigger: 'custom_json' }),
            donate: action(donate, { schema: campaignIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            closeCampaign: action(closeCampaign, { schema: campaignIdSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
