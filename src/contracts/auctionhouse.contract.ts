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
    parseDateValue,
    requireSender,
    toBigNumber,
    initializeTables
} from './helpers';

const DEFAULT_NAME = 'auctionhouse';

export interface AuctionHouseContractOptions {
    name?: string;
}

export function createAuctionHouseContract(options: AuctionHouseContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

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
        metadata: z.record(z.any()).optional()
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
            `
        ]);
    };

    const createAuction = async (payload: z.infer<typeof createAuctionSchema>, ctx: any) => {
        const seller = requireSender(ctx);
        const existing = await state.adapter.query('SELECT auction_id FROM auction_house_auctions WHERE auction_id = ?', [payload.auctionId]);
        if (existing.length > 0) {
            throw new Error(`Auction ${payload.auctionId} already exists`);
        }

        const startsAt = parseDateValue(payload.startsAt) || new Date();
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
                new Date(),
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
        });
    };

    const placeBid = async (payload: z.infer<typeof placeBidSchema>, ctx: any) => {
        const bidder = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const auctionRows = await state.adapter.query('SELECT * FROM auction_house_auctions WHERE auction_id = ?', [payload.auctionId]);
        if (auctionRows.length === 0) {
            throw new Error(`Auction ${payload.auctionId} does not exist`);
        }

        const auction = auctionRows[0];
        const now = new Date();
        const startsAt = parseDateValue(auction.starts_at) || now;
        const endsAt = parseDateValue(auction.ends_at) || now;

        if (auction.status !== 'open') {
            throw new Error('Auction is not open for bids');
        }

        if (bidder === auction.seller) {
            throw new Error('Seller cannot bid on their own auction');
        }

        if (startsAt > now) {
            throw new Error('Auction has not started yet');
        }

        if (endsAt <= now) {
            throw new Error('Auction has already ended');
        }

        assertAssetMatches(payment.asset, auction.payment_asset);

        const currentHighest = toBigNumber(auction.highest_bid || '0');
        const nextBid = toBigNumber(payment.amount);
        if (nextBid.lte(currentHighest)) {
            throw new Error('Bid must be greater than the current highest bid');
        }

        await state.adapter.query(
            'INSERT INTO auction_house_bids (auction_id, bidder, amount, asset, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [payload.auctionId, bidder, payment.amount, payment.asset, payload.note || '', now]
        );

        let status = 'open';
        let settledAt: Date | null = null;
        const shouldSettle = auction.buy_now_price && nextBid.gte(auction.buy_now_price);
        if (shouldSettle) {
            status = 'settled';
            settledAt = now;
        }

        await state.adapter.query(
            'UPDATE auction_house_auctions SET highest_bid = ?, highest_bidder = ?, status = ?, settled_at = ? WHERE auction_id = ?',
            [payment.amount, bidder, status, settledAt, payload.auctionId]
        );

        await emitContractEvent(state.adapter, name, 'placeBid', payload, {
            action: shouldSettle ? 'auction_settled' : 'auction_bid_placed',
            data: {
                auctionId: payload.auctionId,
                bidder,
                amount: payment.amount,
                asset: payment.asset,
                winner: shouldSettle ? bidder : null,
                settled: shouldSettle
            }
        });
    };

    const settleAuction = async (payload: z.infer<typeof settleSchema>, ctx: any) => {
        const rows = await state.adapter.query('SELECT * FROM auction_house_auctions WHERE auction_id = ?', [payload.auctionId]);
        if (rows.length === 0) {
            throw new Error(`Auction ${payload.auctionId} does not exist`);
        }

        const auction = rows[0];
        if (auction.status === 'settled' || auction.status === 'ended' || auction.status === 'cancelled') {
            return;
        }

        const sender = ctx.trigger === 'time' ? 'system' : requireSender(ctx);
        if (ctx.trigger !== 'time' && sender !== auction.seller) {
            throw new Error('Only the seller can settle this auction');
        }

        const endsAt = parseDateValue(auction.ends_at) || new Date();
        if (ctx.trigger !== 'time' && endsAt > new Date()) {
            throw new Error('Auction cannot be settled before it ends');
        }

        const highestBid = toBigNumber(auction.highest_bid || '0');
        const reservePrice = toBigNumber(auction.reserve_price);
        const status = auction.highest_bidder && highestBid.gte(reservePrice)
            ? 'settled'
            : 'ended';

        await state.adapter.query(
            'UPDATE auction_house_auctions SET status = ?, settled_at = ? WHERE auction_id = ?',
            [status, new Date(), payload.auctionId]
        );

        await emitContractEvent(state.adapter, name, 'settleAuction', payload, {
            action: 'auction_settled',
            data: {
                auctionId: payload.auctionId,
                status,
                winner: status === 'settled' ? auction.highest_bidder : null,
                winningBid: status === 'settled' ? auction.highest_bid : null
            }
        });
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
            ['cancelled', new Date(), payload.auctionId]
        );

        await emitContractEvent(state.adapter, name, 'cancelAuction', payload, {
            action: 'auction_cancelled',
            data: {
                auctionId: payload.auctionId,
                seller: sender
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
            createAuction: action(createAuction, { schema: createAuctionSchema, trigger: 'custom_json' }),
            placeBid: action(placeBid, { schema: placeBidSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            settleAuction: action(settleAuction, { schema: settleSchema, trigger: ['custom_json', 'time'] }),
            cancelAuction: action(cancelAuction, { schema: settleSchema, trigger: 'custom_json' })
        }
    });
}
