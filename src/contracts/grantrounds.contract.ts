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

const DEFAULT_NAME = 'grantrounds';

export interface GrantRoundsContractOptions {
    name?: string;
}

export function createGrantRoundsContract(options: GrantRoundsContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createRoundSchema = z.object({
        roundId: identifierSchema,
        title: z.string().min(3).max(140),
        asset: assetSchema,
        closesAt: z.string(),
        metadata: z.record(z.any()).optional()
    });

    const idSchema = z.object({
        roundId: identifierSchema
    });

    const projectSchema = z.object({
        roundId: identifierSchema,
        projectId: identifierSchema,
        title: z.string().min(3).max(140),
        recipient: z.string().min(3).max(32),
        summary: z.string().max(500).optional()
    });

    const donateSchema = z.object({
        roundId: identifierSchema,
        projectId: identifierSchema
    });

    const withdrawSchema = z.object({
        roundId: identifierSchema,
        projectId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS grant_rounds (
                    round_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    matching_pool TEXT NOT NULL,
                    status TEXT NOT NULL,
                    closes_at DATETIME NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    finalized_at DATETIME
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS grant_projects (
                    project_id TEXT PRIMARY KEY,
                    round_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    summary TEXT,
                    donations_total TEXT NOT NULL,
                    matching_award TEXT NOT NULL,
                    withdrawn INTEGER NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS grant_donations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    round_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    donor TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createRound = async (payload: z.infer<typeof createRoundSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT round_id FROM grant_rounds WHERE round_id = ?', [payload.roundId]);
        if (existing.length > 0) {
            throw new Error(`Grant round ${payload.roundId} already exists`);
        }

        const closesAt = parseDateValue(payload.closesAt);
        if (!closesAt || closesAt <= new Date()) {
            throw new Error('Grant round close time must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO grant_rounds (
                round_id, owner, title, asset, matching_pool, status, closes_at, metadata, created_at, finalized_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [payload.roundId, owner, payload.title, payload.asset, '0', 'open', closesAt, JSON.stringify(payload.metadata || {}), new Date(), null]
        );

        await emitContractEvent(state.adapter, name, 'createRound', payload, {
            action: 'grant_round_created',
            data: {
                roundId: payload.roundId,
                owner
            }
        });
    };

    const fundRound = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM grant_rounds WHERE round_id = ?', [payload.roundId]);
        if (rows.length === 0) {
            throw new Error(`Grant round ${payload.roundId} does not exist`);
        }

        const round = rows[0];
        if (round.owner !== owner) {
            throw new Error('Only the round owner can fund the matching pool');
        }

        assertAssetMatches(payment.asset, round.asset);
        const matchingPool = toBigNumber(round.matching_pool).plus(payment.amount);
        await state.adapter.query(
            'UPDATE grant_rounds SET matching_pool = ? WHERE round_id = ?',
            [matchingPool.toFixed(), payload.roundId]
        );

        await emitContractEvent(state.adapter, name, 'fundRound', payload, {
            action: 'grant_round_funded',
            data: {
                roundId: payload.roundId,
                matchingPool: matchingPool.toFixed()
            }
        });
    };

    const submitProject = async (payload: z.infer<typeof projectSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const roundRows = await state.adapter.query('SELECT * FROM grant_rounds WHERE round_id = ?', [payload.roundId]);
        if (roundRows.length === 0) {
            throw new Error(`Grant round ${payload.roundId} does not exist`);
        }

        const existing = await state.adapter.query('SELECT project_id FROM grant_projects WHERE project_id = ?', [payload.projectId]);
        if (existing.length > 0) {
            throw new Error(`Project ${payload.projectId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO grant_projects (
                project_id, round_id, title, recipient, summary, donations_total, matching_award, withdrawn, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [payload.projectId, payload.roundId, payload.title, payload.recipient, payload.summary || '', '0', '0', 0, new Date()]
        );

        await emitContractEvent(state.adapter, name, 'submitProject', payload, {
            action: 'grant_project_submitted',
            data: {
                roundId: payload.roundId,
                projectId: payload.projectId,
                submitter: sender,
                recipient: payload.recipient
            }
        });
    };

    const donateToProject = async (payload: z.infer<typeof donateSchema>, ctx: any) => {
        const donor = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const roundRows = await state.adapter.query('SELECT * FROM grant_rounds WHERE round_id = ?', [payload.roundId]);
        const projectRows = await state.adapter.query('SELECT * FROM grant_projects WHERE project_id = ? AND round_id = ?', [payload.projectId, payload.roundId]);
        if (roundRows.length === 0 || projectRows.length === 0) {
            throw new Error('Grant round or project does not exist');
        }

        const round = roundRows[0];
        const project = projectRows[0];
        if (round.status !== 'open') {
            throw new Error('Grant round is not open');
        }

        if ((parseDateValue(round.closes_at) || new Date()) <= new Date()) {
            throw new Error('Grant round has already closed');
        }

        assertAssetMatches(payment.asset, round.asset);
        const total = toBigNumber(project.donations_total).plus(payment.amount);
        await state.adapter.query(
            'INSERT INTO grant_donations (round_id, project_id, donor, amount, asset, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [payload.roundId, payload.projectId, donor, payment.amount, payment.asset, new Date()]
        );
        await state.adapter.query(
            'UPDATE grant_projects SET donations_total = ? WHERE project_id = ?',
            [total.toFixed(), payload.projectId]
        );

        await emitContractEvent(state.adapter, name, 'donateToProject', payload, {
            action: 'grant_project_donated',
            data: {
                roundId: payload.roundId,
                projectId: payload.projectId,
                donor,
                amount: payment.amount
            }
        });
    };

    const finalizeRound = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const rows = await state.adapter.query('SELECT * FROM grant_rounds WHERE round_id = ?', [payload.roundId]);
        if (rows.length === 0) {
            throw new Error(`Grant round ${payload.roundId} does not exist`);
        }

        const round = rows[0];
        if (round.status !== 'open') {
            return;
        }

        if (ctx.trigger !== 'time') {
            const owner = requireSender(ctx);
            if (owner !== round.owner) {
                throw new Error('Only the round owner can finalize the round');
            }
        }

        if ((parseDateValue(round.closes_at) || new Date()) > new Date()) {
            throw new Error('Grant round cannot be finalized before close');
        }

        const projects = await state.adapter.query('SELECT * FROM grant_projects WHERE round_id = ?', [payload.roundId]);
        const donorCounts = new Map<string, number>();
        let totalWeight = 0;

        for (const project of projects) {
            const rowsForProject = await state.adapter.query(
                'SELECT COUNT(DISTINCT donor) AS count FROM grant_donations WHERE round_id = ? AND project_id = ?',
                [payload.roundId, project.project_id]
            );
            const count = Number(rowsForProject[0]?.count || 0);
            donorCounts.set(project.project_id, count);
            totalWeight += count;
        }

        for (const project of projects) {
            const count = donorCounts.get(project.project_id) || 0;
            const award = totalWeight === 0
                ? toBigNumber(0)
                : toBigNumber(round.matching_pool).multipliedBy(count).dividedBy(totalWeight).decimalPlaces(8, 1);
            await state.adapter.query(
                'UPDATE grant_projects SET matching_award = ? WHERE project_id = ?',
                [award.toFixed(), project.project_id]
            );
        }

        await state.adapter.query(
            'UPDATE grant_rounds SET status = ?, finalized_at = ? WHERE round_id = ?',
            ['finalized', new Date(), payload.roundId]
        );

        await emitContractEvent(state.adapter, name, 'finalizeRound', payload, {
            action: 'grant_round_finalized',
            data: {
                roundId: payload.roundId,
                projectCount: projects.length
            }
        });
    };

    const withdrawGrant = async (payload: z.infer<typeof withdrawSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const roundRows = await state.adapter.query('SELECT * FROM grant_rounds WHERE round_id = ?', [payload.roundId]);
        const projectRows = await state.adapter.query('SELECT * FROM grant_projects WHERE project_id = ? AND round_id = ?', [payload.projectId, payload.roundId]);
        if (roundRows.length === 0 || projectRows.length === 0) {
            throw new Error('Grant round or project does not exist');
        }

        const round = roundRows[0];
        const project = projectRows[0];
        if (round.status !== 'finalized') {
            throw new Error('Grant round is not finalized');
        }

        if (project.recipient !== account) {
            throw new Error('Only the project recipient can withdraw the grant');
        }

        if (project.withdrawn) {
            throw new Error('Grant already withdrawn');
        }

        await state.adapter.query(
            'UPDATE grant_projects SET withdrawn = ? WHERE project_id = ?',
            [1, payload.projectId]
        );

        await emitContractEvent(state.adapter, name, 'withdrawGrant', payload, {
            action: 'grant_withdrawal_requested',
            data: {
                roundId: payload.roundId,
                projectId: payload.projectId,
                recipient: account,
                totalAmount: toBigNumber(project.donations_total).plus(project.matching_award).toFixed(),
                asset: round.asset
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
            createRound: action(createRound, { schema: createRoundSchema, trigger: 'custom_json' }),
            fundRound: action(fundRound, { schema: idSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            submitProject: action(submitProject, { schema: projectSchema, trigger: 'custom_json' }),
            donateToProject: action(donateToProject, { schema: donateSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            finalizeRound: action(finalizeRound, { schema: idSchema, trigger: ['custom_json', 'time'] }),
            withdrawGrant: action(withdrawGrant, { schema: withdrawSchema, trigger: 'custom_json' })
        }
    });
}
