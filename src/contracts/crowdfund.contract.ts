import BigNumber from '../bignumber';
import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    createContractState,
    emitContractEvent,
    getIncomingPayment,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender,
    resolveContractAccount,
    toBigNumber
} from './helpers';
import { operationRecordId } from '../types/hive-stream';

const DEFAULT_NAME = 'crowdfund';
const PRECISION = 3;

// crowdfund_contributions.refunded
const NOT_REFUNDED = 0;
const REFUNDED = 1;
const REFUNDING = 2;
const REFUND_FAILED = 3;

export interface CrowdfundContractOptions {
    name?: string;
    /**
     * Account that receives contributions and pays milestone releases and
     * refunds. Payouts are signed with the app's active key, so this must be
     * the app account. Defaults to the streamer username.
     */
    account?: string;
}

export function createCrowdfundContract(options: CrowdfundContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const state = createContractState({ streamer: null as any });

    const transfer = async (to: string, amount: string, asset: string, memo: string) => {
        if (!state.streamer) {
            throw new Error('Crowdfund contract is not attached to a streamer');
        }

        await state.streamer.transferHiveTokens(account, to, amount, asset, memo);
    };

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
        metadata: z.record(z.string(), z.any()).optional()
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
        if (!deadline || deadline <= blockTimeOf(ctx)) {
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
                blockTimeOf(ctx),
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
                [payload.campaignId, index, milestone.title, milestone.targetPercent, 'pending', null, null, blockTimeOf(ctx)]
            );
        }

        await emitContractEvent(state.adapter, name, 'createCampaign', payload, {
            action: 'crowdfund_campaign_created',
            data: {
                campaignId: payload.campaignId,
                creator
            }
        }, blockTimeOf(ctx));
    };

    const contribute = async (payload: z.infer<typeof campaignIdSchema>, ctx: any) => {
        const contributor = requireSender(ctx);
        const payment = getIncomingPayment(ctx);

        // Only money sent to the app account can be refunded from it.
        if (payment.to !== account) {
            throw new Error(`Contributions must be sent to ${account}`);
        }

        // One transaction can carry several transfers; key contributions per operation.
        const contributionRef = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);
        const duplicate = await state.adapter.query(
            'SELECT id FROM crowdfund_contributions WHERE transaction_id = ?',
            [contributionRef]
        );
        if (duplicate.length > 0) {
            return;
        }

        // The payment has already arrived, so every rejection sends it back
        // instead of throwing (which would keep the contributor's money).
        const refund = async (reason: string) => {
            const amount = toBigNumber(payment.amount).decimalPlaces(PRECISION, BigNumber.ROUND_DOWN);
            if (!amount.gt(0)) {
                throw new Error(reason);
            }

            await transfer(contributor, amount.toFixed(PRECISION), payment.asset, `[Refund] ${reason}`);
            await emitContractEvent(state.adapter, name, 'contribute', payload, {
                action: 'crowdfund_refunded',
                data: {
                    campaignId: payload.campaignId,
                    contributor,
                    amount: amount.toFixed(PRECISION),
                    asset: payment.asset,
                    reason,
                    transactionId: contributionRef
                }
            }, blockTimeOf(ctx));
        };

        const rows = await state.adapter.query('SELECT * FROM crowdfund_campaigns WHERE campaign_id = ?', [payload.campaignId]);
        if (rows.length === 0) {
            await refund(`Campaign ${payload.campaignId} does not exist`);
            return;
        }

        const campaign = rows[0];
        if (campaign.status !== 'open' && campaign.status !== 'target_met') {
            await refund('Campaign is not accepting contributions');
            return;
        }

        const deadline = parseDateValue(campaign.deadline) || blockTimeOf(ctx);
        if (deadline <= blockTimeOf(ctx)) {
            await refund('Campaign deadline has passed');
            return;
        }

        if (payment.asset !== campaign.asset) {
            await refund(`Contributions must be paid in ${campaign.asset}`);
            return;
        }

        const currentAmount = toBigNumber(campaign.current_amount).plus(payment.amount);
        const nextStatus = currentAmount.gte(campaign.target_amount)
            ? 'target_met'
            : campaign.status;

        await state.adapter.query(
            'INSERT INTO crowdfund_contributions (campaign_id, contributor, amount, asset, transaction_id, refunded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [payload.campaignId, contributor, payment.amount, payment.asset, contributionRef, NOT_REFUNDED, blockTimeOf(ctx)]
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
        }, blockTimeOf(ctx));
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

        const deadline = parseDateValue(campaign.deadline) || blockTimeOf(ctx);
        const goalReached = toBigNumber(campaign.current_amount).gte(campaign.target_amount);
        if (!goalReached && deadline > blockTimeOf(ctx)) {
            throw new Error('Campaign cannot be finalized before the deadline unless the target is met');
        }

        const status = goalReached ? 'funded' : 'failed';
        await state.adapter.query(
            'UPDATE crowdfund_campaigns SET status = ?, finalized_at = ? WHERE campaign_id = ?',
            [status, blockTimeOf(ctx), payload.campaignId]
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
        }, blockTimeOf(ctx));
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
        if (milestone.status === 'released' || milestone.status === 'releasing') {
            throw new Error('Milestone already released');
        }

        // Guard against total milestone releases exceeding campaign funds.
        // Releases in flight or awaiting a retry are already committed.
        const allMilestones = await state.adapter.query(
            'SELECT * FROM crowdfund_milestones WHERE campaign_id = ?',
            [payload.campaignId]
        );
        const totalReleasedPercent = allMilestones
            .filter((m: any) => m.milestone_index !== milestone.milestone_index)
            .filter((m: any) => m.status === 'released' || m.status === 'releasing' || m.status === 'release_failed')
            .reduce((sum: number, m: any) => sum + Number(m.target_percent), 0);
        if (totalReleasedPercent + Number(milestone.target_percent) > 100) {
            throw new Error('Cannot release milestone: total released would exceed 100% of campaign funds');
        }

        // Pay whole units of the asset's precision, never rounding up.
        const releasedAmount = toBigNumber(campaign.current_amount)
            .multipliedBy(milestone.target_percent)
            .dividedBy(100)
            .decimalPlaces(PRECISION, BigNumber.ROUND_DOWN)
            .toFixed(PRECISION);

        // Claim the milestone before broadcasting; it is only 'released' once the transfer succeeds.
        await state.adapter.query(
            'UPDATE crowdfund_milestones SET status = ?, released_amount = ? WHERE campaign_id = ? AND milestone_index = ? AND status IN (?, ?)',
            ['releasing', releasedAmount, payload.campaignId, payload.milestoneIndex, 'pending', 'release_failed']
        );

        try {
            await transfer(
                campaign.beneficiary,
                releasedAmount,
                campaign.asset,
                `Crowdfund milestone release: ${payload.campaignId} #${payload.milestoneIndex}`
            );
        } catch (error) {
            await state.adapter.query(
                'UPDATE crowdfund_milestones SET status = ? WHERE campaign_id = ? AND milestone_index = ?',
                ['release_failed', payload.campaignId, payload.milestoneIndex]
            );
            await emitContractEvent(state.adapter, name, 'releaseMilestone', payload, {
                action: 'crowdfund_milestone_release_failed',
                data: {
                    campaignId: payload.campaignId,
                    milestoneIndex: payload.milestoneIndex,
                    releasedAmount,
                    beneficiary: campaign.beneficiary,
                    error: error instanceof Error ? error.message : String(error)
                }
            }, blockTimeOf(ctx));
            throw error;
        }

        await state.adapter.query(
            'UPDATE crowdfund_milestones SET status = ?, released_at = ? WHERE campaign_id = ? AND milestone_index = ?',
            ['released', blockTimeOf(ctx), payload.campaignId, payload.milestoneIndex]
        );

        await emitContractEvent(state.adapter, name, 'releaseMilestone', payload, {
            action: 'crowdfund_milestone_released',
            data: {
                campaignId: payload.campaignId,
                milestoneIndex: payload.milestoneIndex,
                releasedAmount,
                beneficiary: campaign.beneficiary
            }
        }, blockTimeOf(ctx));
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

        // Claim every outstanding contribution (including refunds whose
        // broadcast failed earlier) before sending anything.
        await state.adapter.query(
            'UPDATE crowdfund_contributions SET refunded = ? WHERE campaign_id = ? AND contributor = ? AND refunded IN (?, ?)',
            [REFUNDING, payload.campaignId, sender, NOT_REFUNDED, REFUND_FAILED]
        );
        const contributions = await state.adapter.query(
            'SELECT * FROM crowdfund_contributions WHERE campaign_id = ? AND contributor = ? AND refunded = ?',
            [payload.campaignId, sender, REFUNDING]
        );
        if (contributions.length === 0) {
            throw new Error('No refundable contribution found');
        }

        const totalRefund = contributions
            .reduce((sum: any, contribution: any) => sum.plus(contribution.amount), toBigNumber(0))
            .decimalPlaces(PRECISION, BigNumber.ROUND_DOWN)
            .toFixed(PRECISION);

        try {
            await transfer(sender, totalRefund, campaign.asset, `Crowdfund refund: ${payload.campaignId}`);
        } catch (error) {
            await state.adapter.query(
                'UPDATE crowdfund_contributions SET refunded = ? WHERE campaign_id = ? AND contributor = ? AND refunded = ?',
                [REFUND_FAILED, payload.campaignId, sender, REFUNDING]
            );
            await emitContractEvent(state.adapter, name, 'refundContribution', payload, {
                action: 'crowdfund_refund_failed',
                data: {
                    campaignId: payload.campaignId,
                    contributor: sender,
                    refundAmount: totalRefund,
                    asset: campaign.asset,
                    error: error instanceof Error ? error.message : String(error)
                }
            }, blockTimeOf(ctx));
            throw error;
        }

        await state.adapter.query(
            'UPDATE crowdfund_contributions SET refunded = ? WHERE campaign_id = ? AND contributor = ? AND refunded = ?',
            [REFUNDED, payload.campaignId, sender, REFUNDING]
        );

        await emitContractEvent(state.adapter, name, 'refundContribution', payload, {
            action: 'crowdfund_refund_requested',
            data: {
                campaignId: payload.campaignId,
                contributor: sender,
                refundAmount: totalRefund,
                asset: campaign.asset
            }
        }, blockTimeOf(ctx));
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { adapter, streamer } = lifecycle;
                account = resolveContractAccount('createCrowdfundContract', options.account, lifecycle);
                state.adapter = adapter;
                state.streamer = streamer;
                await initialize();
            }
        },
        actions: {
            createCampaign: action(createCampaign, { schema: createCampaignSchema, trigger: 'custom_json' }),
            contribute: action(contribute, {
                schema: campaignIdSchema,
                trigger: ['transfer', 'recurrent_transfer'],
                description: 'Contribute by sending the campaign asset to the app account; contributions to a missing, closed or expired campaign, or in the wrong asset, are refunded.'
            }),
            finalizeCampaign: action(finalizeCampaign, { schema: campaignIdSchema, trigger: ['custom_json', 'time'] }),
            releaseMilestone: action(releaseMilestone, {
                schema: releaseMilestoneSchema,
                trigger: 'custom_json',
                description: 'Creator releases a milestone\'s share of a funded campaign to the beneficiary from the app account; a failed broadcast can be retried by calling it again.'
            }),
            refundContribution: action(refundContribution, {
                schema: campaignIdSchema,
                trigger: 'custom_json',
                description: 'Refund your contributions to a failed campaign from the app account; a failed broadcast can be retried by calling it again.'
            })
        }
    });
}
