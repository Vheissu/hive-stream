import BigNumber from '../bignumber';
import { z } from 'zod';
import { getLogger } from '../logger';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    parseBlockchainAmount,
    requireEscrowContext,
    requireSender,
    resolveContractAccount,
    toBigNumber
} from './helpers';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'escrowmarket';
const DEFAULT_ASSETS = ['HIVE', 'HBD'];
const PRECISION = 3;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Slack on the minimum escrow lifetime for the time between signing and inclusion. */
const EXPIRATION_SLACK_MS = HOUR_MS;
const MAX_FEE_BPS = 5000;

const tradeIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/, 'Invalid trade id');

/** Trades whose escrow still holds funds (or may still be ratified). */
const LIVE_STATUSES = ['pending_approval', 'active', 'shipped', 'delivered', 'disputed', 'resolving', 'resolved', 'expired'];

export interface EscrowMarketplaceContractOptions {
    name?: string;
    /** Escrow agent account. Buyers must name it as `agent`. Defaults to the streamer username. */
    account?: string;
    /** Agent fee the buyer must include in the escrow, in basis points of the price (default 100 = 1%). */
    agentFeeBps?: number;
    /** Longest allowed gap between the escrow and its ratification deadline, in hours (default 24). */
    ratificationHours?: number;
    /** Minimum escrow lifetime (block time to expiration), in days (default 30). */
    expirationDays?: number;
    /** Approve valid escrows as the agent automatically (default true). */
    autoApprove?: boolean;
    /** Assets listings may be priced in. Defaults to HIVE and HBD. */
    allowedAssets?: string[];
}

type TradeEvent = Record<string, unknown>;

/** Hive timestamps carry no zone suffix but are UTC. */
function parseChainTime(value: string | undefined): Date | null {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const normalized = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
    const date = new Date(normalized);

    return Number.isNaN(date.getTime()) ? null : date;
}

function parseAmountOrZero(raw: string | undefined, expectedAsset: string): BigNumber | null {
    if (!raw) {
        return new BigNumber(0);
    }

    try {
        const parsed = parseBlockchainAmount(raw);

        if (parsed.asset !== expectedAsset) {
            return null;
        }

        return parsed.value;
    } catch (error) {
        return null;
    }
}

