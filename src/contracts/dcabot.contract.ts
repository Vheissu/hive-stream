import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    createContractState,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender
} from './helpers';

const DEFAULT_NAME = 'dcabots';

export interface DcaBotContractOptions {
    name?: string;
}

export function createDcaBotContract(options: DcaBotContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createBotSchema = z.object({
        botId: identifierSchema,
        baseAsset: assetSchema,
        quoteAsset: assetSchema,
        amountPerInterval: amountSchema,
        intervalHours: z.number().int().min(1).max(24 * 30),
        maxExecutions: z.number().int().min(1).max(100000).optional(),
        slippageBps: z.number().int().min(0).max(10000).optional(),
        startsAt: z.string().optional(),
        metadata: z.record(z.any()).optional()
    });

    const botIdSchema = z.object({
        botId: identifierSchema
    });

    const executeSchema = z.object({
        botId: identifierSchema.optional()
    }).optional();

    const acknowledgeSchema = z.object({
        botId: identifierSchema,
        executionId: z.number().int().min(1),
        status: z.enum(['placed', 'filled', 'failed', 'cancelled']),
        externalRef: z.string().max(120).optional(),
        notes: z.string().max(500).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS dca_bots (
                    bot_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    base_asset TEXT NOT NULL,
                    quote_asset TEXT NOT NULL,
                    amount_per_interval TEXT NOT NULL,
                    interval_hours INTEGER NOT NULL,
                    max_executions INTEGER,
                    execution_count INTEGER NOT NULL,
                    slippage_bps INTEGER NOT NULL,
                    next_execute_at DATETIME NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS dca_executions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bot_id TEXT NOT NULL,
                    execution_number INTEGER NOT NULL,
                    requested_at DATETIME NOT NULL,
                    status TEXT NOT NULL,
                    external_ref TEXT,
                    notes TEXT
                )
            `
        ]);
    };

    const createBot = async (payload: z.infer<typeof createBotSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT bot_id FROM dca_bots WHERE bot_id = ?', [payload.botId]);
        if (existing.length > 0) {
            throw new Error(`Bot ${payload.botId} already exists`);
        }

        const startsAt = parseDateValue(payload.startsAt) || new Date();
        await state.adapter.query(
            `INSERT INTO dca_bots (
                bot_id, owner, base_asset, quote_asset, amount_per_interval, interval_hours, max_executions, execution_count, slippage_bps,
                next_execute_at, status, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.botId,
                owner,
                payload.baseAsset,
                payload.quoteAsset,
                payload.amountPerInterval,
                payload.intervalHours,
                payload.maxExecutions || null,
                0,
                payload.slippageBps || 0,
                startsAt,
                'active',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createBot', payload, {
            action: 'dca_bot_created',
            data: {
                botId: payload.botId,
                owner
            }
        });
    };

    const pauseBot = async (payload: z.infer<typeof botIdSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const bots = await state.adapter.query('SELECT * FROM dca_bots WHERE bot_id = ?', [payload.botId]);
        if (bots.length === 0) {
            throw new Error(`Bot ${payload.botId} does not exist`);
        }

        const bot = bots[0];
        if (bot.owner !== owner) {
            throw new Error('Only the bot owner can pause this bot');
        }

        await state.adapter.query('UPDATE dca_bots SET status = ?, updated_at = ? WHERE bot_id = ?', ['paused', new Date(), payload.botId]);
        await emitContractEvent(state.adapter, name, 'pauseBot', payload, {
            action: 'dca_bot_paused',
            data: {
                botId: payload.botId,
                owner
            }
        });
    };

    const resumeBot = async (payload: z.infer<typeof botIdSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const bots = await state.adapter.query('SELECT * FROM dca_bots WHERE bot_id = ?', [payload.botId]);
        if (bots.length === 0) {
            throw new Error(`Bot ${payload.botId} does not exist`);
        }

        const bot = bots[0];
        if (bot.owner !== owner) {
            throw new Error('Only the bot owner can resume this bot');
        }

        await state.adapter.query('UPDATE dca_bots SET status = ?, updated_at = ? WHERE bot_id = ?', ['active', new Date(), payload.botId]);
        await emitContractEvent(state.adapter, name, 'resumeBot', payload, {
            action: 'dca_bot_resumed',
            data: {
                botId: payload.botId,
                owner
            }
        });
    };

    const executeDueBots = async (payload: { botId?: string } = {}, _ctx: any) => {
        const bots = payload.botId
            ? await state.adapter.query('SELECT * FROM dca_bots WHERE bot_id = ?', [payload.botId])
            : await state.adapter.query('SELECT * FROM dca_bots WHERE status = ?', ['active']);
        const now = new Date();

        for (const bot of bots) {
            if (bot.status !== 'active') {
                continue;
            }

            const nextExecuteAt = parseDateValue(bot.next_execute_at) || now;
            if (nextExecuteAt > now) {
                continue;
            }

            const executionNumber = Number(bot.execution_count || 0) + 1;
            const maxExecutions = bot.max_executions ? Number(bot.max_executions) : null;
            const nextStatus = maxExecutions && executionNumber >= maxExecutions
                ? 'completed'
                : 'active';
            const nextSchedule = new Date(now.getTime() + Number(bot.interval_hours) * 60 * 60 * 1000);

            await state.adapter.query(
                'INSERT INTO dca_executions (bot_id, execution_number, requested_at, status, external_ref, notes) VALUES (?, ?, ?, ?, ?, ?)',
                [bot.bot_id, executionNumber, now, 'queued', null, null]
            );
            await state.adapter.query(
                'UPDATE dca_bots SET execution_count = ?, next_execute_at = ?, status = ?, updated_at = ? WHERE bot_id = ?',
                [executionNumber, nextSchedule, nextStatus, now, bot.bot_id]
            );

            await emitContractEvent(state.adapter, name, 'executeDueBots', { botId: bot.bot_id }, {
                action: 'dca_execution_requested',
                data: {
                    botId: bot.bot_id,
                    owner: bot.owner,
                    executionNumber,
                    baseAsset: bot.base_asset,
                    quoteAsset: bot.quote_asset,
                    amountPerInterval: bot.amount_per_interval,
                    slippageBps: bot.slippage_bps
                }
            });
        }
    };

    const acknowledgeExecution = async (payload: z.infer<typeof acknowledgeSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const bots = await state.adapter.query('SELECT * FROM dca_bots WHERE bot_id = ?', [payload.botId]);
        if (bots.length === 0) {
            throw new Error(`Bot ${payload.botId} does not exist`);
        }

        const bot = bots[0];
        if (bot.owner !== owner) {
            throw new Error('Only the bot owner can acknowledge executions');
        }

        const executions = await state.adapter.query('SELECT * FROM dca_executions WHERE id = ? AND bot_id = ?', [payload.executionId, payload.botId]);
        if (executions.length === 0) {
            throw new Error('Execution does not exist for this bot');
        }

        await state.adapter.query(
            'UPDATE dca_executions SET status = ?, external_ref = ?, notes = ? WHERE id = ?',
            [payload.status, payload.externalRef || null, payload.notes || null, payload.executionId]
        );

        await emitContractEvent(state.adapter, name, 'acknowledgeExecution', payload, {
            action: 'dca_execution_acknowledged',
            data: {
                botId: payload.botId,
                executionId: payload.executionId,
                status: payload.status,
                externalRef: payload.externalRef || null
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
            createBot: action(createBot, { schema: createBotSchema, trigger: 'custom_json' }),
            pauseBot: action(pauseBot, { schema: botIdSchema, trigger: 'custom_json' }),
            resumeBot: action(resumeBot, { schema: botIdSchema, trigger: 'custom_json' }),
            executeDueBots: action(executeDueBots, { schema: executeSchema, trigger: ['custom_json', 'time'] }),
            acknowledgeExecution: action(acknowledgeExecution, { schema: acknowledgeSchema, trigger: 'custom_json' })
        }
    });
}
