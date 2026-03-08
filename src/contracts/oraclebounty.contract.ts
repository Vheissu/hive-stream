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

const DEFAULT_NAME = 'oraclebounty';

export interface OracleBountyContractOptions {
    name?: string;
}

export function createOracleBountyContract(options: OracleBountyContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createFeedSchema = z.object({
        feedId: identifierSchema,
        title: z.string().min(3).max(140),
        rewardPerReport: amountSchema,
        rewardAsset: assetSchema,
        toleranceBps: z.number().int().min(0).max(10000).optional(),
        metadata: z.record(z.any()).optional()
    });

    const idSchema = z.object({
        feedId: identifierSchema
    });

    const submitReportSchema = z.object({
        feedId: identifierSchema,
        roundId: identifierSchema,
        value: z.number().finite(),
        note: z.string().max(280).optional()
    });

    const finalizeRoundSchema = z.object({
        feedId: identifierSchema,
        roundId: identifierSchema
    });

    const withdrawSchema = z.object({
        feedId: identifierSchema.optional()
    }).optional();

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS oracle_feeds (
                    feed_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    reward_per_report TEXT NOT NULL,
                    reward_asset TEXT NOT NULL,
                    tolerance_bps INTEGER NOT NULL,
                    budget_balance TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS oracle_reports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    feed_id TEXT NOT NULL,
                    round_id TEXT NOT NULL,
                    reporter TEXT NOT NULL,
                    value REAL NOT NULL,
                    rewarded INTEGER NOT NULL,
                    note TEXT,
                    created_at DATETIME NOT NULL,
                    UNIQUE(feed_id, round_id, reporter)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS oracle_rounds (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    feed_id TEXT NOT NULL,
                    round_id TEXT NOT NULL,
                    median_value REAL,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(feed_id, round_id)
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS oracle_reward_balances (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    feed_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    balance TEXT NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(feed_id, account, asset)
                )
            `
        ]);
    };

    const createFeed = async (payload: z.infer<typeof createFeedSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT feed_id FROM oracle_feeds WHERE feed_id = ?', [payload.feedId]);
        if (existing.length > 0) {
            throw new Error(`Feed ${payload.feedId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO oracle_feeds (
                feed_id, owner, title, reward_per_report, reward_asset, tolerance_bps, budget_balance, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.feedId,
                owner,
                payload.title,
                payload.rewardPerReport,
                payload.rewardAsset,
                payload.toleranceBps || 0,
                '0',
                JSON.stringify(payload.metadata || {}),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createFeed', payload, {
            action: 'oracle_feed_created',
            data: {
                feedId: payload.feedId,
                owner
            }
        });
    };

    const fundFeed = async (payload: z.infer<typeof idSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const rows = await state.adapter.query('SELECT * FROM oracle_feeds WHERE feed_id = ?', [payload.feedId]);
        if (rows.length === 0) {
            throw new Error(`Feed ${payload.feedId} does not exist`);
        }

        const feed = rows[0];
        if (feed.owner !== owner) {
            throw new Error('Only the feed owner can fund the oracle bounty');
        }

        assertAssetMatches(payment.asset, feed.reward_asset);
        const budget = toBigNumber(feed.budget_balance).plus(payment.amount);
        await state.adapter.query(
            'UPDATE oracle_feeds SET budget_balance = ? WHERE feed_id = ?',
            [budget.toFixed(), payload.feedId]
        );

        await emitContractEvent(state.adapter, name, 'fundFeed', payload, {
            action: 'oracle_feed_funded',
            data: {
                feedId: payload.feedId,
                budgetBalance: budget.toFixed()
            }
        });
    };

    const submitReport = async (payload: z.infer<typeof submitReportSchema>, ctx: any) => {
        const reporter = requireSender(ctx);
        const feedRows = await state.adapter.query('SELECT * FROM oracle_feeds WHERE feed_id = ?', [payload.feedId]);
        if (feedRows.length === 0) {
            throw new Error(`Feed ${payload.feedId} does not exist`);
        }

        await state.adapter.query(
            `INSERT INTO oracle_rounds (feed_id, round_id, median_value, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(feed_id, round_id)
             DO NOTHING`,
            [payload.feedId, payload.roundId, null, 'open', new Date(), new Date()]
        );
        await state.adapter.query(
            'INSERT INTO oracle_reports (feed_id, round_id, reporter, value, rewarded, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [payload.feedId, payload.roundId, reporter, payload.value, 0, payload.note || '', new Date()]
        );

        await emitContractEvent(state.adapter, name, 'submitReport', payload, {
            action: 'oracle_report_submitted',
            data: {
                feedId: payload.feedId,
                roundId: payload.roundId,
                reporter,
                value: payload.value
            }
        });
    };

    const finalizeRound = async (payload: z.infer<typeof finalizeRoundSchema>, ctx: any) => {
        const feedRows = await state.adapter.query('SELECT * FROM oracle_feeds WHERE feed_id = ?', [payload.feedId]);
        const roundRows = await state.adapter.query('SELECT * FROM oracle_rounds WHERE feed_id = ? AND round_id = ?', [payload.feedId, payload.roundId]);
        const reports = await state.adapter.query('SELECT * FROM oracle_reports WHERE feed_id = ? AND round_id = ? ORDER BY value ASC', [payload.feedId, payload.roundId]);
        if (feedRows.length === 0 || roundRows.length === 0) {
            throw new Error('Oracle round does not exist');
        }

        const feed = feedRows[0];
        if (ctx.trigger !== 'time') {
            const owner = requireSender(ctx);
            if (owner !== feed.owner) {
                throw new Error('Only the feed owner can finalize rounds');
            }
        }

        if (reports.length === 0) {
            throw new Error('Oracle round has no reports');
        }

        const values = reports.map((report: any) => Number(report.value)).sort((a: number, b: number) => a - b);
        const mid = Math.floor(values.length / 2);
        const median = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
        const tolerance = Number(feed.tolerance_bps || 0) / 10000;
        let rewardedCount = 0;
        let remainingBudget = toBigNumber(feed.budget_balance);

        for (const report of reports) {
            const deviation = median === 0 ? 0 : Math.abs((Number(report.value) - median) / median);
            const eligible = deviation <= tolerance || Number(feed.tolerance_bps || 0) === 0;
            if (!eligible || remainingBudget.lt(feed.reward_per_report)) {
                continue;
            }

            rewardedCount += 1;
            remainingBudget = remainingBudget.minus(feed.reward_per_report);

            const balanceRows = await state.adapter.query(
                'SELECT * FROM oracle_reward_balances WHERE feed_id = ? AND account = ? AND asset = ?',
                [payload.feedId, report.reporter, feed.reward_asset]
            );
            const nextBalance = (balanceRows.length > 0 ? toBigNumber(balanceRows[0].balance) : toBigNumber(0)).plus(feed.reward_per_report);
            await state.adapter.query(
                `INSERT INTO oracle_reward_balances (feed_id, account, asset, balance, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(feed_id, account, asset)
                 DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at`,
                [payload.feedId, report.reporter, feed.reward_asset, nextBalance.toFixed(), new Date()]
            );
            await state.adapter.query(
                'UPDATE oracle_reports SET rewarded = ? WHERE id = ?',
                [1, report.id]
            );
        }

        await state.adapter.query(
            'UPDATE oracle_feeds SET budget_balance = ? WHERE feed_id = ?',
            [remainingBudget.toFixed(), payload.feedId]
        );
        await state.adapter.query(
            'UPDATE oracle_rounds SET median_value = ?, status = ?, updated_at = ? WHERE feed_id = ? AND round_id = ?',
            [median, 'finalized', new Date(), payload.feedId, payload.roundId]
        );

        await emitContractEvent(state.adapter, name, 'finalizeRound', payload, {
            action: 'oracle_round_finalized',
            data: {
                feedId: payload.feedId,
                roundId: payload.roundId,
                median,
                rewardedCount
            }
        });
    };

    const withdrawRewards = async (payload: { feedId?: string } = {}, ctx: any) => {
        const account = requireSender(ctx);
        const balances = payload.feedId
            ? await state.adapter.query('SELECT * FROM oracle_reward_balances WHERE feed_id = ? AND account = ?', [payload.feedId, account])
            : await state.adapter.query('SELECT * FROM oracle_reward_balances WHERE account = ?', [account]);
        if (balances.length === 0) {
            throw new Error('No oracle reward balance found');
        }

        for (const balance of balances) {
            if (toBigNumber(balance.balance).lte(0)) {
                continue;
            }

            await state.adapter.query(
                'UPDATE oracle_reward_balances SET balance = ?, updated_at = ? WHERE feed_id = ? AND account = ? AND asset = ?',
                ['0', new Date(), balance.feed_id, account, balance.asset]
            );

            await emitContractEvent(state.adapter, name, 'withdrawRewards', payload, {
                action: 'oracle_reward_withdrawal_requested',
                data: {
                    feedId: balance.feed_id,
                    account,
                    amount: balance.balance,
                    asset: balance.asset
                }
            });
        }
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
            createFeed: action(createFeed, { schema: createFeedSchema, trigger: 'custom_json' }),
            fundFeed: action(fundFeed, { schema: idSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            submitReport: action(submitReport, { schema: submitReportSchema, trigger: 'custom_json' }),
            finalizeRound: action(finalizeRound, { schema: finalizeRoundSchema, trigger: ['custom_json', 'time'] }),
            withdrawRewards: action(withdrawRewards, { schema: withdrawSchema, trigger: 'custom_json' })
        }
    });
}