export function createEscrowMarketplaceContract(options: EscrowMarketplaceContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const agentFeeBps = options.agentFeeBps ?? 100;
    const ratificationHours = options.ratificationHours ?? 24;
    const expirationDays = options.expirationDays ?? 30;
    const autoApprove = options.autoApprove ?? true;
    const allowedAssets = (options.allowedAssets || DEFAULT_ASSETS).map((asset) => asset.toUpperCase());

    if (!Number.isInteger(agentFeeBps) || agentFeeBps < 0 || agentFeeBps > MAX_FEE_BPS) {
        throw new Error(`agentFeeBps must be an integer between 0 and ${MAX_FEE_BPS}`);
    }

    if (!Number.isFinite(ratificationHours) || ratificationHours <= 0) {
        throw new Error('ratificationHours must be a positive number');
    }

    if (!Number.isFinite(expirationDays) || expirationDays <= 0) {
        throw new Error('expirationDays must be a positive number');
    }

    if (allowedAssets.length === 0 || allowedAssets.some((asset) => asset !== 'HIVE' && asset !== 'HBD')) {
        throw new Error('allowedAssets must contain only HIVE and/or HBD (Hive escrow holds native assets only)');
    }

    const state = {
        streamer: null as any,
        adapter: null as any,
        subscribed: false,
        active: false
    };

    const createListingSchema = z.object({
        listingId: identifierSchema,
        title: z.string().min(1).max(120),
        price: amountSchema,
        asset: assetSchema,
        description: z.string().max(1000).optional()
    });

    const listingIdSchema = z.object({
        listingId: identifierSchema
    });

    const tradeRefSchema = z.object({
        tradeId: tradeIdSchema
    });

    const resolveDisputeSchema = z.object({
        tradeId: tradeIdSchema,
        receiver: z.enum(['buyer', 'seller']),
        hiveAmount: amountSchema.optional(),
        hbdAmount: amountSchema.optional()
    });

    const format = (value: BigNumber): string => value.toFixed(PRECISION, BigNumber.ROUND_DOWN);
    const formatAsset = (value: BigNumber, asset: string): string => `${format(value)} ${asset}`;

    const expectedFee = (price: BigNumber): BigNumber => price
        .multipliedBy(agentFeeBps)
        .dividedBy(10000)
        .decimalPlaces(PRECISION, BigNumber.ROUND_DOWN);

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS escrowmarket_listings (
                    listing_id TEXT PRIMARY KEY,
                    seller TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_trx TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS escrowmarket_trades (
                    trade_id TEXT PRIMARY KEY,
                    listing_id TEXT NOT NULL,
                    escrow_id INTEGER NOT NULL,
                    buyer TEXT NOT NULL,
                    seller TEXT NOT NULL,
                    agent TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    price TEXT NOT NULL,
                    hive_amount TEXT NOT NULL,
                    hbd_amount TEXT NOT NULL,
                    remaining_hive TEXT NOT NULL,
                    remaining_hbd TEXT NOT NULL,
                    fee TEXT NOT NULL,
                    status TEXT NOT NULL,
                    status_reason TEXT,
                    seller_approved INTEGER NOT NULL,
                    agent_approved INTEGER NOT NULL,
                    agent_approval_sent INTEGER NOT NULL,
                    ratification_deadline TEXT,
                    expiration TEXT,
                    disputed_by TEXT,
                    resolution_receiver TEXT,
                    block_number INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    shipped_at TEXT,
                    delivered_at TEXT,
                    disputed_at TEXT,
                    closed_at TEXT
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS escrowmarket_chain_ops (
                    op_key TEXT PRIMARY KEY,
                    trade_id TEXT NOT NULL,
                    op_type TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            `
        ]);
    };

    const emit = async (event: string, payload: unknown, data: TradeEvent, time: Date) => {
        await emitContractEvent(state.adapter, name, event, payload, {
            action: `escrowmarket_${event}`,
            data
        }, time);
    };

    const getListing = async (listingId: string): Promise<any | null> => {
        const rows = await state.adapter.query('SELECT * FROM escrowmarket_listings WHERE listing_id = ?', [listingId]);
        return rows[0] ?? null;
    };

    const getTrade = async (tradeId: string): Promise<any | null> => {
        const rows = await state.adapter.query('SELECT * FROM escrowmarket_trades WHERE trade_id = ?', [tradeId]);
        return rows[0] ?? null;
    };

    const requireTrade = async (tradeId: string): Promise<any> => {
        const trade = await getTrade(tradeId);

        if (!trade) {
            throw new Error(`Trade ${tradeId} does not exist`);
        }

        return trade;
    };

    /** The live trade for an on-chain escrow, identified by (from, escrow_id). */
    const findLiveTrade = async (buyer: string, escrowId: number): Promise<any | null> => {
        const placeholders = LIVE_STATUSES.map(() => '?').join(', ');
        const rows = await state.adapter.query(
            `SELECT * FROM escrowmarket_trades WHERE buyer = ? AND escrow_id = ? AND agent = ? AND status IN (${placeholders}) ORDER BY created_at DESC`,
            [buyer, Number(escrowId), account, ...LIVE_STATUSES]
        );
        return rows[0] ?? null;
    };

    const setTradeStatus = async (tradeId: string, status: string, now: Date, extra: Record<string, unknown> = {}) => {
        const columns = Object.keys(extra);
        const assignments = ['status = ?', 'updated_at = ?', ...columns.map((column) => `${column} = ?`)].join(', ');

        await state.adapter.query(
            `UPDATE escrowmarket_trades SET ${assignments} WHERE trade_id = ?`,
            [status, now.toISOString(), ...columns.map((column) => extra[column]), tradeId]
        );
    };

    const setListingStatus = async (listingId: string, status: string, now: Date, onlyFrom?: string) => {
        if (onlyFrom) {
            await state.adapter.query(
                'UPDATE escrowmarket_listings SET status = ?, updated_at = ? WHERE listing_id = ? AND status = ?',
                [status, now.toISOString(), listingId, onlyFrom]
            );
            return;
        }

        await state.adapter.query(
            'UPDATE escrowmarket_listings SET status = ?, updated_at = ? WHERE listing_id = ?',
            [status, now.toISOString(), listingId]
        );
    };

    /** Records a chain operation once; returns false when it was already applied (replay). */
    const claimChainOp = async (key: string, tradeId: string, type: string, now: Date): Promise<boolean> => {
        const rows = await state.adapter.query('SELECT op_key FROM escrowmarket_chain_ops WHERE op_key = ?', [key]);

        if (rows.length > 0) {
            return false;
        }

        await state.adapter.query(
            'INSERT INTO escrowmarket_chain_ops (op_key, trade_id, op_type, created_at) VALUES (?, ?, ?, ?)',
            [key, tradeId, type, now.toISOString()]
        );

        return true;
    };

    const broadcastAgentApproval = async (trade: any, now: Date): Promise<boolean> => {
        try {
            await state.streamer.escrowApprove({
                from: trade.buyer,
                to: trade.seller,
                agent: account,
                who: account,
                escrow_id: Number(trade.escrow_id),
                approve: true
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            getLogger().warn(`[EscrowMarketplace] Agent approval for trade ${trade.trade_id} failed: ${message}`);
            await emit('agent_approval_failed', { tradeId: trade.trade_id }, { tradeId: trade.trade_id, error: message }, now);
            return false;
        }

        await state.adapter.query(
            'UPDATE escrowmarket_trades SET agent_approval_sent = ?, updated_at = ? WHERE trade_id = ?',
            [1, now.toISOString(), trade.trade_id]
        );
        await emit('agent_approval_sent', { tradeId: trade.trade_id }, { tradeId: trade.trade_id, escrowId: Number(trade.escrow_id) }, now);

        return true;
    };

    const createListing = async (payload: z.infer<typeof createListingSchema>, ctx: ContractContext) => {
        const seller = requireSender(ctx);
        const now = blockTimeOf(ctx);
        const asset = payload.asset.toUpperCase();
        const price = toBigNumber(payload.price);

        if (!allowedAssets.includes(asset)) {
            throw new Error(`Unsupported asset ${asset}`);
        }

        if (price.lte(0) || price.decimalPlaces()! > PRECISION) {
            throw new Error(`Price must be positive with at most ${PRECISION} decimal places`);
        }

        if (await getListing(payload.listingId)) {
            throw new Error(`Listing ${payload.listingId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO escrowmarket_listings (
                listing_id, seller, title, description, price, asset, status, created_trx, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.listingId, seller, payload.title, payload.description ?? null, format(price), asset, 'open',
                operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex), now.toISOString(), now.toISOString()
            ]
        );

        await emit('listing_created', payload, { listingId: payload.listingId, seller, price: format(price), asset }, now);
    };

    const cancelListing = async (payload: z.infer<typeof listingIdSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const now = blockTimeOf(ctx);
        const listing = await getListing(payload.listingId);

        if (!listing) {
            throw new Error(`Listing ${payload.listingId} does not exist`);
        }

        if (listing.seller !== sender) {
            throw new Error('Only the seller can cancel a listing');
        }

        if (listing.status !== 'open') {
            throw new Error(`Listing ${payload.listingId} is ${listing.status}`);
        }

        const placeholders = LIVE_STATUSES.map(() => '?').join(', ');
        const live = await state.adapter.query(
            `SELECT trade_id FROM escrowmarket_trades WHERE listing_id = ? AND status IN (${placeholders})`,
            [payload.listingId, ...LIVE_STATUSES]
        );

        if (live.length > 0) {
            throw new Error(`Listing ${payload.listingId} has an open trade`);
        }

        await setListingStatus(payload.listingId, 'cancelled', now);
        await emit('listing_cancelled', payload, { listingId: payload.listingId, seller: sender }, now);
    };

    const openTrade = async (payload: z.infer<typeof listingIdSchema>, ctx: ContractContext) => {
        const escrow = requireEscrowContext(ctx);
        const buyer = requireSender(ctx);
        const now = blockTimeOf(ctx);
        const tradeId = operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex);

        if (await getTrade(tradeId)) {
            getLogger().warn(`[EscrowMarketplace] Duplicate escrow ${tradeId} ignored`);
            return;
        }

        const listing = await getListing(payload.listingId);
        const asset: string = listing?.asset ?? '';
        const price = listing ? toBigNumber(listing.price) : new BigNumber(0);
        const hiveAmount = parseAmountOrZero(escrow.hiveAmount, 'HIVE');
        const hbdAmount = parseAmountOrZero(escrow.hbdAmount, 'HBD');
        const paid = asset === 'HBD' ? hbdAmount : hiveAmount;
        const ratificationDeadline = parseChainTime(escrow.ratificationDeadline);
        const expiration = parseChainTime(escrow.expiration);
        const fee = expectedFee(price);

        let feePaid: BigNumber | null = null;
        let feeAsset = '';

        try {
            const parsedFee = parseBlockchainAmount(escrow.fee || '');
            feePaid = parsedFee.value;
            feeAsset = parsedFee.asset;
        } catch (error) {
            feePaid = null;
        }

        let rejection: string | null = null;

        if (escrow.agent !== account) {
            rejection = `Escrow agent must be ${account}`;
        } else if (escrow.from !== buyer) {
            rejection = 'Escrow sender does not match the action sender';
        } else if (!listing) {
            rejection = `Listing ${payload.listingId} does not exist`;
        } else if (listing.status !== 'open') {
            rejection = `Listing ${payload.listingId} is ${listing.status}`;
        } else if (escrow.to !== listing.seller) {
            rejection = `Escrow recipient must be the seller ${listing.seller}`;
        } else if (buyer === listing.seller) {
            rejection = 'Sellers cannot buy their own listing';
        } else if (hiveAmount === null || hbdAmount === null) {
            rejection = 'Invalid escrow amounts';
        } else if (paid === null || paid.lt(price)) {
            rejection = `Escrow must lock at least ${formatAsset(price, asset)}`;
        } else if (feePaid === null || (fee.gt(0) && feeAsset !== asset)) {
            rejection = `Agent fee must be paid in ${asset}`;
        } else if (feePaid.lt(fee)) {
            rejection = `Agent fee must be at least ${formatAsset(fee, asset)}`;
        } else if (!ratificationDeadline || ratificationDeadline.getTime() <= now.getTime()) {
            rejection = 'Ratification deadline must be in the future';
        } else if (ratificationDeadline.getTime() > now.getTime() + ratificationHours * HOUR_MS) {
            rejection = `Ratification deadline must be within ${ratificationHours} hours`;
        } else if (!expiration || expiration.getTime() <= ratificationDeadline.getTime()) {
            rejection = 'Escrow expiration must be after the ratification deadline';
        } else if (expiration.getTime() < now.getTime() + expirationDays * DAY_MS - EXPIRATION_SLACK_MS) {
            rejection = `Escrow must run for at least ${expirationDays} days`;
        }

        const record = [
            tradeId,
            payload.listingId,
            Number(escrow.escrowId ?? 0),
            buyer,
            escrow.to ?? '',
            escrow.agent ?? '',
            asset,
            format(price),
            format(hiveAmount ?? new BigNumber(0)),
            format(hbdAmount ?? new BigNumber(0)),
            format(hiveAmount ?? new BigNumber(0)),
            format(hbdAmount ?? new BigNumber(0)),
            feePaid ? formatAsset(feePaid, feeAsset) : String(escrow.fee ?? ''),
            rejection ? 'rejected' : 'pending_approval',
            rejection,
            0,
            0,
            0,
            ratificationDeadline ? ratificationDeadline.toISOString() : null,
            expiration ? expiration.toISOString() : null,
            ctx.block.number,
            now.toISOString(),
            now.toISOString(),
            rejection ? now.toISOString() : null
        ];

        await state.adapter.query(
            `INSERT INTO escrowmarket_trades (
                trade_id, listing_id, escrow_id, buyer, seller, agent, asset, price, hive_amount, hbd_amount,
                remaining_hive, remaining_hbd, fee, status, status_reason, seller_approved, agent_approved,
                agent_approval_sent, ratification_deadline, expiration, block_number, created_at, updated_at, closed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            record
        );

        const eventData = {
            tradeId,
            listingId: payload.listingId,
            escrowId: Number(escrow.escrowId ?? 0),
            buyer,
            seller: escrow.to,
            agent: escrow.agent,
            hiveAmount: escrow.hiveAmount,
            hbdAmount: escrow.hbdAmount,
            fee: escrow.fee
        };

        if (rejection) {
            // Nothing to refund: an escrow the agent never ratifies returns to
            // the buyer at its ratification deadline.
            await emit('trade_rejected', payload, { ...eventData, reason: rejection }, now);
            return;
        }

        await setListingStatus(payload.listingId, 'reserved', now);
        await emit('trade_opened', payload, eventData, now);

        if (autoApprove) {
            const trade = await getTrade(tradeId);
            await broadcastAgentApproval(trade, now);
        }
    };

    const approveTrade = async (payload: z.infer<typeof tradeRefSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const now = blockTimeOf(ctx);

        if (sender !== account) {
            throw new Error(`Only the agent ${account} can approve trades`);
        }

        const trade = await requireTrade(payload.tradeId);

        if (trade.status !== 'pending_approval') {
            throw new Error(`Trade ${payload.tradeId} is ${trade.status}`);
        }

        if (Number(trade.agent_approved) === 1) {
            throw new Error(`Trade ${payload.tradeId} is already approved by the agent`);
        }

        if (!(await broadcastAgentApproval(trade, now))) {
            throw new Error(`Agent approval for trade ${payload.tradeId} could not be broadcast`);
        }
    };

    const markShipped = async (payload: z.infer<typeof tradeRefSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const now = blockTimeOf(ctx);
        const trade = await requireTrade(payload.tradeId);

        if (trade.seller !== sender) {
            throw new Error('Only the seller can mark a trade shipped');
        }

        if (trade.status !== 'active') {
            throw new Error(`Trade ${payload.tradeId} is ${trade.status}`);
        }

        await setTradeStatus(trade.trade_id, 'shipped', now, { shipped_at: now.toISOString() });
        await emit('trade_shipped', payload, { tradeId: trade.trade_id, seller: sender }, now);
    };

    const confirmDelivery = async (payload: z.infer<typeof tradeRefSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const now = blockTimeOf(ctx);
        const trade = await requireTrade(payload.tradeId);

        if (trade.buyer !== sender) {
            throw new Error('Only the buyer can confirm delivery');
        }

        if (trade.status !== 'active' && trade.status !== 'shipped') {
            throw new Error(`Trade ${payload.tradeId} is ${trade.status}`);
        }

        await setTradeStatus(trade.trade_id, 'delivered', now, { delivered_at: now.toISOString() });
        await emit('trade_delivered', payload, { tradeId: trade.trade_id, buyer: sender }, now);
    };

    const resolveDispute = async (payload: z.infer<typeof resolveDisputeSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const now = blockTimeOf(ctx);

        if (sender !== account) {
            throw new Error(`Only the agent ${account} can resolve disputes`);
        }

        const trade = await requireTrade(payload.tradeId);

        if (trade.status !== 'disputed') {
            throw new Error(`Trade ${payload.tradeId} is ${trade.status}`);
        }

        const remainingHive = toBigNumber(trade.remaining_hive);
        const remainingHbd = toBigNumber(trade.remaining_hbd);
        const hive = payload.hiveAmount !== undefined ? toBigNumber(payload.hiveAmount) : (payload.hbdAmount !== undefined ? new BigNumber(0) : remainingHive);
        const hbd = payload.hbdAmount !== undefined ? toBigNumber(payload.hbdAmount) : (payload.hiveAmount !== undefined ? new BigNumber(0) : remainingHbd);

        if (hive.decimalPlaces()! > PRECISION || hbd.decimalPlaces()! > PRECISION) {
            throw new Error(`Amounts support at most ${PRECISION} decimal places`);
        }

        if (hive.gt(remainingHive) || hbd.gt(remainingHbd)) {
            throw new Error(`Release exceeds the escrow balance (${formatAsset(remainingHive, 'HIVE')}, ${formatAsset(remainingHbd, 'HBD')})`);
        }

        if (hive.lte(0) && hbd.lte(0)) {
            throw new Error('Nothing to release');
        }

        const receiver = payload.receiver === 'buyer' ? trade.buyer : trade.seller;
        const fullRelease = hive.eq(remainingHive) && hbd.eq(remainingHbd);

        // Mark the trade before broadcasting so a crash never leaves a
        // disputed trade that a second resolution could release again.
        await setTradeStatus(trade.trade_id, 'resolving', now, { resolution_receiver: receiver });

        try {
            await state.streamer.escrowRelease({
                from: trade.buyer,
                to: trade.seller,
                agent: account,
                who: account,
                receiver,
                escrow_id: Number(trade.escrow_id),
                hive_amount: formatAsset(hive, 'HIVE'),
                hbd_amount: formatAsset(hbd, 'HBD')
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await setTradeStatus(trade.trade_id, 'disputed', now, { resolution_receiver: null });
            await emit('resolve_failed', payload, { tradeId: trade.trade_id, receiver, error: message }, now);
            throw error;
        }

        if (fullRelease) {
            await setTradeStatus(trade.trade_id, 'resolved', now, { closed_at: now.toISOString() });
            await setListingStatus(trade.listing_id, payload.receiver === 'seller' ? 'sold' : 'open', now, 'reserved');
        } else {
            await setTradeStatus(trade.trade_id, 'disputed', now);
        }

        await emit('dispute_resolved', payload, {
            tradeId: trade.trade_id,
            receiver,
            hiveAmount: formatAsset(hive, 'HIVE'),
            hbdAmount: formatAsset(hbd, 'HBD'),
            final: fullRelease
        }, now);
    };

    const expireTrades = async (_payload: Record<string, never>, ctx: ContractContext) => {
        const now = blockTimeOf(ctx);
        const rows = await state.adapter.query(
            'SELECT * FROM escrowmarket_trades WHERE status IN (?, ?, ?, ?)',
            ['pending_approval', 'active', 'shipped', 'delivered']
        );

        for (const trade of rows) {
            if (trade.status === 'pending_approval') {
                const deadline = parseChainTime(trade.ratification_deadline);

                if (deadline && deadline.getTime() <= now.getTime()) {
                    // The chain returned the funds to the buyer at the deadline.
                    await setTradeStatus(trade.trade_id, 'expired', now, { status_reason: 'not_ratified', closed_at: now.toISOString() });
                    await setListingStatus(trade.listing_id, 'open', now, 'reserved');
                    await emit('trade_expired', { tradeId: trade.trade_id }, { tradeId: trade.trade_id, reason: 'not_ratified' }, now);
                }

                continue;
            }

            const expiration = parseChainTime(trade.expiration);

            if (expiration && expiration.getTime() <= now.getTime()) {
                // Funds stay in escrow; past expiration either party may release
                // them, and the release subscription still closes the trade.
                await setTradeStatus(trade.trade_id, 'expired', now, { status_reason: 'escrow_expired' });
                await emit('trade_expired', { tradeId: trade.trade_id }, { tradeId: trade.trade_id, reason: 'escrow_expired' }, now);
            }
        }
    };

    const onApprove = async (data: any, trxId: string, blockTime: Date) => {
        const trade = await findLiveTrade(data?.from, data?.escrow_id);

        if (!trade || trade.status !== 'pending_approval' || data?.to !== trade.seller) {
            return;
        }

        const who = data?.who;

        if (who !== trade.seller && who !== account) {
            return;
        }

        if (!(await claimChainOp(`approve:${trxId}:${who}:${trade.trade_id}`, trade.trade_id, 'escrow_approve', blockTime))) {
            return;
        }

        if (data?.approve === false) {
            // A rejection by either party cancels the escrow and returns the funds.
            await setTradeStatus(trade.trade_id, 'declined', blockTime, { status_reason: `declined_by_${who === account ? 'agent' : 'seller'}`, closed_at: blockTime.toISOString() });
            await setListingStatus(trade.listing_id, 'open', blockTime, 'reserved');
            await emit('trade_declined', { tradeId: trade.trade_id }, { tradeId: trade.trade_id, who }, blockTime);
            return;
        }

        const sellerApproved = who === trade.seller ? 1 : Number(trade.seller_approved);
        const agentApproved = who === account ? 1 : Number(trade.agent_approved);
        const status = sellerApproved === 1 && agentApproved === 1 ? 'active' : 'pending_approval';

        await setTradeStatus(trade.trade_id, status, blockTime, { seller_approved: sellerApproved, agent_approved: agentApproved });
        await emit(status === 'active' ? 'trade_active' : 'trade_approved', { tradeId: trade.trade_id }, { tradeId: trade.trade_id, who }, blockTime);
    };

    const onDispute = async (data: any, trxId: string, blockTime: Date) => {
        const trade = await findLiveTrade(data?.from, data?.escrow_id);

        if (!trade || !['active', 'shipped', 'delivered', 'expired'].includes(trade.status)) {
            return;
        }

        const who = data?.who;

        if (who !== trade.buyer && who !== trade.seller) {
            return;
        }

        if (!(await claimChainOp(`dispute:${trxId}:${trade.trade_id}`, trade.trade_id, 'escrow_dispute', blockTime))) {
            return;
        }

        await setTradeStatus(trade.trade_id, 'disputed', blockTime, { disputed_by: who, disputed_at: blockTime.toISOString() });
        await emit('trade_disputed', { tradeId: trade.trade_id }, { tradeId: trade.trade_id, who }, blockTime);
    };

    const onRelease = async (data: any, trxId: string, blockTime: Date) => {
        const trade = await findLiveTrade(data?.from, data?.escrow_id);

        if (!trade || trade.status === 'pending_approval') {
            return;
        }

        const hive = parseAmountOrZero(data?.hive_amount, 'HIVE');
        const hbd = parseAmountOrZero(data?.hbd_amount, 'HBD');

        if (hive === null || hbd === null) {
            return;
        }

        const key = `release:${trxId}:${trade.trade_id}:${data?.who}:${data?.receiver}:${format(hive)}:${format(hbd)}`;

        if (!(await claimChainOp(key, trade.trade_id, 'escrow_release', blockTime))) {
            return;
        }

        const remainingHive = BigNumber.maximum(0, toBigNumber(trade.remaining_hive).minus(hive));
        const remainingHbd = BigNumber.maximum(0, toBigNumber(trade.remaining_hbd).minus(hbd));
        const empty = remainingHive.lte(0) && remainingHbd.lte(0);
        const receiver = data?.receiver;
        const amounts = { remaining_hive: format(remainingHive), remaining_hbd: format(remainingHbd) };
        const eventData = {
            tradeId: trade.trade_id,
            who: data?.who,
            receiver,
            hiveAmount: formatAsset(hive, 'HIVE'),
            hbdAmount: formatAsset(hbd, 'HBD')
        };

        if (['disputed', 'resolving', 'resolved'].includes(trade.status)) {
            // Agent releases after a dispute. resolveDispute already closed the
            // trade when it released everything; this keeps the balance exact.
            const status = empty ? 'resolved' : trade.status;
            const closedAt = empty ? (trade.closed_at ?? blockTime.toISOString()) : null;

            await setTradeStatus(trade.trade_id, status, blockTime, {
                ...amounts,
                resolution_receiver: trade.resolution_receiver ?? receiver,
                closed_at: closedAt
            });

            if (empty && trade.status !== 'resolved') {
                await setListingStatus(trade.listing_id, receiver === trade.seller ? 'sold' : 'open', blockTime, 'reserved');
            }

            await emit('escrow_released', { tradeId: trade.trade_id }, { ...eventData, final: empty }, blockTime);
            return;
        }

        if (!empty) {
            await setTradeStatus(trade.trade_id, trade.status, blockTime, amounts);
            await emit('escrow_released', { tradeId: trade.trade_id }, { ...eventData, final: false }, blockTime);
            return;
        }

        const toSeller = receiver === trade.seller;

        await setTradeStatus(trade.trade_id, toSeller ? 'completed' : 'refunded', blockTime, { ...amounts, closed_at: blockTime.toISOString() });
        await setListingStatus(trade.listing_id, toSeller ? 'sold' : 'open', blockTime, 'reserved');
        await emit(toSeller ? 'trade_completed' : 'trade_refunded', { tradeId: trade.trade_id }, { ...eventData, final: true }, blockTime);
    };

    /** Wraps a chain subscription so it only sees escrows this agent handles. */
    const track = (handler: (data: any, trxId: string, blockTime: Date) => Promise<void>) =>
        async (data: any, _blockNumber: number, _blockId: string, _prevBlockId: string, trxId: string, blockTime: Date) => {
            if (!state.active || !data || data.agent !== account) {
                return;
            }

            const time = blockTime instanceof Date && !Number.isNaN(blockTime.getTime()) ? blockTime : new Date();
            await handler(data, trxId, time);
        };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { streamer, adapter } = lifecycle;
                account = resolveContractAccount('createEscrowMarketplaceContract', options.account, lifecycle);
                state.streamer = streamer;
                state.adapter = adapter;
                await initialize();
                state.active = true;

                // escrow_approve/dispute/release carry no contract payload, so
                // they reach subscriptions rather than actions.
                if (!state.subscribed) {
                    streamer.onEscrowApprove(track(onApprove));
                    streamer.onEscrowDispute(track(onDispute));
                    streamer.onEscrowRelease(track(onRelease));
                    state.subscribed = true;
                }
            },
            destroy: async () => {
                state.active = false;
            }
        },
        actions: {
            createListing: action(createListing, {
                schema: createListingSchema,
                trigger: 'custom_json',
                guards: { rateLimit: { max: 20, windowSeconds: 3600 } },
                description: 'List an item for sale at a fixed price in HIVE or HBD. The sender is the seller.'
            }),
            cancelListing: action(cancelListing, {
                schema: listingIdSchema,
                trigger: 'custom_json',
                description: 'Withdraw a listing (seller only, while no trade is open on it).'
            }),
            openTrade: action(openTrade, {
                schema: listingIdSchema,
                trigger: 'escrow_transfer',
                description: 'Buy a listing: send escrow_transfer to the seller with this contract\'s account as agent, at least the price and the agent fee, and this call in json_meta. Invalid escrows are recorded as rejected and never ratified, so the chain returns the funds at the ratification deadline.'
            }),
            approveTrade: action(approveTrade, {
                schema: tradeRefSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'Agent only: ratify a pending escrow as the agent (when autoApprove is off, or to retry a failed approval).'
            }),
            markShipped: action(markShipped, {
                schema: tradeRefSchema,
                trigger: 'custom_json',
                description: 'Seller marks a ratified trade as shipped.'
            }),
            confirmDelivery: action(confirmDelivery, {
                schema: tradeRefSchema,
                trigger: 'custom_json',
                description: 'Buyer records delivery. Funds move only when the buyer also broadcasts escrow_release to the seller; the contract closes the trade when it sees that release on chain.'
            }),
            resolveDispute: action(resolveDispute, {
                schema: resolveDisputeSchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'Agent only: release a disputed escrow to the buyer or seller (the full balance unless amounts are given).'
            }),
            expireTrades: action(expireTrades, {
                schema: z.object({}),
                trigger: 'time',
                description: 'Scheduled sweep: marks unratified escrows past their deadline, and ratified escrows past expiration, as expired.'
            })
        }
    });
}
