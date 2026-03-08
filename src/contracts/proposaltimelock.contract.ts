import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    createContractState,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    parseJson,
    requireSender,
    uniqueItems
} from './helpers';

const DEFAULT_NAME = 'proposaltimelock';

export interface ProposalTimelockContractOptions {
    name?: string;
}

export function createProposalTimelockContract(options: ProposalTimelockContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createQueueSchema = z.object({
        queueId: identifierSchema,
        title: z.string().min(3).max(140),
        approvers: z.array(z.string().min(3).max(32)).min(1).max(25),
        threshold: z.number().int().min(1).max(25),
        minDelayHours: z.number().int().min(1).max(24 * 365),
        metadata: z.record(z.any()).optional()
    });

    const createProposalSchema = z.object({
        queueId: identifierSchema,
        proposalId: identifierSchema,
        title: z.string().min(3).max(140),
        actionType: z.string().min(1).max(60),
        actionPayload: z.record(z.any()),
        note: z.string().max(280).optional()
    });

    const proposalIdSchema = z.object({
        proposalId: identifierSchema
    });

    const executeSchema = z.object({
        proposalId: identifierSchema,
        executionRef: z.string().max(120).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS timelock_queues (
                    queue_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    approvers_json TEXT NOT NULL,
                    threshold INTEGER NOT NULL,
                    min_delay_hours INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS timelock_proposals (
                    proposal_id TEXT PRIMARY KEY,
                    queue_id TEXT NOT NULL,
                    proposer TEXT NOT NULL,
                    title TEXT NOT NULL,
                    action_type TEXT NOT NULL,
                    action_payload TEXT NOT NULL,
                    note TEXT,
                    approvals_count INTEGER NOT NULL,
                    ready_at DATETIME NOT NULL,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    executed_at DATETIME,
                    execution_ref TEXT
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS timelock_approvals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    proposal_id TEXT NOT NULL,
                    approver TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    UNIQUE(proposal_id, approver)
                )
            `
        ]);
    };

    const createQueue = async (payload: z.infer<typeof createQueueSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const approvers = uniqueItems([owner, ...payload.approvers]);
        if (payload.threshold > approvers.length) {
            throw new Error('Threshold cannot exceed the number of approvers');
        }

        const existing = await state.adapter.query('SELECT queue_id FROM timelock_queues WHERE queue_id = ?', [payload.queueId]);
        if (existing.length > 0) {
            throw new Error(`Queue ${payload.queueId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO timelock_queues (
                queue_id, owner, title, approvers_json, threshold, min_delay_hours, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.queueId,
                owner,
                payload.title,
                JSON.stringify(approvers),
                payload.threshold,
                payload.minDelayHours,
                JSON.stringify(payload.metadata || {}),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createQueue', payload, {
            action: 'timelock_queue_created',
            data: {
                queueId: payload.queueId,
                owner,
                threshold: payload.threshold
            }
        });
    };

    const createProposal = async (payload: z.infer<typeof createProposalSchema>, ctx: any) => {
        const proposer = requireSender(ctx);
        const queueRows = await state.adapter.query('SELECT * FROM timelock_queues WHERE queue_id = ?', [payload.queueId]);
        if (queueRows.length === 0) {
            throw new Error(`Queue ${payload.queueId} does not exist`);
        }

        const queue = queueRows[0];
        const approvers = parseJson<string[]>(queue.approvers_json, []);
        if (!approvers.includes(proposer)) {
            throw new Error('Only queue approvers can create proposals');
        }

        const existing = await state.adapter.query('SELECT proposal_id FROM timelock_proposals WHERE proposal_id = ?', [payload.proposalId]);
        if (existing.length > 0) {
            throw new Error(`Proposal ${payload.proposalId} already exists`);
        }

        const readyAt = new Date(Date.now() + Number(queue.min_delay_hours) * 60 * 60 * 1000);
        await state.adapter.query(
            `INSERT INTO timelock_proposals (
                proposal_id, queue_id, proposer, title, action_type, action_payload, note, approvals_count, ready_at, status, created_at, executed_at, execution_ref
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.proposalId,
                payload.queueId,
                proposer,
                payload.title,
                payload.actionType,
                JSON.stringify(payload.actionPayload),
                payload.note || '',
                0,
                readyAt,
                'pending',
                new Date(),
                null,
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createProposal', payload, {
            action: 'timelock_proposal_created',
            data: {
                proposalId: payload.proposalId,
                queueId: payload.queueId,
                proposer,
                readyAt
            }
        });
    };

    const approveProposal = async (payload: z.infer<typeof proposalIdSchema>, ctx: any) => {
        const approver = requireSender(ctx);
        const proposalRows = await state.adapter.query('SELECT * FROM timelock_proposals WHERE proposal_id = ?', [payload.proposalId]);
        if (proposalRows.length === 0) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        const proposal = proposalRows[0];
        if (proposal.status === 'cancelled' || proposal.status === 'executed') {
            throw new Error('Proposal is no longer active');
        }

        const queueRows = await state.adapter.query('SELECT * FROM timelock_queues WHERE queue_id = ?', [proposal.queue_id]);
        const queue = queueRows[0];
        const approvers = parseJson<string[]>(queue.approvers_json, []);
        if (!approvers.includes(approver)) {
            throw new Error('Only queue approvers can approve proposals');
        }

        await state.adapter.query(
            'INSERT INTO timelock_approvals (proposal_id, approver, created_at) VALUES (?, ?, ?)',
            [payload.proposalId, approver, new Date()]
        );
        const counts = await state.adapter.query('SELECT COUNT(*) AS count FROM timelock_approvals WHERE proposal_id = ?', [payload.proposalId]);
        const approvalsCount = Number(counts[0]?.count || 0);
        const status = approvalsCount >= Number(queue.threshold) ? 'approved' : 'pending';

        await state.adapter.query(
            'UPDATE timelock_proposals SET approvals_count = ?, status = ? WHERE proposal_id = ?',
            [approvalsCount, status, payload.proposalId]
        );

        await emitContractEvent(state.adapter, name, 'approveProposal', payload, {
            action: status === 'approved' ? 'timelock_proposal_approved' : 'timelock_proposal_partially_approved',
            data: {
                proposalId: payload.proposalId,
                approver,
                approvalsCount,
                threshold: queue.threshold
            }
        });
    };

    const executeProposal = async (payload: z.infer<typeof executeSchema>, ctx: any) => {
        const approver = requireSender(ctx);
        const proposalRows = await state.adapter.query('SELECT * FROM timelock_proposals WHERE proposal_id = ?', [payload.proposalId]);
        if (proposalRows.length === 0) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        const proposal = proposalRows[0];
        const queueRows = await state.adapter.query('SELECT * FROM timelock_queues WHERE queue_id = ?', [proposal.queue_id]);
        const queue = queueRows[0];
        const approvers = parseJson<string[]>(queue.approvers_json, []);
        if (!approvers.includes(approver)) {
            throw new Error('Only queue approvers can execute proposals');
        }

        if (proposal.status !== 'approved') {
            throw new Error('Proposal is not approved for execution');
        }

        if (new Date(proposal.ready_at) > new Date()) {
            throw new Error('Proposal timelock has not expired yet');
        }

        await state.adapter.query(
            'UPDATE timelock_proposals SET status = ?, executed_at = ?, execution_ref = ? WHERE proposal_id = ?',
            ['executed', new Date(), payload.executionRef || null, payload.proposalId]
        );

        await emitContractEvent(state.adapter, name, 'executeProposal', payload, {
            action: 'timelock_proposal_execution_requested',
            data: {
                proposalId: payload.proposalId,
                queueId: proposal.queue_id,
                actionType: proposal.action_type,
                actionPayload: parseJson(proposal.action_payload, {}),
                executionRef: payload.executionRef || null
            }
        });
    };

    const cancelProposal = async (payload: z.infer<typeof proposalIdSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const proposalRows = await state.adapter.query('SELECT * FROM timelock_proposals WHERE proposal_id = ?', [payload.proposalId]);
        if (proposalRows.length === 0) {
            throw new Error(`Proposal ${payload.proposalId} does not exist`);
        }

        const proposal = proposalRows[0];
        const queueRows = await state.adapter.query('SELECT * FROM timelock_queues WHERE queue_id = ?', [proposal.queue_id]);
        const queue = queueRows[0];
        if (sender !== proposal.proposer && sender !== queue.owner) {
            throw new Error('Only the proposer or queue owner can cancel this proposal');
        }

        await state.adapter.query(
            'UPDATE timelock_proposals SET status = ? WHERE proposal_id = ?',
            ['cancelled', payload.proposalId]
        );

        await emitContractEvent(state.adapter, name, 'cancelProposal', payload, {
            action: 'timelock_proposal_cancelled',
            data: {
                proposalId: payload.proposalId,
                cancelledBy: sender
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
            createQueue: action(createQueue, { schema: createQueueSchema, trigger: 'custom_json' }),
            createProposal: action(createProposal, { schema: createProposalSchema, trigger: 'custom_json' }),
            approveProposal: action(approveProposal, { schema: proposalIdSchema, trigger: 'custom_json' }),
            executeProposal: action(executeProposal, { schema: executeSchema, trigger: ['custom_json', 'time'] }),
            cancelProposal: action(cancelProposal, { schema: proposalIdSchema, trigger: 'custom_json' })
        }
    });
}
