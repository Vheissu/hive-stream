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

const DEFAULT_NAME = 'groupbuy';
const PRECISION = 3;

export interface GroupBuyContractOptions {
    name?: string;
    /**
     * Account that receives commitments and refunds rejected ones. Refunds
     * are signed with the app's active key, so this must be the app
     * account. Defaults to the streamer username.
     */
    account?: string;
}

export function createGroupBuyContract(options: GroupBuyContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const state = createContractState({ streamer: null as any });

    const createSchema = z.object({
        groupBuyId: identifierSchema,
        title: z.string().min(3).max(140),
        targetAmount: amountSchema,
        asset: assetSchema,
        deadline: z.string(),
        minParticipants: z.number().int().min(1).max(100000).optional(),
        metadata: z.record(z.string(), z.any()).optional()
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
        if (!deadline || deadline <= blockTimeOf(ctx)) {
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
                blockTimeOf(ctx),
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createGroupBuy', payload, {
            action: 'group_buy_created',
            data: {
                groupBuyId: payload.groupBuyId,
                organizer
            }
        }, blockTimeOf(ctx));
    };

    const commit = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const contributor = requireSender(ctx);
        const payment = getIncomingPayment(ctx);

        // Only money sent to the app account can be refunded from it.
        if (payment.to !== account) {
            throw new Error(`Commitments must be sent to ${account}`);
        }

        // One transaction can carry several transfers; key commitments per operation.
        const commitmentRef = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);
        const duplicate = await state.adapter.query('SELECT id FROM group_buy_commitments WHERE transaction_id = ?', [commitmentRef]);
        if (duplicate.length > 0) {
            return;
        }

        // The payment has already arrived, so every rejection sends it back
        // instead of throwing (which would keep the contributor's money).
        const refund = async (reason: string) => {
            if (!state.streamer) {
                throw new Error('Group buy contract is not attached to a streamer');
            }

            const amount = toBigNumber(payment.amount).decimalPlaces(PRECISION, BigNumber.ROUND_DOWN);
            if (!amount.gt(0)) {
                throw new Error(reason);
            }

            await state.streamer.transferHiveTokens(account, contributor, amount.toFixed(PRECISION), payment.asset, `[Refund] ${reason}`);
            await emitContractEvent(state.adapter, name, 'commit', payload, {
                action: 'group_buy_refunded',
                data: {
                    groupBuyId: payload.groupBuyId,
                    contributor,
                    amount: amount.toFixed(PRECISION),
                    asset: payment.asset,
                    reason,
                    transactionId: commitmentRef
                }
            }, blockTimeOf(ctx));
        };

        const campaigns = await state.adapter.query('SELECT * FROM group_buy_campaigns WHERE group_buy_id = ?', [payload.groupBuyId]);
        if (campaigns.length === 0) {
            await refund(`Group buy ${payload.groupBuyId} does not exist`);
            return;
        }

        const campaign = campaigns[0];
        if (campaign.status !== 'open') {
            await refund('Group buy is not open');
            return;
        }

        const deadline = parseDateValue(campaign.deadline);
        if (deadline && deadline <= blockTimeOf(ctx)) {
            await refund('Group buy deadline has passed');
            return;
        }

        if (payment.asset !== campaign.asset) {
            await refund(`Commitments must be paid in ${campaign.asset}`);
            return;
        }

        const currentAmount = toBigNumber(campaign.current_amount).plus(payment.amount);
        const priorCommitments = await state.adapter.query(
            'SELECT COUNT(*) AS count FROM group_buy_commitments WHERE group_buy_id = ? AND contributor = ? AND withdrawn = ?',
            [payload.groupBuyId, contributor, 0]
        );
        const participantCount = Number(campaign.participant_count) + (Number(priorCommitments[0]?.count || 0) > 0 ? 0 : 1);

        await state.adapter.query(
            'INSERT INTO group_buy_commitments (group_buy_id, contributor, amount, asset, withdrawn, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [payload.groupBuyId, contributor, payment.amount, payment.asset, 0, commitmentRef, blockTimeOf(ctx)]
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
        }, blockTimeOf(ctx));
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

        const deadline = parseDateValue(campaign.deadline) || blockTimeOf(ctx);
        const amountReached = toBigNumber(campaign.current_amount).gte(campaign.target_amount);
        const participantReached = Number(campaign.participant_count) >= Number(campaign.min_participants);
        if (!amountReached && deadline > blockTimeOf(ctx)) {
            throw new Error('Group buy cannot be finalized before the deadline unless the target amount is met');
        }

        const status = amountReached && participantReached
            ? 'successful'
            : 'failed';

        await state.adapter.query(
            'UPDATE group_buy_campaigns SET status = ?, finalized_at = ? WHERE group_buy_id = ?',
            [status, blockTimeOf(ctx), payload.groupBuyId]
        );

        await emitContractEvent(state.adapter, name, 'finalizeGroupBuy', payload, {
            action: 'group_buy_finalized',
            data: {
                groupBuyId: payload.groupBuyId,
                status,
                currentAmount: campaign.current_amount,
                participantCount: campaign.participant_count
            }
        }, blockTimeOf(ctx));
    };

    const withdrawCommitment = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const contributor = requireSender(ctx);
        const campaigns = await state.adapter.query('SELECT * FROM group_buy_campaigns WHERE group_buy_id = ?', [payload.groupBuyId]);
        if (campaigns.length === 0) {
            throw new Error(`Group buy ${payload.groupBuyId} does not exist`);
        }

        const campaign = campaigns[0];
        const deadline = parseDateValue(campaign.deadline);
        const failed = campaign.status === 'failed';
        // Before the deadline an open group buy lets contributors back out;
        // afterwards only a failed one does.
        const earlyExit = campaign.status === 'open' && !!deadline && deadline > blockTimeOf(ctx);
        if (!failed && !earlyExit) {
            throw new Error('Commitments can only be withdrawn before the deadline or after a failed group buy');
        }

        const commitments = await state.adapter.query(
            'SELECT * FROM group_buy_commitments WHERE group_buy_id = ? AND contributor = ? AND withdrawn = ?',
            [payload.groupBuyId, contributor, 0]
        );
        if (commitments.length === 0) {
            throw new Error('No withdrawable commitment found');
        }

        const total = commitments.reduce((sum: any, commitment: any) => sum.plus(commitment.amount), toBigNumber(0));
        const totalAmount = total.toFixed();
        await state.adapter.query(
            'UPDATE group_buy_commitments SET withdrawn = ? WHERE group_buy_id = ? AND contributor = ? AND withdrawn = ?',
            [1, payload.groupBuyId, contributor, 0]
        );

        if (earlyExit) {
            // The money goes back to the contributor, so it must no longer
            // count towards the target or be paid to the organizer later. All
            // of the contributor's commitments were withdrawn, so they stop
            // counting as a participant.
            const currentAmount = toBigNumber(campaign.current_amount).minus(total);
            const participantCount = Math.max(0, Number(campaign.participant_count) - 1);

            await state.adapter.query(
                'UPDATE group_buy_campaigns SET current_amount = ?, participant_count = ? WHERE group_buy_id = ?',
                [(currentAmount.lt(0) ? toBigNumber(0) : currentAmount).toFixed(), participantCount, payload.groupBuyId]
            );
        }

        await emitContractEvent(state.adapter, name, 'withdrawCommitment', payload, {
            action: 'group_buy_withdrawal_requested',
            data: {
                groupBuyId: payload.groupBuyId,
                contributor,
                amount: totalAmount,
                asset: campaign.asset
            }
        }, blockTimeOf(ctx));
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { adapter, streamer } = lifecycle;
                account = resolveContractAccount('createGroupBuyContract', options.account, lifecycle);
                state.adapter = adapter;
                state.streamer = streamer;
                await initialize();
            }
        },
        actions: {
            createGroupBuy: action(createGroupBuy, { schema: createSchema, trigger: 'custom_json' }),
            commit: action(commit, {
                schema: idSchema,
                trigger: ['transfer', 'recurrent_transfer'],
                description: 'Commit funds by sending the group buy asset to the app account; commitments to a missing, closed or expired group buy, or in the wrong asset, are refunded.'
            }),
            finalizeGroupBuy: action(finalizeGroupBuy, { schema: idSchema, trigger: ['custom_json', 'time'] }),
            withdrawCommitment: action(withdrawCommitment, {
                schema: idSchema,
                trigger: 'custom_json',
                description: 'Withdraw your commitments before the deadline (lowering the totals) or after the group buy failed.'
            })
        }
    });
}
