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

const DEFAULT_NAME = 'predictionmarkets';

export interface PredictionMarketContractOptions {
    name?: string;
}

export function createPredictionMarketContract(options: PredictionMarketContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createMarketSchema = z.object({
        marketId: identifierSchema,
        title: z.string().min(3).max(140),
        asset: assetSchema,
        options: z.array(z.string().min(1).max(80)).min(2).max(10),
        closesAt: z.string(),
        metadata: z.record(z.any()).optional()
    });

    const buyPositionSchema = z.object({
        marketId: identifierSchema,
        option: z.number().int().min(0)
    });

    const resolveSchema = z.object({
        marketId: identifierSchema,
        winningOption: z.number().int().min(0)
    });

    const claimSchema = z.object({
        marketId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS prediction_markets (
                    market_id TEXT PRIMARY KEY,
                    creator TEXT NOT NULL,
                    title TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    options_json TEXT NOT NULL,
                    closes_at DATETIME NOT NULL,
                    total_pool TEXT NOT NULL,
                    winning_option INTEGER,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    resolved_at DATETIME
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS prediction_positions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    market_id TEXT NOT NULL,
                    account TEXT NOT NULL,
                    option_index INTEGER NOT NULL,
                    stake_amount TEXT NOT NULL,
                    claimed INTEGER NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    UNIQUE(market_id, account, option_index)
                )
            `
        ]);
    };

    const createMarket = async (payload: z.infer<typeof createMarketSchema>, ctx: any) => {
        const creator = requireSender(ctx);
        const existing = await state.adapter.query('SELECT market_id FROM prediction_markets WHERE market_id = ?', [payload.marketId]);
        if (existing.length > 0) {
            throw new Error(`Market ${payload.marketId} already exists`);
        }

        const closesAt = parseDateValue(payload.closesAt);
        if (!closesAt || closesAt <= new Date()) {
            throw new Error('Market close time must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO prediction_markets (
                market_id, creator, title, asset, options_json, closes_at, total_pool, winning_option, status, metadata, created_at, resolved_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.marketId,
                creator,
                payload.title,
                payload.asset,
                JSON.stringify(payload.options),
                closesAt,
                '0',
                null,
                'open',
                JSON.stringify(payload.metadata || {}),
                new Date(),
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createMarket', payload, {
            action: 'prediction_market_created',
            data: {
                marketId: payload.marketId,
                creator
            }
        });
    };

    const buyPosition = async (payload: z.infer<typeof buyPositionSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const marketRows = await state.adapter.query('SELECT * FROM prediction_markets WHERE market_id = ?', [payload.marketId]);
        if (marketRows.length === 0) {
            throw new Error(`Market ${payload.marketId} does not exist`);
        }

        const market = marketRows[0];
        const options = JSON.parse(market.options_json || '[]');
        if (payload.option >= options.length) {
            throw new Error('Prediction option is out of range');
        }

        if (market.status !== 'open') {
            throw new Error('Market is not open');
        }

        if ((parseDateValue(market.closes_at) || new Date()) <= new Date()) {
            throw new Error('Market is closed');
        }

        assertAssetMatches(payment.asset, market.asset);

        const rows = await state.adapter.query(
            'SELECT * FROM prediction_positions WHERE market_id = ? AND account = ? AND option_index = ?',
            [payload.marketId, account, payload.option]
        );
        const currentStake = rows.length > 0 ? toBigNumber(rows[0].stake_amount) : toBigNumber(0);
        const nextStake = currentStake.plus(payment.amount);

        await state.adapter.query(
            `INSERT INTO prediction_positions (market_id, account, option_index, stake_amount, claimed, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(market_id, account, option_index)
             DO UPDATE SET stake_amount = excluded.stake_amount, updated_at = excluded.updated_at`,
            [payload.marketId, account, payload.option, nextStake.toFixed(), 0, new Date(), new Date()]
        );
        await state.adapter.query(
            'UPDATE prediction_markets SET total_pool = ? WHERE market_id = ?',
            [toBigNumber(market.total_pool).plus(payment.amount).toFixed(), payload.marketId]
        );

        await emitContractEvent(state.adapter, name, 'buyPosition', payload, {
            action: 'prediction_position_bought',
            data: {
                marketId: payload.marketId,
                account,
                option: payload.option,
                amount: payment.amount
            }
        });
    };

    const resolveMarket = async (payload: z.infer<typeof resolveSchema>, ctx: any) => {
        const rows = await state.adapter.query('SELECT * FROM prediction_markets WHERE market_id = ?', [payload.marketId]);
        if (rows.length === 0) {
            throw new Error(`Market ${payload.marketId} does not exist`);
        }

        const market = rows[0];
        const options = JSON.parse(market.options_json || '[]');
        if (payload.winningOption >= options.length) {
            throw new Error('Winning option is out of range');
        }

        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== market.creator) {
                throw new Error('Only the market creator can resolve this market');
            }
        }

        if ((parseDateValue(market.closes_at) || new Date()) > new Date()) {
            throw new Error('Market cannot be resolved before close');
        }

        await state.adapter.query(
            'UPDATE prediction_markets SET winning_option = ?, status = ?, resolved_at = ? WHERE market_id = ?',
            [payload.winningOption, 'resolved', new Date(), payload.marketId]
        );

        await emitContractEvent(state.adapter, name, 'resolveMarket', payload, {
            action: 'prediction_market_resolved',
            data: {
                marketId: payload.marketId,
                winningOption: payload.winningOption
            }
        });
    };

    const claimWinnings = async (payload: z.infer<typeof claimSchema>, ctx: any) => {
        const account = requireSender(ctx);
        const marketRows = await state.adapter.query('SELECT * FROM prediction_markets WHERE market_id = ?', [payload.marketId]);
        if (marketRows.length === 0) {
            throw new Error(`Market ${payload.marketId} does not exist`);
        }

        const market = marketRows[0];
        if (market.status !== 'resolved') {
            throw new Error('Market is not resolved');
        }

        const winningRows = await state.adapter.query(
            'SELECT * FROM prediction_positions WHERE market_id = ? AND account = ? AND option_index = ?',
            [payload.marketId, account, market.winning_option]
        );
        if (winningRows.length === 0) {
            throw new Error('No winning position found for this account');
        }

        const position = winningRows[0];
        if (position.claimed) {
            throw new Error('Winnings already claimed');
        }

        const totalWinningStakeRows = await state.adapter.query(
            'SELECT COALESCE(SUM(stake_amount), 0) AS total FROM prediction_positions WHERE market_id = ? AND option_index = ?',
            [payload.marketId, market.winning_option]
        );
        const totalWinningStake = toBigNumber(totalWinningStakeRows[0]?.total || '0');
        if (totalWinningStake.lte(0)) {
            throw new Error('No winning stakes exist for this market');
        }

        const payout = toBigNumber(position.stake_amount).dividedBy(totalWinningStake).multipliedBy(market.total_pool).decimalPlaces(8, 1);

        await state.adapter.query(
            'UPDATE prediction_positions SET claimed = ?, updated_at = ? WHERE id = ?',
            [1, new Date(), position.id]
        );

        await emitContractEvent(state.adapter, name, 'claimWinnings', payload, {
            action: 'prediction_winnings_claim_requested',
            data: {
                marketId: payload.marketId,
                account,
                payout: payout.toFixed(),
                asset: market.asset
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
            createMarket: action(createMarket, { schema: createMarketSchema, trigger: 'custom_json' }),
            buyPosition: action(buyPosition, { schema: buyPositionSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            resolveMarket: action(resolveMarket, { schema: resolveSchema, trigger: ['custom_json', 'time'] }),
            claimWinnings: action(claimWinnings, { schema: claimSchema, trigger: 'custom_json' })
        }
    });
}
