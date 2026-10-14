import { z } from 'zod';
import { getLogger } from '../logger';
import { operationRecordId } from '../types/hive-stream';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    createContractState,
    emitContractEvent,
    getIncomingPayment,
    identifierSchema,
    parseDateValue,
    requireSender,
    resolveContractAccount,
    toBigNumber,
    initializeTables
} from './helpers';

const DEFAULT_NAME = 'auctionhouse';

export interface AuctionHouseContractOptions {
    name?: string;
    /**
     * Account that holds bids in custody, refunds outbid bidders and pays
     * sellers. Bids must be sent to it. Defaults to the streamer username.
     */
    account?: string;
}

export function createAuctionHouseContract(options: AuctionHouseContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState({ streamer: null as any });
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';

    const createAuctionSchema = z.object({
        auctionId: identifierSchema,
        title: z.string().min(3).max(140),
        description: z.string().max(1000).optional(),
        assetType: z.string().min(1).max(40).optional(),
        assetRef: z.string().min(1).max(140),
        paymentAsset: assetSchema,
        reservePrice: amountSchema,
        buyNowPrice: amountSchema.optional(),
        startsAt: z.string().optional(),
        endsAt: z.string(),
        metadata: z.record(z.string(), z.any()).optional()
    });

    const placeBidSchema = z.object({
        auctionId: identifierSchema,
        note: z.string().max(280).optional()
    });

    const settleSchema = z.object({
        auctionId: identifierSchema
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS auction_house_auctions (
                    auction_id TEXT PRIMARY KEY,
                    seller TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    asset_type TEXT NOT NULL,
                    asset_ref TEXT NOT NULL,
                    payment_asset TEXT NOT NULL,
                    reserve_price TEXT NOT NULL,
                    buy_now_price TEXT,
                    starts_at DATETIME NOT NULL,
                    ends_at DATETIME NOT NULL,
                    status TEXT NOT NULL,
                    highest_bid TEXT,
                    highest_bidder TEXT,
                    created_at DATETIME NOT NULL,
                    settled_at DATETIME,
                    metadata TEXT
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS auction_house_bids (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    auction_id TEXT NOT NULL,
                    bidder TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    note TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS auction_house_payouts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    auction_id TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    memo TEXT NOT NULL,
                    reference TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    paid_at DATETIME
                )
            `
        ]);
    };

    const withTransaction = async <T>(work: (adapter: any) => Promise<T>): Promise<T> => {
        if (typeof state.adapter?.runInTransaction === 'function') {
            return state.adapter.runInTransaction(work);
        }

        return work(state.adapter);
    };

    /**
     * Records money the auction house owes someone. Payouts are written as
     * `pending` together with the state change that creates them and only
     * marked `paid` once the transfer has been broadcast, so a failed
     * broadcast is retried by the next `settleAuction` call instead of lost.
     */
    const queuePayout = async (
        adapter: any,
        ctx: any,
        payout: { auctionId: string; recipient: string; amount: string; asset: string; kind: string; memo: string }
    ) => {
        await adapter.query(
            `INSERT INTO auction_house_payouts (auction_id, recipient, amount, asset, kind, memo, reference, status, created_at, paid_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payout.auctionId,
                payout.recipient,
                payout.amount,
                payout.asset,
                payout.kind,
                payout.memo,
                operationRecordId(ctx.transaction?.id ?? 'time', ctx.transaction?.operationIndex),
                'pending',
                blockTimeOf(ctx),
                null
            ]
        );
    };

    const flushPayouts = async (auctionId: string, ctx: any) => {
        const pending = await state.adapter.query(
            'SELECT * FROM auction_house_payouts WHERE auction_id = ? AND status = ? ORDER BY id ASC',
            [auctionId, 'pending']
        );

        for (const payout of pending) {
            try {
                await state.streamer.transferHiveTokens(account, payout.recipient, payout.amount, payout.asset, payout.memo);
            } catch (error) {
                getLogger().error(`[AuctionHouse] ${payout.kind} payout ${payout.id} of ${payout.amount} ${payout.asset} to ${payout.recipient} failed; it stays pending and settleAuction retries it:`, error);
                continue;
            }

            await state.adapter.query(
                'UPDATE auction_house_payouts SET status = ?, paid_at = ? WHERE id = ?',
                ['paid', blockTimeOf(ctx), payout.id]
            );

            await emitContractEvent(state.adapter, name, 'payout', { auctionId }, {
                action: 'auction_payout_sent',
                data: {
                    auctionId,
                    recipient: payout.recipient,
                    amount: payout.amount,
                    asset: payout.asset,
                    kind: payout.kind
                }
            }, blockTimeOf(ctx));
        }
    };

    const createAuction = async (payload: z.infer<typeof createAuctionSchema>, ctx: any) => {
        const seller = requireSender(ctx);
        const existing = await state.adapter.query('SELECT auction_id FROM auction_house_auctions WHERE auction_id = ?', [payload.auctionId]);
        if (existing.length > 0) {
            throw new Error(`Auction ${payload.auctionId} already exists`);
        }

        const startsAt = parseDateValue(payload.startsAt) || blockTimeOf(ctx);
        const endsAt = parseDateValue(payload.endsAt);
        if (!endsAt || endsAt <= startsAt) {
            throw new Error('Auction end date must be after the start date');
        }

        if (payload.buyNowPrice && toBigNumber(payload.buyNowPrice).lte(payload.reservePrice)) {
            throw new Error('Buy now price must be greater than the reserve price');
        }

        await state.adapter.query(
            `INSERT INTO auction_house_auctions (
                auction_id, seller, title, description, asset_type, asset_ref, payment_asset, reserve_price, buy_now_price,
                starts_at, ends_at, status, highest_bid, highest_bidder, created_at, settled_at, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.auctionId,
                seller,
                payload.title,
                payload.description || '',
                payload.assetType || 'item',
                payload.assetRef,
                payload.paymentAsset,
                payload.reservePrice,
                payload.buyNowPrice || null,
                startsAt,
                endsAt,
                'open',
                null,
                null,
                blockTimeOf(ctx),
                null,
                JSON.stringify(payload.metadata || {})
            ]
        );

        await emitContractEvent(state.adapter, name, 'createAuction', payload, {
            action: 'auction_created',
            data: {
                auctionId: payload.auctionId,
                seller,
                paymentAsset: payload.paymentAsset,
                reservePrice: payload.reservePrice
            }
        }, blockTimeOf(ctx));
    };

    const placeBid = async (payload: z.infer<typeof placeBidSchema>, ctx: any) => {
        const bidder = requireSender(ctx);
        const payment = getIncomingPayment(ctx);

        if (payment.to !== account) {
            throw new Error(`Bids must be sent to ${account}`);
        }

        const now = blockTimeOf(ctx);

        // Every bid is held in custody from here on: one that can't be
        // accepted is sent straight back rather than kept.
        const refundBid = async (reason: string) => {
            await withTransaction(async (adapter) => {
                await queuePayout(adapter, ctx, {
                    auctionId: payload.auctionId,
                    recipient: bidder,
                    amount: payment.amount,
                    asset: payment.asset,
                    kind: 'rejected_bid_refund',
                    memo: `[Refund] Auction ${payload.auctionId}: ${reason}`
                });

                await adapter.addEvent?.(now, name, 'placeBid', payload, {
                    action: 'auction_bid_refunded',
                    data: {
                        auctionId: payload.auctionId,
                        bidder,
                        amount: payment.amount,
                        asset: payment.asset,
                        reason
                    }
                });
            });

            await flushPayouts(payload.auctionId, ctx);
        };

        const auctionRows = await state.adapter.query('SELECT * FROM auction_house_auctions WHERE auction_id = ?', [payload.auctionId]);
        if (auctionRows.length === 0) {
            return refundBid('auction does not exist');
        }

        const auction = auctionRows[0];
        const startsAt = parseDateValue(auction.starts_at) || now;
        const endsAt = parseDateValue(auction.ends_at) || now;

        if (auction.status !== 'open') {
            return refundBid('auction is not open for bids');
        }

        if (bidder === auction.seller) {
            return refundBid('seller cannot bid on their own auction');
        }

        if (startsAt > now) {
            return refundBid('auction has not started yet');
        }

        if (endsAt <= now) {
            return refundBid('auction has already ended');
        }

        if (payment.asset !== auction.payment_asset) {
            return refundBid(`bids must be paid in ${auction.payment_asset}`);
        }

        const currentHighest = toBigNumber(auction.highest_bid || '0');
        const nextBid = toBigNumber(payment.amount);
        if (nextBid.lte(currentHighest)) {
            return refundBid('bid must be greater than the current highest bid');
        }

        const shouldSettle = Boolean(auction.buy_now_price && nextBid.gte(auction.buy_now_price));
        const status = shouldSettle ? 'settled' : 'open';
        const settledAt: Date | null = shouldSettle ? now : null;

        await withTransaction(async (adapter) => {
            await adapter.query(
                'INSERT INTO auction_house_bids (auction_id, bidder, amount, asset, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [payload.auctionId, bidder, payment.amount, payment.asset, payload.note || '', now]
            );

            if (auction.highest_bidder) {
                await queuePayout(adapter, ctx, {
                    auctionId: payload.auctionId,
                    recipient: auction.highest_bidder,
                    amount: auction.highest_bid,
                    asset: auction.payment_asset,
                    kind: 'outbid_refund',
                    memo: `[Refund] You were outbid on auction ${payload.auctionId}`
                });
            }

            if (shouldSettle) {
                await queuePayout(adapter, ctx, {
                    auctionId: payload.auctionId,
                    recipient: auction.seller,
                    amount: payment.amount,
                    asset: payment.asset,
                    kind: 'sale',
                    memo: `Auction ${payload.auctionId} sold to ${bidder}`
                });
            }

            await adapter.query(
                'UPDATE auction_house_auctions SET highest_bid = ?, highest_bidder = ?, status = ?, settled_at = ? WHERE auction_id = ?',
                [payment.amount, bidder, status, settledAt, payload.auctionId]
            );

            await adapter.addEvent?.(now, name, 'placeBid', payload, {
                action: shouldSettle ? 'auction_settled' : 'auction_bid_placed',
                data: {
                    auctionId: payload.auctionId,
                    bidder,
                    amount: payment.amount,
                    asset: payment.asset,
                    winner: shouldSettle ? bidder : null,
                    settled: shouldSettle,
                    outbid: auction.highest_bidder || null
                }
            });
        });

        await flushPayouts(payload.auctionId, ctx);
    };

    const settleAuction = async (payload: z.infer<typeof settleSchema>, ctx: any) => {
        const rows = await state.adapter.query('SELECT * FROM auction_house_auctions WHERE auction_id = ?', [payload.auctionId]);
        if (rows.length === 0) {
            throw new Error(`Auction ${payload.auctionId} does not exist`);
        }

        const auction = rows[0];
        if (auction.status === 'settled' || auction.status === 'ended' || auction.status === 'cancelled') {
            // Already decided: only retry payouts whose broadcast failed.
            await flushPayouts(payload.auctionId, ctx);
            return;
        }

        const sender = ctx.trigger === 'time' ? 'system' : requireSender(ctx);
        if (ctx.trigger !== 'time' && sender !== auction.seller) {
            throw new Error('Only the seller can settle this auction');
        }

        const endsAt = parseDateValue(auction.ends_at) || blockTimeOf(ctx);
        if (ctx.trigger !== 'time' && endsAt > blockTimeOf(ctx)) {
            throw new Error('Auction cannot be settled before it ends');
        }

        const highestBid = toBigNumber(auction.highest_bid || '0');
        const reservePrice = toBigNumber(auction.reserve_price);
        const status = auction.highest_bidder && highestBid.gte(reservePrice)
            ? 'settled'
            : 'ended';

        await withTransaction(async (adapter) => {
            if (status === 'settled') {
                await queuePayout(adapter, ctx, {
                    auctionId: payload.auctionId,
                    recipient: auction.seller,
                    amount: auction.highest_bid,
                    asset: auction.payment_asset,
                    kind: 'sale',
                    memo: `Auction ${payload.auctionId} sold to ${auction.highest_bidder}`
                });
            } else if (auction.highest_bidder) {
                await queuePayout(adapter, ctx, {
                    auctionId: payload.auctionId,
                    recipient: auction.highest_bidder,
                    amount: auction.highest_bid,
                    asset: auction.payment_asset,
                    kind: 'reserve_refund',
                    memo: `[Refund] Auction ${payload.auctionId} ended below its reserve price`
                });
            }

            await adapter.query(
                'UPDATE auction_house_auctions SET status = ?, settled_at = ? WHERE auction_id = ?',
                [status, blockTimeOf(ctx), payload.auctionId]
            );

            await adapter.addEvent?.(blockTimeOf(ctx), name, 'settleAuction', payload, {
                action: 'auction_settled',
                data: {
                    auctionId: payload.auctionId,
                    status,
                    winner: status === 'settled' ? auction.highest_bidder : null,
                    winningBid: status === 'settled' ? auction.highest_bid : null,
                    refunded: status === 'ended' ? auction.highest_bidder || null : null
                }
            });
        });

        await flushPayouts(payload.auctionId, ctx);
    };

    const cancelAuction = async (payload: z.infer<typeof settleSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const rows = await state.adapter.query('SELECT * FROM auction_house_auctions WHERE auction_id = ?', [payload.auctionId]);
        if (rows.length === 0) {
            throw new Error(`Auction ${payload.auctionId} does not exist`);
        }

        const auction = rows[0];
        if (auction.seller !== sender) {
            throw new Error('Only the seller can cancel this auction');
        }

        if (auction.highest_bidder) {
            throw new Error('Cannot cancel an auction with bids');
        }

        await state.adapter.query(
            'UPDATE auction_house_auctions SET status = ?, settled_at = ? WHERE auction_id = ?',
            ['cancelled', blockTimeOf(ctx), payload.auctionId]
        );

        await emitContractEvent(state.adapter, name, 'cancelAuction', payload, {
            action: 'auction_cancelled',
            data: {
                auctionId: payload.auctionId,
                seller: sender
            }
        }, blockTimeOf(ctx));
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                account = resolveContractAccount('createAuctionHouseContract', options.account, lifecycle);
                state.adapter = lifecycle.adapter;
                state.streamer = lifecycle.streamer;
                await initialize();
            }
        },
        actions: {
            createAuction: action(createAuction, { schema: createAuctionSchema, trigger: 'custom_json' }),
            placeBid: action(placeBid, {
                schema: placeBidSchema,
                trigger: ['transfer', 'recurrent_transfer'],
                description: 'Bid by sending the full bid amount to the auction account. Outbid bidders are refunded automatically; bids that cannot be accepted are sent back.',
                // Bids go to the custody account: the streamer username unless
                // options.account names another account.
                ...(options.account ? { guards: { allowedRecipients: [options.account] } } : {})
            }),
            settleAuction: action(settleAuction, {
                schema: settleSchema,
                trigger: ['custom_json', 'time'],
                description: 'Close an ended auction: pays the seller when the reserve is met, otherwise refunds the highest bidder. Calling it again retries any payout whose transfer failed.'
            }),
            cancelAuction: action(cancelAuction, { schema: settleSchema, trigger: 'custom_json' })
        }
    });
}
