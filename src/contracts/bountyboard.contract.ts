import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
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

const DEFAULT_NAME = 'bountyboard';

export interface BountyBoardContractOptions {
    name?: string;
}

export function createBountyBoardContract(options: BountyBoardContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createBountySchema = z.object({
        bountyId: identifierSchema,
        title: z.string().min(3).max(140),
        description: z.string().max(1200).optional(),
        deadline: z.string().optional(),
        maxWinners: z.number().int().min(1).max(25).optional(),
        metadata: z.record(z.any()).optional()
    });

    const submitWorkSchema = z.object({
        bountyId: identifierSchema,
        submissionId: identifierSchema,
        url: z.string().url(),
        description: z.string().max(1000).optional()
    });

    const awardSchema = z.object({
        bountyId: identifierSchema,
        submissionId: identifierSchema,
        amount: amountSchema.optional(),
        note: z.string().max(280).optional()
    });

    const closeSchema = z.object({
        bountyId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS bounty_board_bounties (
                    bounty_id TEXT PRIMARY KEY,
                    sponsor TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    reward_pool TEXT NOT NULL,
                    remaining_reward TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    deadline DATETIME,
                    max_winners INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS bounty_board_submissions (
                    submission_id TEXT PRIMARY KEY,
                    bounty_id TEXT NOT NULL,
                    submitter TEXT NOT NULL,
                    url TEXT NOT NULL,
                    description TEXT,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS bounty_board_awards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bounty_id TEXT NOT NULL,
                    submission_id TEXT NOT NULL,
                    winner TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    note TEXT,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createBounty = async (payload: z.infer<typeof createBountySchema>, ctx: any) => {
        const sponsor = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const existing = await state.adapter.query('SELECT bounty_id FROM bounty_board_bounties WHERE bounty_id = ?', [payload.bountyId]);
        if (existing.length > 0) {
            throw new Error(`Bounty ${payload.bountyId} already exists`);
        }

        const deadline = parseDateValue(payload.deadline);
        if (deadline && deadline <= new Date()) {
            throw new Error('Bounty deadline must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO bounty_board_bounties (
                bounty_id, sponsor, title, description, reward_pool, remaining_reward, asset, deadline, max_winners, status, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.bountyId,
                sponsor,
                payload.title,
                payload.description || '',
                payment.amount,
                payment.amount,
                payment.asset,
                deadline,
                payload.maxWinners || 1,
                'open',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createBounty', payload, {
            action: 'bounty_created',
            data: {
                bountyId: payload.bountyId,
                sponsor,
                rewardPool: payment.amount,
                asset: payment.asset
            }
        });
    };

    const submitWork = async (payload: z.infer<typeof submitWorkSchema>, ctx: any) => {
        const submitter = requireSender(ctx);
        const bounties = await state.adapter.query('SELECT * FROM bounty_board_bounties WHERE bounty_id = ?', [payload.bountyId]);
        if (bounties.length === 0) {
            throw new Error(`Bounty ${payload.bountyId} does not exist`);
        }

        const bounty = bounties[0];
        if (bounty.status !== 'open' && bounty.status !== 'partially_awarded') {
            throw new Error('Bounty is not accepting submissions');
        }

        const deadline = parseDateValue(bounty.deadline);
        if (deadline && deadline <= new Date()) {
            throw new Error('Bounty submission window has closed');
        }

        const existing = await state.adapter.query('SELECT submission_id FROM bounty_board_submissions WHERE submission_id = ?', [payload.submissionId]);
        if (existing.length > 0) {
            throw new Error(`Submission ${payload.submissionId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO bounty_board_submissions (
                submission_id, bounty_id, submitter, url, description, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [payload.submissionId, payload.bountyId, submitter, payload.url, payload.description || '', 'submitted', new Date()]
        );

        await emitContractEvent(state.adapter, name, 'submitWork', payload, {
            action: 'bounty_submission_received',
            data: {
                bountyId: payload.bountyId,
                submissionId: payload.submissionId,
                submitter
            }
        });
    };

    const awardBounty = async (payload: z.infer<typeof awardSchema>, ctx: any) => {
        const sponsor = requireSender(ctx);
        const bountyRows = await state.adapter.query('SELECT * FROM bounty_board_bounties WHERE bounty_id = ?', [payload.bountyId]);
        if (bountyRows.length === 0) {
            throw new Error(`Bounty ${payload.bountyId} does not exist`);
        }

        const bounty = bountyRows[0];
        if (bounty.sponsor !== sponsor) {
            throw new Error('Only the bounty sponsor can award submissions');
        }

        if (bounty.status === 'closed') {
            throw new Error('Bounty is closed');
        }

        const submissions = await state.adapter.query('SELECT * FROM bounty_board_submissions WHERE submission_id = ? AND bounty_id = ?', [payload.submissionId, payload.bountyId]);
        if (submissions.length === 0) {
            throw new Error('Submission does not exist for this bounty');
        }

        const submission = submissions[0];
        if (submission.status === 'awarded') {
            throw new Error('Submission already awarded');
        }

        const amount = payload.amount || bounty.remaining_reward;
        if (toBigNumber(amount).gt(bounty.remaining_reward)) {
            throw new Error('Award amount exceeds remaining bounty reward');
        }

        const awardCountRows = await state.adapter.query('SELECT COUNT(*) AS count FROM bounty_board_awards WHERE bounty_id = ?', [payload.bountyId]);
        const awardCount = Number(awardCountRows[0]?.count || 0);
        if (awardCount >= Number(bounty.max_winners)) {
            throw new Error('Maximum winners already reached');
        }

        await state.adapter.query(
            'INSERT INTO bounty_board_awards (bounty_id, submission_id, winner, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [payload.bountyId, payload.submissionId, submission.submitter, amount, payload.note || '', new Date()]
        );
        await state.adapter.query(
            'UPDATE bounty_board_submissions SET status = ? WHERE submission_id = ?',
            ['awarded', payload.submissionId]
        );

        const remainingReward = toBigNumber(bounty.remaining_reward).minus(amount);
        const nextStatus = remainingReward.lte(0) || awardCount + 1 >= Number(bounty.max_winners)
            ? 'closed'
            : 'partially_awarded';

        await state.adapter.query(
            'UPDATE bounty_board_bounties SET remaining_reward = ?, status = ?, updated_at = ? WHERE bounty_id = ?',
            [remainingReward.toFixed(), nextStatus, new Date(), payload.bountyId]
        );

        await emitContractEvent(state.adapter, name, 'awardBounty', payload, {
            action: 'bounty_awarded',
            data: {
                bountyId: payload.bountyId,
                submissionId: payload.submissionId,
                winner: submission.submitter,
                amount,
                asset: bounty.asset,
                remainingReward: remainingReward.toFixed()
            }
        });
    };

    const closeBounty = async (payload: z.infer<typeof closeSchema>, ctx: any) => {
        const bountyRows = await state.adapter.query('SELECT * FROM bounty_board_bounties WHERE bounty_id = ?', [payload.bountyId]);
        if (bountyRows.length === 0) {
            throw new Error(`Bounty ${payload.bountyId} does not exist`);
        }

        const bounty = bountyRows[0];
        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== bounty.sponsor) {
                throw new Error('Only the bounty sponsor can close this bounty');
            }
        }

        await state.adapter.query(
            'UPDATE bounty_board_bounties SET status = ?, updated_at = ? WHERE bounty_id = ?',
            ['closed', new Date(), payload.bountyId]
        );

        await emitContractEvent(state.adapter, name, 'closeBounty', payload, {
            action: 'bounty_closed',
            data: {
                bountyId: payload.bountyId,
                sponsor: bounty.sponsor,
                remainingReward: bounty.remaining_reward,
                asset: bounty.asset
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
            createBounty: action(createBounty, { schema: createBountySchema, trigger: ['transfer', 'recurrent_transfer'] }),
            submitWork: action(submitWork, { schema: submitWorkSchema, trigger: 'custom_json' }),
            awardBounty: action(awardBounty, { schema: awardSchema, trigger: 'custom_json' }),
            closeBounty: action(closeBounty, { schema: closeSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
