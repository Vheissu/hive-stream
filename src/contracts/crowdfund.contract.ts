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

const DEFAULT_NAME = 'crowdfund';

export interface CrowdfundContractOptions {
    name?: string;
}

export function createCrowdfundContract(options: CrowdfundContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const milestoneSchema = z.object({
        title: z.string().min(1).max(140),
        targetPercent: z.number().min(1).max(100)
    });

    const createCampaignSchema = z.object({
        campaignId: identifierSchema,
        title: z.string().min(3).max(140),
        description: z.string().max(1000).optional(),
        targetAmount: amountSchema,
        asset: assetSchema,
        deadline: z.string(),
        beneficiary: z.string().min(3).max(32).optional(),
        milestones: z.array(milestoneSchema).max(10).optional(),
        metadata: z.record(z.any()).optional()
    });

    const campaignIdSchema = z.object({
        campaignId: identifierSchema
    });

    const releaseMilestoneSchema = z.object({
        campaignId: identifierSchema,
        milestoneIndex: z.number().int().min(0)
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS crowdfund_campaigns (
                    campaign_id TEXT PRIMARY KEY,
                    creator TEXT NOT NULL,
                    beneficiary TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    target_amount TEXT NOT NULL,
                    current_amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    deadline DATETIME NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    finalized_at DATETIME
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS crowdfund_contributions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id TEXT NOT NULL,
                    contributor TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    transaction_id TEXT NOT NULL,
                    refunded INTEGER NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS crowdfund_milestones (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id TEXT NOT NULL,
                    milestone_index INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    target_percent REAL NOT NULL,
                    status TEXT NOT NULL,
                    released_amount TEXT,
                    released_at DATETIME,
                    created_at DATETIME NOT NULL,
                    UNIQUE(campaign_id, milestone_index)
                )
            `
        ]);
    };

    const createCampaign = async (payload: z.infer<typeof createCampaignSchema>, ctx: any) => {
        const creator = requireSender(ctx);
        const existing = await state.adapter.query('SELECT campaign_id FROM crowdfund_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (existing.length > 0) {
            throw new Error(`Campaign ${payload.campaignId} already exists`);
        }

        const deadline = parseDateValue(payload.deadline);
        if (!deadline || deadline <= new Date()) {
            throw new Error('Campaign deadline must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO crowdfund_campaigns (
                campaign_id, creator, beneficiary, title, description, target_amount, current_amount, asset, deadline, status, metadata, created_at, finalized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.campaignId,
                creator,
                payload.beneficiary || creator,
                payload.title,
                payload.description || '',
                payload.targetAmount,
                '0',
                payload.asset,
                deadline,
                'open',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                null
            ]
        );

        const milestones = payload.milestones || [];
        if (milestones.length > 0) {
            const totalPercent = milestones.reduce((sum, m) => sum + m.targetPercent, 0);
            if (totalPercent > 100) {
                throw new Error('Milestone percentages cannot exceed 100%');
            }
        }
        for (let index = 0; index < milestones.length; index++) {
            const milestone = milestones[index];
            await state.adapter.query(
                `INSERT INTO crowdfund_milestones (
                    campaign_id, milestone_index, title, target_percent, status, released_amount, released_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [payload.campaignId, index, milestone.title, milestone.targetPercent, 'pending', null, null, new Date()]
            );
        }

        await emitContractEvent(state.adapter, name, 'createCampaign', payload, {
            action: 'crowdfund_campaign_created',
            data: {
                campaignId: payload.campaignId,
                creator
            }
        });
    };

    const contribute = async (payload: z.infer<typeof campaignIdSchema>, ctx: any) => {
        const contributor = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM crowdfund_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (rows.length === 0) {
            throw new Error(`Campaign ${payload.campaignId} does not exist`);
        }

        const campaign = rows[0];
        const deadline = parseDateValue(campaign.deadline) || new Date();
        if (campaign.status !== 'open' && campaign.status !== 'target_met') {
            throw new Error('Campaign is not accepting contributions');
        }

        if (deadline <= new Date()) {
            throw new Error('Campaign deadline has passed');
        }

        assertAssetMatches(payment.asset, campaign.asset);

        const currentAmount = toBigNumber(campaign.current_amount).plus(payment.amount);
        const nextStatus = currentAmount.gte(campaign.target_amount)
            ? 'target_met'
            : campaign.status;

        await state.adapter.query(
            'INSERT INTO crowdfund_contributions (campaign_id, contributor, amount, asset, transaction_id, refunded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [payload.campaignId, contributor, payment.amount, payment.asset, ctx.transaction.id, 0, new Date()]
        );

        await state.adapter.query(
            'UPDATE crowdfund_campaigns SET current_amount = ?, status = ? WHERE campaign_id = ?',
            [currentAmount.toFixed(), nextStatus, payload.campaignId]
        );

        await emitContractEvent(state.adapter, name, 'contribute', payload, {
            action: 'crowdfund_contribution_received',
            data: {
                campaignId: payload.campaignId,
                contributor,
                amount: payment.amount,
                asset: payment.asset,
                currentAmount: currentAmount.toFixed()
            }
        });
    };

    const finalizeCampaign = async (payload: z.infer<typeof campaignIdSchema>, ctx: any) => {
        const rows = await state.adapter.query('SELECT * FROM crowdfund_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (rows.length === 0) {
            throw new Error(`Campaign ${payload.campaignId} does not exist`);
        }

        const campaign = rows[0];
        if (campaign.status === 'funded' || campaign.status === 'failed') {
            return;
        }

        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== campaign.creator) {
                throw new Error('Only the campaign creator can finalize this campaign');
            }
        }

        const deadline = parseDateValue(campaign.deadline) || new Date();
        const goalReached = toBigNumber(campaign.current_amount).gte(campaign.target_amount);
        if (!goalReached && deadline > new Date()) {
            throw new Error('Campaign cannot be finalized before the deadline unless the target is met');
        }

        const status = goalReached ? 'funded' : 'failed';
        await state.adapter.query(
            'UPDATE crowdfund_campaigns SET status = ?, finalized_at = ? WHERE campaign_id = ?',
            [status, new Date(), payload.campaignId]
        );

        await emitContractEvent(state.adapter, name, 'finalizeCampaign', payload, {
            action: 'crowdfund_campaign_finalized',
            data: {
                campaignId: payload.campaignId,
                status,
                beneficiary: campaign.beneficiary,
                amount: campaign.current_amount,
                asset: campaign.asset
            }
        });
    };

    const releaseMilestone = async (payload: z.infer<typeof releaseMilestoneSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const campaigns = await state.adapter.query('SELECT * FROM crowdfund_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (campaigns.length === 0) {
            throw new Error(`Campaign ${payload.campaignId} does not exist`);
        }

        const campaign = campaigns[0];
        if (campaign.creator !== sender) {
            throw new Error('Only the campaign creator can release milestones');
        }

        if (campaign.status !== 'funded') {
            throw new Error('Campaign must be funded before releasing milestones');
        }

        const rows = await state.adapter.query(
            'SELECT * FROM crowdfund_milestones WHERE campaign_id = ? AND milestone_index = ?',
            [payload.campaignId, payload.milestoneIndex]
        );
        if (rows.length === 0) {
            throw new Error('Milestone does not exist');
        }

        const milestone = rows[0];
        if (milestone.status === 'released') {
            throw new Error('Milestone already released');
        }

        // Guard against total milestone releases exceeding campaign funds
        const allMilestones = await state.adapter.query(
            'SELECT * FROM crowdfund_milestones WHERE campaign_id = ?',
            [payload.campaignId]
        );
        const totalReleasedPercent = allMilestones
            .filter((m: any) => m.status === 'released')
            .reduce((sum: number, m: any) => sum + Number(m.target_percent), 0);
        if (totalReleasedPercent + Number(milestone.target_percent) > 100) {
            throw new Error('Cannot release milestone: total released would exceed 100% of campaign funds');
        }

        const releasedAmount = toBigNumber(campaign.current_amount)
            .multipliedBy(milestone.target_percent)
            .dividedBy(100)
            .toFixed();

        await state.adapter.query(
            'UPDATE crowdfund_milestones SET status = ?, released_amount = ?, released_at = ? WHERE campaign_id = ? AND milestone_index = ?',
            ['released', releasedAmount, new Date(), payload.campaignId, payload.milestoneIndex]
        );

        // Transfer funds to the beneficiary
        if ((state as any).streamer) {
            await (state as any).streamer.transferHiveTokens(
                campaign.creator,
                campaign.beneficiary,
                toBigNumber(releasedAmount).toFixed(3),
                campaign.asset,
                `Crowdfund milestone release: ${payload.campaignId} #${payload.milestoneIndex}`
            );
        }

        await emitContractEvent(state.adapter, name, 'releaseMilestone', payload, {
            action: 'crowdfund_milestone_released',
            data: {
                campaignId: payload.campaignId,
                milestoneIndex: payload.milestoneIndex,
                releasedAmount,
                beneficiary: campaign.beneficiary
            }
        });
    };

    const refundContribution = async (payload: z.infer<typeof campaignIdSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const campaigns = await state.adapter.query('SELECT * FROM crowdfund_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (campaigns.length === 0) {
            throw new Error(`Campaign ${payload.campaignId} does not exist`);
        }

        const campaign = campaigns[0];
        if (campaign.status !== 'failed') {
            throw new Error('Refunds are only available for failed campaigns');
        }

        const contributions = await state.adapter.query(
            'SELECT * FROM crowdfund_contributions WHERE campaign_id = ? AND contributor = ? AND refunded = ?',
            [payload.campaignId, sender, 0]
        );
        if (contributions.length === 0) {
            throw new Error('No refundable contribution found');
        }

        const totalRefund = contributions.reduce((sum: any, contribution: any) => sum.plus(contribution.amount), toBigNumber(0)).toFixed();
        await state.adapter.query(
            'UPDATE crowdfund_contributions SET refunded = ? WHERE campaign_id = ? AND contributor = ?',
            [1, payload.campaignId, sender]
        );

        // Transfer refund to the contributor
        if ((state as any).streamer) {
            await (state as any).streamer.transferHiveTokens(
                campaign.creator,
                sender,
                toBigNumber(totalRefund).toFixed(3),
                campaign.asset,
                `Crowdfund refund: ${payload.campaignId}`
            );
        }

        await emitContractEvent(state.adapter, name, 'refundContribution', payload, {
            action: 'crowdfund_refund_requested',
            data: {
                campaignId: payload.campaignId,
                contributor: sender,
                refundAmount: totalRefund,
                asset: campaign.asset
            }
        });
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ adapter, streamer }) => {
                state.adapter = adapter;
                (state as any).streamer = streamer;
                await initialize();
            }
        },
        actions: {
            createCampaign: action(createCampaign, { schema: createCampaignSchema, trigger: 'custom_json' }),
            contribute: action(contribute, { schema: campaignIdSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            finalizeCampaign: action(finalizeCampaign, { schema: campaignIdSchema, trigger: ['custom_json', 'time'] }),
            releaseMilestone: action(releaseMilestone, { schema: releaseMilestoneSchema, trigger: 'custom_json' }),
            refundContribution: action(refundContribution, { schema: campaignIdSchema, trigger: 'custom_json' })
        }
    });
}
