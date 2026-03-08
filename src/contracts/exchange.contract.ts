import BigNumber from 'bignumber.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { action, defineContract } from './contract';
import { ensureSqlAdapter } from './helpers';

const DEFAULT_NAME = 'exchange';
const DEFAULT_ACCOUNT = 'beggars';

const SIDE_VALUES = ['buy', 'sell'] as const;

export interface ExchangeContractOptions {
    name?: string;
    account?: string;
    feeAccount?: string;
    makerFeeBps?: number;
    takerFeeBps?: number;
    basePrecision?: number;
    quotePrecision?: number;
    defaultAssetPrecision?: number;
}

export function createExchangeContract(options: ExchangeContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const account = options.account || DEFAULT_ACCOUNT;
    const feeAccount = options.feeAccount || account;
    const makerFeeBps = options.makerFeeBps ?? 10;
    const takerFeeBps = options.takerFeeBps ?? 20;
    const basePrecision = options.basePrecision ?? 8;
    const quotePrecision = options.quotePrecision ?? 8;
    const defaultAssetPrecision = options.defaultAssetPrecision ?? Math.max(basePrecision, quotePrecision);

    const state = {
        adapter: null as any,
        streamer: null as any
    };

    const createPairSchema = z.object({
        base: z.string().min(1).max(20),
        quote: z.string().min(1).max(20)
    });

    const depositSchema = z.object({}).passthrough();

    const withdrawSchema = z.object({
        asset: z.string().min(1).max(20),
        amount: z.string().min(1),
        to: z.string().min(1).max(16).optional()
    });

    const placeOrderSchema = z.object({
        side: z.enum(SIDE_VALUES),
        base: z.string().min(1).max(20),
        quote: z.string().min(1).max(20),
        price: z.string().min(1),
        amount: z.string().min(1)
    });

    const cancelOrderSchema = z.object({
        orderId: z.string().min(1)
    });

    const matchOrdersSchema = z.object({
        base: z.string().min(1).max(20).optional(),
        quote: z.string().min(1).max(20).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        snapshot: z.boolean().optional(),
        depth: z.number().int().min(1).max(200).optional()
    }).optional();

    const snapshotSchema = z.object({
        base: z.string().min(1).max(20),
        quote: z.string().min(1).max(20),
        depth: z.number().int().min(1).max(200).optional()
    });

    const transferSchema = z.object({
        to: z.string().min(1).max(16),
        asset: z.string().min(1).max(20),
        amount: z.string().min(1)
    });

    const formatAmount = (value: BigNumber, precision: number): string => {
        return value.decimalPlaces(precision, BigNumber.ROUND_DOWN).toFixed(precision);
    };

    const getAssetPrecision = (asset: string): number => {
        if (asset === 'HIVE' || asset === 'HBD') {
            return 3;
        }
        return defaultAssetPrecision;
    };

    const calculateFee = (amount: BigNumber, bps: number): BigNumber => {
        if (bps <= 0) {
            return new BigNumber(0);
        }
        return amount.multipliedBy(bps).dividedBy(10000);
    };

    const initializeTables = async () => {
        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS exchange_balances (
                account TEXT NOT NULL,
                asset TEXT NOT NULL,
                available TEXT NOT NULL DEFAULT '0',
                locked TEXT NOT NULL DEFAULT '0',
                PRIMARY KEY (account, asset)
            )
        `);

        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS exchange_pairs (
                base_asset TEXT NOT NULL,
                quote_asset TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (base_asset, quote_asset)
            )
        `);

        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS exchange_orders (
                id TEXT PRIMARY KEY,
                account TEXT NOT NULL,
                side TEXT NOT NULL,
                base_asset TEXT NOT NULL,
                quote_asset TEXT NOT NULL,
                price TEXT NOT NULL,
                amount TEXT NOT NULL,
                remaining TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        `);

        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS exchange_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                buy_order_id TEXT NOT NULL,
                sell_order_id TEXT NOT NULL,
                price TEXT NOT NULL,
                amount TEXT NOT NULL,
                base_asset TEXT NOT NULL,
                quote_asset TEXT NOT NULL,
                buyer TEXT NOT NULL,
                seller TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        `);

        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS exchange_deposits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account TEXT NOT NULL,
                asset TEXT NOT NULL,
                amount TEXT NOT NULL,
                block_number INTEGER NOT NULL,
                transaction_id TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        `);

        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS exchange_withdrawals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account TEXT NOT NULL,
                asset TEXT NOT NULL,
                amount TEXT NOT NULL,
                status TEXT NOT NULL,
                block_number INTEGER NOT NULL,
                transaction_id TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        `);

        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS exchange_orderbook_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                base_asset TEXT NOT NULL,
                quote_asset TEXT NOT NULL,
                bids TEXT NOT NULL,
                asks TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        `);
    };

    const withTransaction = async <T>(work: (adapter: any) => Promise<T>): Promise<T> => {
        if (typeof state.adapter?.runInTransaction === 'function') {
            return state.adapter.runInTransaction(work);
        }

        return work(state.adapter);
    };

    const getBalanceRow = async (accountName: string, asset: string, adapter: any = state.adapter) => {
        const rows = await adapter.query(
            'SELECT available, locked FROM exchange_balances WHERE account = ? AND asset = ?',
            [accountName, asset]
        );

        if (!rows || rows.length === 0) {
            await adapter.query(
                'INSERT INTO exchange_balances (account, asset, available, locked) VALUES (?, ?, ?, ?)',
                [accountName, asset, '0', '0']
            );
            return { available: new BigNumber(0), locked: new BigNumber(0) };
        }

        return {
            available: new BigNumber(rows[0].available || '0'),
            locked: new BigNumber(rows[0].locked || '0')
        };
    };

    const setBalanceRow = async (accountName: string, asset: string, available: BigNumber, locked: BigNumber, adapter: any = state.adapter) => {
        await adapter.query(
            'UPDATE exchange_balances SET available = ?, locked = ? WHERE account = ? AND asset = ?',
            [formatAmount(available, getAssetPrecision(asset)), formatAmount(locked, getAssetPrecision(asset)), accountName, asset]
        );
    };

    const ensurePairActive = async (base: string, quote: string, adapter: any = state.adapter) => {
        const rows = await adapter.query(
            'SELECT active FROM exchange_pairs WHERE base_asset = ? AND quote_asset = ?',
            [base, quote]
        );

        if (!rows || rows.length === 0 || rows[0].active !== 1) {
            throw new Error(`Trading pair ${base}/${quote} is not active`);
        }
    };

    const createPair = async (payload: { base: string; quote: string }, ctx: any) => {
        if (payload.base === payload.quote) {
            throw new Error('Base and quote assets must differ');
        }

        await withTransaction(async (adapter) => {
            const existing = await adapter.query(
                'SELECT base_asset FROM exchange_pairs WHERE base_asset = ? AND quote_asset = ?',
                [payload.base, payload.quote]
            );

            if (existing && existing.length > 0) {
                throw new Error(`Pair ${payload.base}/${payload.quote} already exists`);
            }

            await adapter.query(
                'INSERT INTO exchange_pairs (base_asset, quote_asset, active) VALUES (?, ?, 1)',
                [payload.base, payload.quote]
            );

            await adapter.addEvent(new Date(), name, 'createPair', payload, {
                action: 'pair_created',
                data: {
                    base: payload.base,
                    quote: payload.quote,
                    createdBy: ctx.sender
                }
            });
        });
    };

    const deposit = async (_payload: Record<string, unknown>, ctx: any) => {
        if (!ctx.transfer) {
            throw new Error('Transfer context required for deposits');
        }

        const amount = new BigNumber(ctx.transfer.amount);
        if (amount.isNaN() || amount.lte(0)) {
            throw new Error('Invalid deposit amount');
        }

        await withTransaction(async (adapter) => {
            const balance = await getBalanceRow(ctx.sender, ctx.transfer.asset, adapter);
            const nextAvailable = balance.available.plus(amount);

            await setBalanceRow(ctx.sender, ctx.transfer.asset, nextAvailable, balance.locked, adapter);

            await adapter.query(
                'INSERT INTO exchange_deposits (account, asset, amount, block_number, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [ctx.sender, ctx.transfer.asset, ctx.transfer.amount, ctx.block.number, ctx.transaction.id, new Date()]
            );

            await adapter.addEvent(new Date(), name, 'deposit', { asset: ctx.transfer.asset, amount: ctx.transfer.amount }, {
                action: 'deposit',
                data: {
                    account: ctx.sender,
                    asset: ctx.transfer.asset,
                    amount: ctx.transfer.amount
                }
            });
        });
    };

    const withdraw = async (payload: { asset: string; amount: string; to?: string }, ctx: any) => {
        const amount = new BigNumber(payload.amount);
        if (amount.isNaN() || amount.lte(0)) {
            throw new Error('Invalid withdrawal amount');
        }

        const balance = await getBalanceRow(ctx.sender, payload.asset);
        if (balance.available.lt(amount)) {
            throw new Error('Insufficient available balance');
        }

        const createdAt = new Date();
        const withdrawalId = await withTransaction(async (adapter) => {
            const currentBalance = await getBalanceRow(ctx.sender, payload.asset, adapter);
            if (currentBalance.available.lt(amount)) {
                throw new Error('Insufficient available balance');
            }

            const nextAvailable = currentBalance.available.minus(amount);
            await setBalanceRow(ctx.sender, payload.asset, nextAvailable, currentBalance.locked, adapter);

            await adapter.query(
                'INSERT INTO exchange_withdrawals (account, asset, amount, status, block_number, transaction_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [ctx.sender, payload.asset, payload.amount, 'pending', ctx.block.number, ctx.transaction.id, createdAt]
            );

            const insertedRows = await adapter.query(
                'SELECT id FROM exchange_withdrawals WHERE transaction_id = ? AND account = ? ORDER BY id DESC LIMIT 1',
                [ctx.transaction.id, ctx.sender]
            );

            if (!insertedRows.length) {
                throw new Error('Failed to locate newly created withdrawal');
            }

            return insertedRows[0].id;
        });

        try {
            const to = payload.to || ctx.sender;
            await state.streamer.transferHiveTokens(account, to, payload.amount, payload.asset, 'Exchange withdrawal');
            await state.adapter.query(
                'UPDATE exchange_withdrawals SET status = ? WHERE id = ?',
                ['completed', withdrawalId]
            );
        } catch (error) {
            await withTransaction(async (adapter) => {
                await setBalanceRow(ctx.sender, payload.asset, balance.available, balance.locked, adapter);
                await adapter.query(
                    'UPDATE exchange_withdrawals SET status = ? WHERE id = ?',
                    ['failed', withdrawalId]
                );
            });
            throw error;
        }
    };

    const placeOrder = async (payload: { side: 'buy' | 'sell'; base: string; quote: string; price: string; amount: string }, ctx: any) => {
        const price = new BigNumber(payload.price);
        const amount = new BigNumber(payload.amount);
        if (price.isNaN() || price.lte(0) || amount.isNaN() || amount.lte(0)) {
            throw new Error('Invalid price or amount');
        }

        const orderId = uuidv4();

        await withTransaction(async (adapter) => {
            await ensurePairActive(payload.base, payload.quote, adapter);

            if (payload.side === 'buy') {
                const cost = price.multipliedBy(amount);
                const balance = await getBalanceRow(ctx.sender, payload.quote, adapter);
                if (balance.available.lt(cost)) {
                    throw new Error('Insufficient quote balance');
                }

                await setBalanceRow(ctx.sender, payload.quote, balance.available.minus(cost), balance.locked.plus(cost), adapter);
            } else {
                const balance = await getBalanceRow(ctx.sender, payload.base, adapter);
                if (balance.available.lt(amount)) {
                    throw new Error('Insufficient base balance');
                }

                await setBalanceRow(ctx.sender, payload.base, balance.available.minus(amount), balance.locked.plus(amount), adapter);
            }

            await adapter.query(
                'INSERT INTO exchange_orders (id, account, side, base_asset, quote_asset, price, amount, remaining, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    orderId,
                    ctx.sender,
                    payload.side,
                    payload.base,
                    payload.quote,
                    formatAmount(price, quotePrecision),
                    formatAmount(amount, basePrecision),
                    formatAmount(amount, basePrecision),
                    'open',
                    new Date()
                ]
            );

            await adapter.addEvent(new Date(), name, 'placeOrder', payload, {
                action: 'order_opened',
                data: {
                    orderId,
                    account: ctx.sender,
                    side: payload.side,
                    base: payload.base,
                    quote: payload.quote,
                    price: price.toFixed(),
                    amount: amount.toFixed()
                }
            });
        });

    };

    const cancelOrder = async (payload: { orderId: string }, ctx: any) => {
        await withTransaction(async (adapter) => {
            const rows = await adapter.query(
                'SELECT * FROM exchange_orders WHERE id = ?',
                [payload.orderId]
            );

            if (!rows || rows.length === 0) {
                throw new Error('Order not found');
            }

            const order = rows[0];
            if (order.account !== ctx.sender) {
                throw new Error('Not authorized to cancel this order');
            }

            if (order.status !== 'open' && order.status !== 'partial') {
                throw new Error('Order cannot be canceled');
            }

            const remaining = new BigNumber(order.remaining);

            if (order.side === 'buy') {
                const price = new BigNumber(order.price);
                const refund = price.multipliedBy(remaining);
                const balance = await getBalanceRow(order.account, order.quote_asset, adapter);
                await setBalanceRow(order.account, order.quote_asset, balance.available.plus(refund), balance.locked.minus(refund), adapter);
            } else {
                const balance = await getBalanceRow(order.account, order.base_asset, adapter);
                await setBalanceRow(order.account, order.base_asset, balance.available.plus(remaining), balance.locked.minus(remaining), adapter);
            }

            await adapter.query(
                'UPDATE exchange_orders SET status = ?, remaining = ? WHERE id = ?',
                ['canceled', '0', payload.orderId]
            );

            await adapter.addEvent(new Date(), name, 'cancelOrder', payload, {
                action: 'order_canceled',
                data: {
                    orderId: payload.orderId,
                    account: ctx.sender
                }
            });
        });
    };

    const snapshotOrderBook = async (payload: { base: string; quote: string; depth?: number }) => {
        const depth = payload.depth ?? 20;

        const buys = await state.adapter.query(
            `SELECT price, remaining FROM exchange_orders
             WHERE base_asset = ? AND quote_asset = ? AND side = 'buy' AND status IN ('open', 'partial')
             ORDER BY CAST(price AS REAL) DESC, created_at ASC`,
            [payload.base, payload.quote]
        );

        const sells = await state.adapter.query(
            `SELECT price, remaining FROM exchange_orders
             WHERE base_asset = ? AND quote_asset = ? AND side = 'sell' AND status IN ('open', 'partial')
             ORDER BY CAST(price AS REAL) ASC, created_at ASC`,
            [payload.base, payload.quote]
        );

        const aggregateSide = (orders: any[]) => {
            const levels = new Map<string, BigNumber>();
            orders.forEach(order => {
                const price = String(order.price);
                const amount = new BigNumber(order.remaining || '0');
                if (!levels.has(price)) {
                    levels.set(price, amount);
                } else {
                    levels.set(price, (levels.get(price) as BigNumber).plus(amount));
                }
            });

            return Array.from(levels.entries()).slice(0, depth).map(([price, amount]) => ({
                price,
                amount: formatAmount(amount, basePrecision)
            }));
        };

        const bids = aggregateSide(buys);
        const asks = aggregateSide(sells);

        await state.adapter.query(
            'INSERT INTO exchange_orderbook_snapshots (base_asset, quote_asset, bids, asks, created_at) VALUES (?, ?, ?, ?, ?)',
            [payload.base, payload.quote, JSON.stringify(bids), JSON.stringify(asks), new Date()]
        );
    };

    const matchOrders = async (payload: { base?: string; quote?: string; limit?: number; snapshot?: boolean; depth?: number } = {}, _ctx?: any) => {
        const limit = payload.limit ?? 50;
        let matched = 0;

        const pairs = payload.base && payload.quote
            ? [{ base_asset: payload.base, quote_asset: payload.quote }]
            : await state.adapter.query('SELECT base_asset, quote_asset FROM exchange_pairs WHERE active = 1');

        for (const pair of pairs) {
            while (matched < limit) {
                const buyOrders = await state.adapter.query(
                    `SELECT * FROM exchange_orders
                     WHERE base_asset = ? AND quote_asset = ? AND side = 'buy' AND status IN ('open', 'partial')
                     ORDER BY CAST(price AS REAL) DESC, created_at ASC LIMIT 1`,
                    [pair.base_asset, pair.quote_asset]
                );

                const sellOrders = await state.adapter.query(
                    `SELECT * FROM exchange_orders
                     WHERE base_asset = ? AND quote_asset = ? AND side = 'sell' AND status IN ('open', 'partial')
                     ORDER BY CAST(price AS REAL) ASC, created_at ASC LIMIT 1`,
                    [pair.base_asset, pair.quote_asset]
                );

                if (!buyOrders.length || !sellOrders.length) {
                    break;
                }

                const buy = buyOrders[0];
                const sell = sellOrders[0];
                const buyPrice = new BigNumber(buy.price);
                const sellPrice = new BigNumber(sell.price);

                if (buyPrice.lt(sellPrice)) {
                    break;
                }

                const tradePrice = sellPrice;
                const buyRemaining = new BigNumber(buy.remaining);
                const sellRemaining = new BigNumber(sell.remaining);
                const tradeAmount = BigNumber.minimum(buyRemaining, sellRemaining);
                const tradeQuote = tradePrice.multipliedBy(tradeAmount);

                const buyCreatedAt = new Date(buy.created_at || buy.createdAt);
                const sellCreatedAt = new Date(sell.created_at || sell.createdAt);
                const buyIsMaker = buyCreatedAt <= sellCreatedAt;
                const buyerFeeBps = buyIsMaker ? makerFeeBps : takerFeeBps;
                const sellerFeeBps = buyIsMaker ? takerFeeBps : makerFeeBps;
                const buyerFeeBase = calculateFee(tradeAmount, buyerFeeBps);
                const sellerFeeQuote = calculateFee(tradeQuote, sellerFeeBps);

                await withTransaction(async (adapter) => {
                    const buyerBase = await getBalanceRow(buy.account, buy.base_asset, adapter);
                    const buyerQuote = await getBalanceRow(buy.account, buy.quote_asset, adapter);
                    const nextBuyRemaining = buyRemaining.minus(tradeAmount);
                    const nextBuyLocked = buyPrice.multipliedBy(nextBuyRemaining);
                    const buyerQuoteAvailable = buyerQuote.available.plus(buyerQuote.locked.minus(nextBuyLocked));
                    await setBalanceRow(
                        buy.account,
                        buy.base_asset,
                        buyerBase.available.plus(tradeAmount.minus(buyerFeeBase)),
                        buyerBase.locked,
                        adapter
                    );
                    await setBalanceRow(
                        buy.account,
                        buy.quote_asset,
                        buyerQuoteAvailable,
                        nextBuyLocked,
                        adapter
                    );

                    const sellerBase = await getBalanceRow(sell.account, sell.base_asset, adapter);
                    const sellerQuote = await getBalanceRow(sell.account, sell.quote_asset, adapter);
                    const nextSellRemaining = sellRemaining.minus(tradeAmount);
                    const nextSellLocked = nextSellRemaining;
                    await setBalanceRow(
                        sell.account,
                        sell.base_asset,
                        sellerBase.available,
                        nextSellLocked,
                        adapter
                    );
                    await setBalanceRow(
                        sell.account,
                        sell.quote_asset,
                        sellerQuote.available.plus(tradeQuote.minus(sellerFeeQuote)),
                        sellerQuote.locked,
                        adapter
                    );

                    if (buyerFeeBase.gt(0)) {
                        const feeBaseBalance = await getBalanceRow(feeAccount, buy.base_asset, adapter);
                        await setBalanceRow(
                            feeAccount,
                            buy.base_asset,
                            feeBaseBalance.available.plus(buyerFeeBase),
                            feeBaseBalance.locked,
                            adapter
                        );
                    }

                    if (sellerFeeQuote.gt(0)) {
                        const feeQuoteBalance = await getBalanceRow(feeAccount, sell.quote_asset, adapter);
                        await setBalanceRow(
                            feeAccount,
                            sell.quote_asset,
                            feeQuoteBalance.available.plus(sellerFeeQuote),
                            feeQuoteBalance.locked,
                            adapter
                        );
                    }

                    await adapter.query(
                        'UPDATE exchange_orders SET remaining = ?, status = ? WHERE id = ?',
                        [formatAmount(nextBuyRemaining, basePrecision), nextBuyRemaining.eq(0) ? 'filled' : 'partial', buy.id]
                    );

                    await adapter.query(
                        'UPDATE exchange_orders SET remaining = ?, status = ? WHERE id = ?',
                        [formatAmount(nextSellRemaining, basePrecision), nextSellRemaining.eq(0) ? 'filled' : 'partial', sell.id]
                    );

                    await adapter.query(
                        'INSERT INTO exchange_trades (buy_order_id, sell_order_id, price, amount, base_asset, quote_asset, buyer, seller, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            buy.id,
                            sell.id,
                            formatAmount(tradePrice, quotePrecision),
                            formatAmount(tradeAmount, basePrecision),
                            buy.base_asset,
                            buy.quote_asset,
                            buy.account,
                            sell.account,
                            new Date()
                        ]
                    );

                    await adapter.addEvent(new Date(), name, 'matchOrders', { base: pair.base_asset, quote: pair.quote_asset }, {
                        action: 'trade',
                        data: {
                            buyOrderId: buy.id,
                            sellOrderId: sell.id,
                            price: tradePrice.toFixed(),
                            amount: tradeAmount.toFixed(),
                            buyer: buy.account,
                            seller: sell.account,
                            buyerFeeBase: buyerFeeBase.toFixed(),
                            sellerFeeQuote: sellerFeeQuote.toFixed(),
                            maker: buyIsMaker ? buy.account : sell.account,
                            taker: buyIsMaker ? sell.account : buy.account
                        }
                    });
                });

                matched += 1;
            }

            if (payload.snapshot) {
                await snapshotOrderBook({ base: pair.base_asset, quote: pair.quote_asset, depth: payload.depth });
            }
        }
    };

    const internalTransfer = async (payload: { to: string; asset: string; amount: string }, ctx: any) => {
        const amount = new BigNumber(payload.amount);
        if (amount.isNaN() || amount.lte(0)) {
            throw new Error('Invalid transfer amount');
        }

        await withTransaction(async (adapter) => {
            const senderBalance = await getBalanceRow(ctx.sender, payload.asset, adapter);
            if (senderBalance.available.lt(amount)) {
                throw new Error('Insufficient available balance');
            }

            const recipientBalance = await getBalanceRow(payload.to, payload.asset, adapter);
            await setBalanceRow(ctx.sender, payload.asset, senderBalance.available.minus(amount), senderBalance.locked, adapter);
            await setBalanceRow(payload.to, payload.asset, recipientBalance.available.plus(amount), recipientBalance.locked, adapter);

            await adapter.addEvent(new Date(), name, 'transfer', payload, {
                action: 'internal_transfer',
                data: {
                    from: ctx.sender,
                    to: payload.to,
                    asset: payload.asset,
                    amount: payload.amount
                }
            });
        });
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ adapter, streamer }) => {
                ensureSqlAdapter(adapter);
                state.adapter = adapter;
                state.streamer = streamer;
                await initializeTables();
            }
        },
        actions: {
            createPair: action(createPair, { schema: createPairSchema, trigger: 'custom_json' }),
            deposit: action(deposit, { schema: depositSchema, trigger: 'transfer' }),
            withdraw: action(withdraw, { schema: withdrawSchema, trigger: 'custom_json', requiresActiveKey: true }),
            placeOrder: action(placeOrder, { schema: placeOrderSchema, trigger: 'custom_json' }),
            cancelOrder: action(cancelOrder, { schema: cancelOrderSchema, trigger: 'custom_json' }),
            matchOrders: action(matchOrders, { schema: matchOrdersSchema, trigger: 'time' }),
            snapshotOrderBook: action(snapshotOrderBook, { schema: snapshotSchema, trigger: ['time', 'custom_json'] }),
            transfer: action(internalTransfer, { schema: transferSchema, trigger: 'custom_json' })
        }
    });
}
