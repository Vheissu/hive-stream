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

const DEFAULT_NAME = 'groupbuy';

export interface GroupBuyContractOptions {
    name?: string;
}

export function createGroupBuyContract(options: GroupBuyContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createSchema = z.object({
        groupBuyId: identifierSchema,
        title: z.string().min(3).max(140),
        targetAmount: amountSchema,
        asset: assetSchema,
        deadline: z.string(),
        minParticipants: z.number().int().min(1).max(100000).optional(),
        metadata: z.record(z.any()).optional()
    });

    const idSchema = z.object({
        groupBuyId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS group_buy_campaigns (
                    group_buy_id TEXT PRIMARY KEY,
                    organizer TEXT NOT NULL,
                    title TEXT NOT NULL,
                    target_amount TEXT NOT NULL,
                    current_amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    deadline DATETIME NOT NULL,
                    min_participants INTEGER NOT NULL,
                    participant_count INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    finalized_at DATETIME
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS group_buy_commitments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_buy_id TEXT NOT NULL,
                    contributor TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    withdrawn INTEGER NOT NULL,
                    transaction_id TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createGroupBuy = async (payload: z.infer<typeof createSchema>, ctx: any) => {
        const organizer = requireSender(ctx);
        const existing = await state.adapter.query('SELECT group_buy_id FROM group_buy_campaigns WHERE group_buy_id = ?', [payload.groupBuyId]);
        if (existing.length > 0) {
            throw new Error(`Group buy ${payload.groupBuyId} already exists`);
        }

        const deadline = parseDateValue(payload.deadline);
        if (!deadline || deadline <= new Date()) {
            throw new Error('Group buy deadline must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO group_buy_campaigns (
                group_buy_id, organizer, title, target_amount, current_amount, asset, deadline, min_participants, participant_count, status, metadata, created_at, finalized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.groupBuyId,
                organizer,
                payload.title,
                payload.targetAmount,
                '0',
                payload.asset,
                deadline,
                payload.minParticipants || 1,
                0,
                'open',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createGroupBuy', payload, {
            action: 'group_buy_created',
            data: {
                groupBuyId: payload.groupBuyId,
                organizer
            }
        });
    };

    const commit = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const contributor = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const campaigns = await state.adapter.query('SELECT * FROM group_buy_campaigns WHERE group_buy_id = ?', [payload.groupBuyId]);
        if (campaigns.length === 0) {
            throw new Error(`Group buy ${payload.groupBuyId} does not exist`);
        }

        const campaign = campaigns[0];
        if (campaign.status !== 'open') {
            throw new Error('Group buy is not open');
        }

        assertAssetMatches(payment.asset, campaign.asset);

        const currentAmount = toBigNumber(campaign.current_amount).plus(payment.amount);
        const priorCommitments = await state.adapter.query(
            'SELECT COUNT(*) AS count FROM group_buy_commitments WHERE group_buy_id = ? AND contributor = ?',
            [payload.groupBuyId, contributor]
        );
        const participantCount = Number(campaign.participant_count) + (Number(priorCommitments[0]?.count || 0) > 0 ? 0 : 1);

        await state.adapter.query(
            'INSERT INTO group_buy_commitments (group_buy_id, contributor, amount, asset, withdrawn, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [payload.groupBuyId, contributor, payment.amount, payment.asset, 0, ctx.transaction.id, new Date()]
        );

        await state.adapter.query(
            'UPDATE group_buy_campaigns SET current_amount = ?, participant_count = ? WHERE group_buy_id = ?',
            [currentAmount.toFixed(), participantCount, payload.groupBuyId]
        );

        await emitContractEvent(state.adapter, name, 'commit', payload, {
            action: 'group_buy_commitment_received',
            data: {
                groupBuyId: payload.groupBuyId,
                contributor,
                amount: payment.amount,
                asset: payment.asset,
                currentAmount: currentAmount.toFixed(),
                participantCount
            }
        });
    };

    const finalizeGroupBuy = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const campaigns = await state.adapter.query('SELECT * FROM group_buy_campaigns WHERE group_buy_id = ?', [payload.groupBuyId]);
        if (campaigns.length === 0) {
            throw new Error(`Group buy ${payload.groupBuyId} does not exist`);
        }

        const campaign = campaigns[0];
        if (campaign.status === 'successful' || campaign.status === 'failed') {
            return;
        }

        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== campaign.organizer) {
                throw new Error('Only the organizer can finalize this group buy');
            }
        }

        const deadline = parseDateValue(campaign.deadline) || new Date();
        const amountReached = toBigNumber(campaign.current_amount).gte(campaign.target_amount);
        const participantReached = Number(campaign.participant_count) >= Number(campaign.min_participants);
        if (!amountReached && deadline > new Date()) {
            throw new Error('Group buy cannot be finalized before the deadline unless the target amount is met');
        }

        const status = amountReached && participantReached
            ? 'successful'
            : 'failed';

        await state.adapter.query(
            'UPDATE group_buy_campaigns SET status = ?, finalized_at = ? WHERE group_buy_id = ?',
            [status, new Date(), payload.groupBuyId]
        );

        await emitContractEvent(state.adapter, name, 'finalizeGroupBuy', payload, {
            action: 'group_buy_finalized',
            data: {
                groupBuyId: payload.groupBuyId,
                status,
                currentAmount: campaign.current_amount,
                participantCount: campaign.participant_count
            }
        });
    };

    const withdrawCommitment = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const contributor = requireSender(ctx);
        const campaigns = await state.adapter.query('SELECT * FROM group_buy_campaigns WHERE group_buy_id = ?', [payload.groupBuyId]);
        if (campaigns.length === 0) {
            throw new Error(`Group buy ${payload.groupBuyId} does not exist`);
        }

        const campaign = campaigns[0];
        const deadline = parseDateValue(campaign.deadline);
        if (campaign.status !== 'failed' && (!deadline || deadline <= new Date())) {
            throw new Error('Commitments can only be withdrawn after a failed group buy');
        }

        const commitments = await state.adapter.query(
            'SELECT * FROM group_buy_commitments WHERE group_buy_id = ? AND contributor = ? AND withdrawn = ?',
            [payload.groupBuyId, contributor, 0]
        );
        if (commitments.length === 0) {
            throw new Error('No withdrawable commitment found');
        }

        const totalAmount = commitments.reduce((sum: any, commitment: any) => sum.plus(commitment.amount), toBigNumber(0)).toFixed();
        await state.adapter.query(
            'UPDATE group_buy_commitments SET withdrawn = ? WHERE group_buy_id = ? AND contributor = ?',
            [1, payload.groupBuyId, contributor]
        );

        await emitContractEvent(state.adapter, name, 'withdrawCommitment', payload, {
            action: 'group_buy_withdrawal_requested',
            data: {
                groupBuyId: payload.groupBuyId,
                contributor,
                amount: totalAmount,
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
            createGroupBuy: action(createGroupBuy, { schema: createSchema, trigger: 'custom_json' }),
            commit: action(commit, { schema: idSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            finalizeGroupBuy: action(finalizeGroupBuy, { schema: idSchema, trigger: ['custom_json', 'time'] }),
            withdrawCommitment: action(withdrawCommitment, { schema: idSchema, trigger: 'custom_json' })
        }
    });
}
