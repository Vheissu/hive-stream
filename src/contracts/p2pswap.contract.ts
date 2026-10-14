import BigNumber from '../bignumber';
import { z } from 'zod';
import { getLogger } from '../logger';
import { DEFAULT_CONTRACT_PAYLOAD_IDENTIFIER } from '../defaults';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    emitContractEvent,
    identifierSchema,
    initializeTables,
    parseBlockchainAmount,
    parseJson,
    requireEscrowContext,
    requireSender,
    requireTransferContext,
    resolveContractAccount,
    toBigNumber
} from './helpers';
import { operationRecordId, type ContractContext } from '../types/hive-stream';

const DEFAULT_NAME = 'p2pswap';
const NATIVE_ASSETS = ['HIVE', 'HBD'];
const NATIVE_PRECISION = 3;
const MAX_TOKEN_PRECISION = 8;
const MAX_FEE_BPS = 2000;
const HOUR_MS = 60 * 60 * 1000;
/** The agent stops accepting a maker's payment this long before the taker's escrow ratification deadline. */
const SETTLE_MARGIN_MS = 5 * 60 * 1000;
/** A taker's escrow must give the maker at least this long to pay before the settle cut-off. */
const MIN_SETTLE_WINDOW_MS = 15 * 60 * 1000;

export interface P2PSwapContractOptions {
    name?: string;
    /**
     * The app account: escrow agent for HIVE/HBD swaps and the account that
     * holds both legs of a swap involving a Hive Engine token. Defaults to the
     * streamer username.
     */
    account?: string;
    /**
     * Fee in basis points (max 2000, default 0). Custodial swaps deduct it
     * from the maker's proceeds; escrow swaps require the taker's escrow to
     * carry at least this agent fee in the buy-side asset.
     */
    feeBps?: number;
    /** HIVE/HBD assets offers may sell or buy. Defaults to ['HIVE', 'HBD']. */
    allowedAssets?: string[];
    /** Hive Engine symbols offers may sell or buy. Defaults to [] (any symbol). */
    allowedTokens?: string[];
    /** Default and maximum offer lifetime in hours. Defaults to 72. */
    offerTtlHours?: number;
}

type SwapMode = 'escrow' | 'custodial';
type PayoutKind = 'transfer' | 'engine' | 'escrow_approve' | 'escrow_reject' | 'escrow_release';

interface IncomingPayment {
    /** Replay key for the operation that carried the payment. */
    opId: string;
    from: string;
    amount: string;
    value: BigNumber;
    asset: string;
    source: 'hive' | 'engine';
    offerId?: string;
}

interface PayoutSpec {
    id: string;
    offerId: string | null;
    kind: PayoutKind;
    recipient: string;
    amount?: string;
    asset?: string;
    memo?: string;
    details?: Record<string, unknown>;
}

const isNative = (asset: string): boolean => NATIVE_ASSETS.includes(asset);

/**
 * Hive timestamps (escrow deadlines) are UTC without a zone suffix; parsing
 * them as-is would read them as local time.
 */
function parseChainTime(value: string | undefined): Date | null {
    if (!value) {
        return null;
    }

    const text = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
    const parsed = new Date(text);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createP2PSwapContract(options: P2PSwapContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const feeBps = options.feeBps ?? 0;
    const allowedAssets = (options.allowedAssets ?? NATIVE_ASSETS).map((asset) => asset.toUpperCase());
    const allowedTokens = (options.allowedTokens ?? []).map((symbol) => symbol.toUpperCase());
    const offerTtlHours = options.offerTtlHours ?? 72;

    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_FEE_BPS) {
        throw new Error(`P2P swap feeBps must be an integer between 0 and ${MAX_FEE_BPS}`);
    }

    if (!(typeof offerTtlHours === 'number' && Number.isFinite(offerTtlHours) && offerTtlHours > 0)) {
        throw new Error('P2P swap offerTtlHours must be a positive number');
    }

    const unsupported = allowedAssets.filter((asset) => !isNative(asset));

    if (unsupported.length > 0) {
        throw new Error(`P2P swap allowedAssets only accepts HIVE and HBD (got ${unsupported.join(', ')}); list Hive Engine symbols in allowedTokens`);
    }

    const state = {
        adapter: null as any,
        streamer: null as any,
        payloadIdentifier: DEFAULT_CONTRACT_PAYLOAD_IDENTIFIER,
        active: false,
        subscribed: false
    };

    const legSchema = z.object({
        asset: assetSchema,
        amount: amountSchema
    });

    const createOfferSchema = z.object({
        offerId: identifierSchema,
        sell: legSchema,
        buy: legSchema,
        expiresAt: z.string().max(40).optional()
    });

    // Deliberately lenient: a payment with a malformed offer id must still
    // reach the handler so it is refunded instead of kept.
    const paymentSchema = z.object({
        offerId: identifierSchema.optional().catch(undefined)
    });

    const offerIdSchema = z.object({
        offerId: identifierSchema
    });

    const retrySchema = z.object({
        payoutId: z.string().min(1).max(200).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS p2pswap_offers (
                    offer_id TEXT PRIMARY KEY,
                    maker TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    sell_asset TEXT NOT NULL,
                    sell_amount TEXT NOT NULL,
                    buy_asset TEXT NOT NULL,
                    buy_amount TEXT NOT NULL,
                    fee TEXT NOT NULL,
                    status TEXT NOT NULL,
                    status_reason TEXT,
                    taker TEXT,
                    escrow_id INTEGER,
                    ratification_deadline TEXT,
                    settle_by TEXT,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS p2pswap_operations (
                    op_id TEXT PRIMARY KEY,
                    offer_id TEXT,
                    action TEXT NOT NULL,
                    sender TEXT,
                    outcome TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS p2pswap_payouts (
                    payout_id TEXT PRIMARY KEY,
                    offer_id TEXT,
                    kind TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    amount TEXT,
                    asset TEXT,
                    memo TEXT,
                    details TEXT,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            `
        ]);
    };

    const query = (sql: string, params: any[] = []): Promise<any[]> => state.adapter.query(sql, params);

    const emit = async (event: string, payload: unknown, data: Record<string, unknown>, time: Date) => {
        await emitContractEvent(state.adapter, name, event, payload, {
            action: `p2pswap_${event}`,
            data
        }, time);
    };

    const getOffer = async (offerId: string | undefined): Promise<any | null> => {
        if (!offerId) {
            return null;
        }

        const rows = await query('SELECT * FROM p2pswap_offers WHERE offer_id = ?', [offerId]);
        return rows[0] ?? null;
    };

    const setOfferStatus = async (offerId: string, status: string, time: Date, extra: Record<string, unknown> = {}) => {
        const columns = Object.keys(extra);
        const assignments = ['status = ?', 'updated_at = ?', ...columns.map((column) => `${column} = ?`)];

        await query(
            `UPDATE p2pswap_offers SET ${assignments.join(', ')} WHERE offer_id = ?`,
            [status, time.toISOString(), ...columns.map((column) => extra[column]), offerId]
        );
    };

    /**
     * Records an incoming operation. Returns false when it was already seen,
     * so a replayed block never settles or refunds the same payment twice.
     */
    const claimOperation = async (opId: string, offerId: string | undefined, actionName: string, sender: string, time: Date): Promise<boolean> => {
        const existing = await query('SELECT op_id FROM p2pswap_operations WHERE op_id = ?', [opId]);

        if (existing.length > 0) {
            getLogger().warn(`[P2PSwapContract] Operation ${opId} was already processed; ignoring the replay`);
            return false;
        }

        await query(
            'INSERT INTO p2pswap_operations (op_id, offer_id, action, sender, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [opId, offerId ?? null, actionName, sender, 'received', time.toISOString()]
        );

        return true;
    };

    const setOperationOutcome = async (opId: string, outcome: string) => {
        await query('UPDATE p2pswap_operations SET outcome = ? WHERE op_id = ?', [outcome, opId]);
    };

    const decimalsOf = (asset: string, value: BigNumber): number => isNative(asset)
        ? NATIVE_PRECISION
        : Math.min(value.decimalPlaces() ?? 0, MAX_TOKEN_PRECISION);

    const formatAmount = (value: BigNumber, asset: string, decimals?: number): string => isNative(asset)
        ? value.toFixed(NATIVE_PRECISION, BigNumber.ROUND_DOWN)
        : value.toFixed(decimals ?? decimalsOf(asset, value), BigNumber.ROUND_DOWN);

    /** Fee on an amount, rounded down to the amount's precision so nobody pays more than feeBps. */
    const computeFee = (amount: BigNumber, asset: string): { fee: BigNumber; net: BigNumber; decimals: number } => {
        const decimals = decimalsOf(asset, amount);
        const fee = amount.multipliedBy(feeBps).dividedBy(10000).decimalPlaces(decimals, BigNumber.ROUND_DOWN);
        return { fee, net: amount.minus(fee), decimals };
    };

    const broadcastPayout = async (row: any) => {
        if (!state.streamer) {
            throw new Error('P2P swap contract is not attached to a streamer');
        }

        const details = parseJson<Record<string, any>>(row.details, {});

        switch (row.kind as PayoutKind) {
            case 'transfer':
                await state.streamer.transferHiveTokens(account, row.recipient, row.amount, row.asset, row.memo ?? '');
                return;
            case 'engine':
                await state.streamer.transferHiveEngineTokens(account, row.recipient, row.asset, row.amount, row.memo ?? '');
                return;
            case 'escrow_approve':
            case 'escrow_reject':
                await state.streamer.escrowApprove({
                    from: details.from,
                    to: details.to,
                    agent: account,
                    who: account,
                    escrow_id: Number(details.escrowId),
                    approve: row.kind === 'escrow_approve'
                });
                return;
            case 'escrow_release':
                await state.streamer.escrowRelease({
                    from: details.from,
                    to: details.to,
                    agent: account,
                    who: account,
                    receiver: row.recipient,
                    escrow_id: Number(details.escrowId),
                    hive_amount: details.hiveAmount,
                    hbd_amount: details.hbdAmount
                });
                return;
            default:
                throw new Error(`Unknown payout kind ${row.kind}`);
        }
    };

    /**
     * Broadcasts a recorded payout. The row is marked 'pending' before the
     * broadcast and 'paid' after; a failed broadcast leaves it 'failed' for
     * retryPayouts. Never throws for a broadcast failure, so the offer's state
     * change that queued the payout is kept.
     */
    const executePayout = async (row: any, time: Date): Promise<'paid' | 'failed'> => {
        await query(
            'UPDATE p2pswap_payouts SET status = ?, attempts = attempts + 1, updated_at = ? WHERE payout_id = ?',
            ['pending', time.toISOString(), row.payout_id]
        );

        try {
            await broadcastPayout(row);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            await query(
                'UPDATE p2pswap_payouts SET status = ?, last_error = ?, updated_at = ? WHERE payout_id = ?',
                ['failed', message, time.toISOString(), row.payout_id]
            );

            getLogger().error(`[P2PSwapContract] Payout ${row.payout_id} failed; retry it with retryPayouts after checking the account history`, message);

            await emit('payout_failed', { payoutId: row.payout_id }, {
                payoutId: row.payout_id,
                offerId: row.offer_id,
                kind: row.kind,
                recipient: row.recipient,
                amount: row.amount,
                asset: row.asset,
                error: message
            }, time);

            return 'failed';
        }

        await query(
            'UPDATE p2pswap_payouts SET status = ?, last_error = NULL, updated_at = ? WHERE payout_id = ?',
            ['paid', time.toISOString(), row.payout_id]
        );

        await emit('payout_sent', { payoutId: row.payout_id }, {
            payoutId: row.payout_id,
            offerId: row.offer_id,
            kind: row.kind,
            recipient: row.recipient,
            amount: row.amount,
            asset: row.asset
        }, time);

        return 'paid';
    };

    /** Records a payout once (by id) and broadcasts it. A known id is never sent again here. */
    const queuePayout = async (spec: PayoutSpec, time: Date): Promise<string> => {
        const existing = await query('SELECT status FROM p2pswap_payouts WHERE payout_id = ?', [spec.id]);

        if (existing.length > 0) {
            getLogger().warn(`[P2PSwapContract] Payout ${spec.id} already exists (${existing[0].status}); not sending it again`);
            return existing[0].status;
        }

        const now = time.toISOString();

        await query(
            `INSERT INTO p2pswap_payouts (
                payout_id, offer_id, kind, recipient, amount, asset, memo, details, status, attempts, last_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                spec.id, spec.offerId, spec.kind, spec.recipient, spec.amount ?? null, spec.asset ?? null,
                spec.memo ?? null, spec.details ? JSON.stringify(spec.details) : null, 'pending', 0, null, now, now
            ]
        );

        const rows = await query('SELECT * FROM p2pswap_payouts WHERE payout_id = ?', [spec.id]);
        return executePayout(rows[0], time);
    };

    const sendAsset = (id: string, offerId: string | null, recipient: string, amount: string, asset: string, memo: string, time: Date) => queuePayout({
        id,
        offerId,
        kind: isNative(asset) ? 'transfer' : 'engine',
        recipient,
        amount,
        asset,
        memo
    }, time);

    const refundPayment = async (payment: IncomingPayment, actionName: string, reason: string, time: Date) => {
        await queuePayout({
            id: `refund:${payment.opId}`,
            offerId: payment.offerId ?? null,
            kind: payment.source === 'engine' ? 'engine' : 'transfer',
            recipient: payment.from,
            amount: payment.amount,
            asset: payment.asset,
            memo: `[P2P swap refund] ${reason}`.slice(0, 2000)
        }, time);

        await setOperationOutcome(payment.opId, 'refunded');
        await emit('payment_refunded', { offerId: payment.offerId }, {
            offerId: payment.offerId ?? null,
            action: actionName,
            from: payment.from,
            amount: payment.amount,
            asset: payment.asset,
            source: payment.source,
            reason,
            operationId: payment.opId
        }, time);
    };

    const isExpired = (offer: any, time: Date): boolean => time.getTime() >= new Date(offer.expires_at).getTime();

    const matchesLeg = (payment: IncomingPayment, asset: string, amount: string): boolean =>
        payment.asset === asset && payment.value.isEqualTo(amount);

    // ─── Custodial leg (any swap involving a Hive Engine token) ──────────

    const handleFund = async (payment: IncomingPayment, time: Date) => {
        if (!(await claimOperation(payment.opId, payment.offerId, 'fundOffer', payment.from, time))) {
            return;
        }

        const offer = await getOffer(payment.offerId);
        let reason: string | null = null;

        if (!offer) {
            reason = `Unknown offer ${payment.offerId ?? '(missing offerId)'}`;
        } else if (offer.mode !== 'custodial') {
            reason = 'HIVE/HBD offers settle through Hive escrow; the maker does not deposit';
        } else if (offer.maker !== payment.from) {
            reason = `Only @${offer.maker} can fund offer ${offer.offer_id}`;
        } else if (offer.status !== 'open') {
            reason = `Offer ${offer.offer_id} is ${offer.status}`;
        } else if (isExpired(offer, time)) {
            reason = `Offer ${offer.offer_id} has expired`;
        } else if (!matchesLeg(payment, offer.sell_asset, offer.sell_amount)) {
            reason = `Offer ${offer.offer_id} must be funded with exactly ${offer.sell_amount} ${offer.sell_asset}`;
        }

        if (reason) {
            await refundPayment(payment, 'fundOffer', reason, time);
            return;
        }

        await setOfferStatus(offer.offer_id, 'funded', time);
        await setOperationOutcome(payment.opId, 'funded');
        await emit('offer_funded', { offerId: offer.offer_id }, {
            offerId: offer.offer_id,
            maker: offer.maker,
            amount: offer.sell_amount,
            asset: offer.sell_asset,
            operationId: payment.opId
        }, time);
    };

    const handleCustodialTake = async (payment: IncomingPayment, time: Date) => {
        if (!(await claimOperation(payment.opId, payment.offerId, 'takeOffer', payment.from, time))) {
            return;
        }

        const offer = await getOffer(payment.offerId);
        let reason: string | null = null;

        if (!offer) {
            reason = `Unknown offer ${payment.offerId ?? '(missing offerId)'}`;
        } else if (offer.mode !== 'custodial') {
            reason = `Offer ${offer.offer_id} settles through Hive escrow: send an escrow_transfer to @${offer.maker} with @${account} as agent`;
        } else if (offer.status === 'open') {
            reason = `Offer ${offer.offer_id} is not funded yet`;
        } else if (offer.status !== 'funded') {
            reason = `Offer ${offer.offer_id} is ${offer.status}`;
        } else if (isExpired(offer, time)) {
            reason = `Offer ${offer.offer_id} has expired`;
        } else if (offer.maker === payment.from) {
            reason = 'Makers cannot take their own offer';
        } else if (!matchesLeg(payment, offer.buy_asset, offer.buy_amount)) {
            reason = `Offer ${offer.offer_id} must be taken with exactly ${offer.buy_amount} ${offer.buy_asset}`;
        }

        if (reason) {
            await refundPayment(payment, 'takeOffer', reason, time);
            return;
        }

        const { fee, net, decimals } = computeFee(toBigNumber(offer.buy_amount), offer.buy_asset);
        const makerProceeds = formatAmount(net, offer.buy_asset, decimals);
        const feeText = formatAmount(fee, offer.buy_asset, decimals);

        await setOfferStatus(offer.offer_id, 'filled', time, { taker: payment.from, fee: `${feeText} ${offer.buy_asset}` });
        await setOperationOutcome(payment.opId, 'filled');
        await emit('offer_filled', { offerId: offer.offer_id }, {
            offerId: offer.offer_id,
            mode: 'custodial',
            maker: offer.maker,
            taker: payment.from,
            sell: { asset: offer.sell_asset, amount: offer.sell_amount },
            buy: { asset: offer.buy_asset, amount: offer.buy_amount },
            fee: feeText,
            makerProceeds,
            operationId: payment.opId
        }, time);

        await sendAsset(`${offer.offer_id}:taker`, offer.offer_id, payment.from, offer.sell_amount, offer.sell_asset,
            `[P2P swap] Offer ${offer.offer_id} filled`, time);
        await sendAsset(`${offer.offer_id}:maker`, offer.offer_id, offer.maker, makerProceeds, offer.buy_asset,
            `[P2P swap] Offer ${offer.offer_id} filled`, time);
    };

    const paymentFromTransfer = (payload: z.infer<typeof paymentSchema>, ctx: ContractContext): IncomingPayment => {
        const transfer = requireTransferContext(ctx);
        const sender = requireSender(ctx);

        if (transfer.to !== account) {
            // Memo-wrapped transfers to other accounts can still reach a
            // contract when guards are overridden; they are not ours.
            throw new Error(`P2P swap payments must be sent to ${account}`);
        }

        return {
            opId: `transfer:${operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex)}`,
            from: sender,
            amount: transfer.amount,
            value: toBigNumber(transfer.amount),
            asset: transfer.asset,
            source: 'hive',
            offerId: payload.offerId
        };
    };

    // ─── Escrow-settled swaps (HIVE <-> HBD) ─────────────────────────────

    const escrowAmounts = (escrow: NonNullable<ContractContext['escrow']>): Record<string, BigNumber> | null => {
        const amounts: Record<string, BigNumber> = { HIVE: new BigNumber(0), HBD: new BigNumber(0) };

        try {
            for (const raw of [escrow.hiveAmount, escrow.hbdAmount]) {
                if (raw) {
                    const parsed = parseBlockchainAmount(raw);
                    amounts[parsed.asset] = (amounts[parsed.asset] ?? new BigNumber(0)).plus(parsed.value);
                }
            }
        } catch (error) {
            return null;
        }

        return amounts;
    };

    const takeViaEscrow = async (payload: z.infer<typeof paymentSchema>, ctx: ContractContext) => {
        const escrow = requireEscrowContext(ctx);
        const taker = requireSender(ctx);

        if (escrow.agent !== account) {
            getLogger().warn(`[P2PSwapContract] Escrow ${escrow.from}/${escrow.escrowId} names @${escrow.agent} as agent, not @${account}; ignoring it`);
            return;
        }

        const time = blockTimeOf(ctx);
        const opId = `escrow:${operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex)}`;

        if (!(await claimOperation(opId, payload.offerId, 'takeOffer', taker, time))) {
            return;
        }

        const offer = await getOffer(payload.offerId);
        const amounts = escrowAmounts(escrow);
        const ratificationDeadline = parseChainTime(escrow.ratificationDeadline);
        let reason: string | null = null;

        if (!offer) {
            reason = `Unknown offer ${payload.offerId ?? '(missing offerId)'}`;
        } else if (offer.mode !== 'escrow') {
            reason = `Offer ${offer.offer_id} involves a Hive Engine token; pay @${account} directly`;
        } else if (offer.status !== 'open') {
            reason = `Offer ${offer.offer_id} is ${offer.status}`;
        } else if (isExpired(offer, time)) {
            reason = `Offer ${offer.offer_id} has expired`;
        } else if (offer.maker === taker) {
            reason = 'Makers cannot take their own offer';
        } else if (escrow.to !== offer.maker) {
            reason = `The escrow must be addressed to the maker @${offer.maker}`;
        } else if (!amounts) {
            reason = 'Escrow amounts could not be read';
        } else {
            const otherAsset = offer.buy_asset === 'HIVE' ? 'HBD' : 'HIVE';

            if (!amounts[offer.buy_asset].isEqualTo(offer.buy_amount) || !amounts[otherAsset].isZero()) {
                reason = `The escrow must hold exactly ${offer.buy_amount} ${offer.buy_asset}`;
            } else if (feeBps > 0) {
                const required = computeFee(toBigNumber(offer.buy_amount), offer.buy_asset).fee;
                let paidFee: { asset: string; value: BigNumber } | null = null;

                try {
                    paidFee = escrow.fee ? parseBlockchainAmount(escrow.fee) : null;
                } catch (error) {
                    paidFee = null;
                }

                if (!paidFee || paidFee.asset !== offer.buy_asset || paidFee.value.lt(required)) {
                    reason = `The escrow agent fee must be at least ${formatAmount(required, offer.buy_asset)} ${offer.buy_asset}`;
                }
            }

            if (!reason && (!ratificationDeadline || ratificationDeadline.getTime() - SETTLE_MARGIN_MS < time.getTime() + MIN_SETTLE_WINDOW_MS)) {
                reason = `The escrow ratification deadline must be at least ${Math.round((MIN_SETTLE_WINDOW_MS + SETTLE_MARGIN_MS) / 60000)} minutes away`;
            }
        }

        if (reason) {
            // Rejecting as agent cancels the escrow and returns everything to the taker.
            await queuePayout({
                id: `reject:${opId}`,
                offerId: offer?.offer_id ?? payload.offerId ?? null,
                kind: 'escrow_reject',
                recipient: taker,
                memo: reason,
                details: { from: escrow.from, to: escrow.to, escrowId: escrow.escrowId }
            }, time);
            await setOperationOutcome(opId, 'rejected');
            await emit('escrow_rejected', { offerId: payload.offerId }, {
                offerId: payload.offerId ?? null,
                taker,
                escrowId: escrow.escrowId,
                reason,
                operationId: opId
            }, time);
            return;
        }

        const settleBy = new Date(ratificationDeadline!.getTime() - SETTLE_MARGIN_MS);

        await setOfferStatus(offer.offer_id, 'taken', time, {
            taker,
            escrow_id: escrow.escrowId,
            ratification_deadline: ratificationDeadline!.toISOString(),
            settle_by: settleBy.toISOString(),
            fee: escrow.fee ?? '0.000 HIVE'
        });
        await setOperationOutcome(opId, 'taken');
        await emit('offer_taken', { offerId: offer.offer_id }, {
            offerId: offer.offer_id,
            maker: offer.maker,
            taker,
            escrowId: escrow.escrowId,
            settleBy: settleBy.toISOString(),
            makerOwes: { asset: offer.sell_asset, amount: offer.sell_amount, to: taker },
            operationId: opId
        }, time);
    };

    const settle = async (payload: z.infer<typeof paymentSchema>, ctx: ContractContext) => {
        const transfer = requireTransferContext(ctx);
        const sender = requireSender(ctx);
        const time = blockTimeOf(ctx);
        const opId = `transfer:${operationRecordId(ctx.transaction.id, ctx.transaction.operationIndex)}`;

        if (!(await claimOperation(opId, payload.offerId, 'settle', sender, time))) {
            return;
        }

        const offer = await getOffer(payload.offerId);
        let reason: string | null = null;

        if (!offer) {
            reason = `Unknown offer ${payload.offerId ?? '(missing offerId)'}`;
        } else if (offer.mode !== 'escrow') {
            reason = `Offer ${offer.offer_id} does not settle through Hive escrow`;
        } else if (offer.maker !== sender) {
            reason = `Only the maker @${offer.maker} settles offer ${offer.offer_id}`;
        } else if (offer.status !== 'taken') {
            reason = `Offer ${offer.offer_id} is ${offer.status}`;
        } else if (transfer.to !== offer.taker) {
            reason = `Settlement must be paid to the taker @${offer.taker}`;
        } else if (transfer.asset !== offer.sell_asset || toBigNumber(transfer.amount).lt(offer.sell_amount)) {
            reason = `Settlement must be at least ${offer.sell_amount} ${offer.sell_asset}`;
        } else if (time.getTime() >= new Date(offer.ratification_deadline).getTime()) {
            reason = `The taker's escrow ratification deadline has passed`;
        }

        if (reason) {
            if (transfer.to === account && sender !== account) {
                // Only money sent to the app account is the app's to return.
                await refundPayment({
                    opId,
                    from: sender,
                    amount: transfer.amount,
                    value: toBigNumber(transfer.amount),
                    asset: transfer.asset,
                    source: 'hive',
                    offerId: payload.offerId
                }, 'settle', reason, time);
                return;
            }

            await setOperationOutcome(opId, 'ignored');
            await emit('settlement_rejected', { offerId: payload.offerId }, {
                offerId: payload.offerId ?? null,
                from: sender,
                to: transfer.to,
                amount: transfer.amount,
                asset: transfer.asset,
                reason,
                operationId: opId
            }, time);
            return;
        }

        await setOfferStatus(offer.offer_id, 'settled', time);
        await setOperationOutcome(opId, 'settled');
        await emit('offer_filled', { offerId: offer.offer_id }, {
            offerId: offer.offer_id,
            mode: 'escrow',
            maker: offer.maker,
            taker: offer.taker,
            sell: { asset: offer.sell_asset, amount: offer.sell_amount },
            buy: { asset: offer.buy_asset, amount: offer.buy_amount },
            escrowId: Number(offer.escrow_id),
            operationId: opId
        }, time);

        // Approving as agent is what lets the taker's escrow reach the maker.
        await queuePayout({
            id: `${offer.offer_id}:approve`,
            offerId: offer.offer_id,
            kind: 'escrow_approve',
            recipient: offer.maker,
            details: { from: offer.taker, to: offer.maker, escrowId: Number(offer.escrow_id) }
        }, time);
    };

    const escrowReleaseAmounts = (offer: any) => ({
        hiveAmount: offer.buy_asset === 'HIVE' ? `${offer.buy_amount} HIVE` : '0.000 HIVE',
        hbdAmount: offer.buy_asset === 'HBD' ? `${offer.buy_amount} HBD` : '0.000 HBD'
    });

    /**
     * Hive only lets the agent release a disputed escrow. A dispute on a
     * settled offer (the maker already paid) is resolved for the maker.
     */
    const onEscrowDispute = async (data: any, blockTime: Date) => {
        if (!state.active || data?.agent !== account) {
            return;
        }

        const rows = await query(
            'SELECT * FROM p2pswap_offers WHERE mode = ? AND taker = ? AND escrow_id = ? AND maker = ?',
            ['escrow', data.from, Number(data.escrow_id), data.to]
        );
        const offer = rows[0];

        if (!offer) {
            return;
        }

        const time = blockTime instanceof Date ? blockTime : new Date();

        await emit('escrow_disputed', { offerId: offer.offer_id }, {
            offerId: offer.offer_id,
            who: data.who,
            status: offer.status
        }, time);

        if (offer.status !== 'settled') {
            return;
        }

        await queuePayout({
            id: `${offer.offer_id}:release`,
            offerId: offer.offer_id,
            kind: 'escrow_release',
            recipient: offer.maker,
            details: { from: offer.taker, to: offer.maker, escrowId: Number(offer.escrow_id), ...escrowReleaseAmounts(offer) }
        }, time);
    };

    // ─── Hive Engine payments ────────────────────────────────────────────

    const onHiveEngine = async (
        contractName: string,
        contractAction: string,
        contractPayload: any,
        sender: string,
        trxId: string,
        blockTime: Date
    ) => {
        if (!state.active || contractName !== 'tokens' || contractAction !== 'transfer') {
            return;
        }

        if (!contractPayload || contractPayload.to !== account || !sender || sender === account) {
            return;
        }

        const memo = parseJson<any>(contractPayload.memo, null);
        const wrapper = memo && typeof memo === 'object' ? memo[state.payloadIdentifier] : null;

        if (!wrapper || typeof wrapper !== 'object' || wrapper.contract !== name) {
            return;
        }

        const symbol = String(contractPayload.symbol ?? '').toUpperCase();
        const quantity = String(contractPayload.quantity ?? '');
        let value: BigNumber;

        try {
            value = toBigNumber(quantity);
        } catch (error) {
            getLogger().warn(`[P2PSwapContract] Ignoring Hive Engine transfer ${trxId} with quantity '${quantity}'`);
            return;
        }

        const actionName = typeof wrapper.action === 'string' ? wrapper.action : '';
        const offerIdResult = identifierSchema.safeParse(wrapper.payload?.offerId);
        const offerId = offerIdResult.success ? offerIdResult.data : undefined;
        const time = blockTime instanceof Date ? blockTime : new Date();
        const payment: IncomingPayment = {
            opId: `engine:${trxId}:${symbol}:${quantity}:${actionName}:${offerId ?? ''}`,
            from: sender,
            amount: quantity,
            value,
            asset: symbol,
            source: 'engine',
            offerId
        };

        if (actionName === 'fundOffer') {
            await handleFund(payment, time);
            return;
        }

        if (actionName === 'takeOffer') {
            await handleCustodialTake(payment, time);
            return;
        }

        if (await claimOperation(payment.opId, offerId, actionName || '(none)', sender, time)) {
            await refundPayment(payment, actionName, `Unknown ${name} action '${actionName}' for a token payment`, time);
        }
    };

    // ─── Actions ─────────────────────────────────────────────────────────

    const normalizeLeg = (leg: z.infer<typeof legSchema>, label: string): { asset: string; amount: string } => {
        const asset = leg.asset.toUpperCase();
        const value = toBigNumber(leg.amount);

        if (value.lte(0)) {
            throw new Error(`${label} amount must be greater than zero`);
        }

        if (isNative(asset)) {
            if (!allowedAssets.includes(asset)) {
                throw new Error(`${asset} is not accepted by this swap desk`);
            }

            if ((value.decimalPlaces() ?? 0) > NATIVE_PRECISION) {
                throw new Error(`${asset} amounts support at most ${NATIVE_PRECISION} decimal places`);
            }

            return { asset, amount: value.toFixed(NATIVE_PRECISION) };
        }

        if (allowedTokens.length > 0 && !allowedTokens.includes(asset)) {
            throw new Error(`Token ${asset} is not accepted by this swap desk`);
        }

        if ((value.decimalPlaces() ?? 0) > MAX_TOKEN_PRECISION) {
            throw new Error(`Token amounts support at most ${MAX_TOKEN_PRECISION} decimal places`);
        }

        return { asset, amount: value.toFixed() };
    };

    const createOffer = async (payload: z.infer<typeof createOfferSchema>, ctx: ContractContext) => {
        const maker = requireSender(ctx);
        const time = blockTimeOf(ctx);
        const sell = normalizeLeg(payload.sell, 'sell');
        const buy = normalizeLeg(payload.buy, 'buy');

        if (sell.asset === buy.asset) {
            throw new Error('An offer must swap two different assets');
        }

        const maxExpiry = time.getTime() + offerTtlHours * HOUR_MS;
        let expiresAt = new Date(maxExpiry);

        if (payload.expiresAt) {
            const requested = new Date(payload.expiresAt);

            if (Number.isNaN(requested.getTime())) {
                throw new Error(`Invalid expiresAt: ${payload.expiresAt}`);
            }

            if (requested.getTime() <= time.getTime()) {
                throw new Error('expiresAt must be in the future');
            }

            if (requested.getTime() > maxExpiry) {
                throw new Error(`Offers can stay open for at most ${offerTtlHours} hours`);
            }

            expiresAt = requested;
        }

        if (await getOffer(payload.offerId)) {
            throw new Error(`Offer ${payload.offerId} already exists`);
        }

        const mode: SwapMode = isNative(sell.asset) && isNative(buy.asset) ? 'escrow' : 'custodial';
        const now = time.toISOString();

        await query(
            `INSERT INTO p2pswap_offers (
                offer_id, maker, mode, sell_asset, sell_amount, buy_asset, buy_amount, fee, status, status_reason,
                taker, escrow_id, ratification_deadline, settle_by, expires_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.offerId, maker, mode, sell.asset, sell.amount, buy.asset, buy.amount, '0', 'open', null,
                null, null, null, null, expiresAt.toISOString(), now, now
            ]
        );

        await emit('offer_created', payload, {
            offerId: payload.offerId,
            maker,
            mode,
            sell,
            buy,
            feeBps,
            expiresAt: expiresAt.toISOString()
        }, time);
    };

    const fundOffer = async (payload: z.infer<typeof paymentSchema>, ctx: ContractContext) => {
        await handleFund(paymentFromTransfer(payload, ctx), blockTimeOf(ctx));
    };

    const takeOffer = async (payload: z.infer<typeof paymentSchema>, ctx: ContractContext) => {
        if (ctx.trigger === 'escrow_transfer') {
            await takeViaEscrow(payload, ctx);
            return;
        }

        await handleCustodialTake(paymentFromTransfer(payload, ctx), blockTimeOf(ctx));
    };

    const cancelOffer = async (payload: z.infer<typeof offerIdSchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);
        const time = blockTimeOf(ctx);
        const offer = await getOffer(payload.offerId);

        if (!offer) {
            throw new Error(`Offer ${payload.offerId} does not exist`);
        }

        if (offer.maker !== sender) {
            throw new Error(`Only the maker @${offer.maker} can cancel offer ${offer.offer_id}`);
        }

        if (offer.status !== 'open' && offer.status !== 'funded') {
            throw new Error(`Offer ${offer.offer_id} is ${offer.status} and can no longer be cancelled`);
        }

        await setOfferStatus(offer.offer_id, 'cancelled', time, { status_reason: 'Cancelled by maker' });
        await emit('offer_cancelled', payload, { offerId: offer.offer_id, maker: offer.maker, refunded: offer.status === 'funded' }, time);

        if (offer.status === 'funded') {
            await sendAsset(`${offer.offer_id}:refund`, offer.offer_id, offer.maker, offer.sell_amount, offer.sell_asset,
                `[P2P swap] Offer ${offer.offer_id} cancelled`, time);
        }
    };

    const expireOffers = async (_payload: Record<string, never>, ctx: ContractContext) => {
        const time = blockTimeOf(ctx);
        const now = time.toISOString();

        const stale = await query(
            'SELECT * FROM p2pswap_offers WHERE status IN (?, ?) AND expires_at <= ? ORDER BY created_at ASC',
            ['open', 'funded', now]
        );

        for (const offer of stale) {
            await setOfferStatus(offer.offer_id, 'expired', time, { status_reason: 'Expired untaken' });
            await emit('offer_expired', { offerId: offer.offer_id }, { offerId: offer.offer_id, maker: offer.maker, refunded: offer.status === 'funded' }, time);

            if (offer.status === 'funded') {
                await sendAsset(`${offer.offer_id}:refund`, offer.offer_id, offer.maker, offer.sell_amount, offer.sell_asset,
                    `[P2P swap] Offer ${offer.offer_id} expired`, time);
            }
        }

        const lapsed = await query(
            'SELECT * FROM p2pswap_offers WHERE status = ? AND settle_by <= ? ORDER BY created_at ASC',
            ['taken', now]
        );

        for (const offer of lapsed) {
            // Before the ratification deadline the agent rejects the escrow so
            // the taker is repaid at once; after it Hive has already returned it.
            const agentReturns = time.getTime() < new Date(offer.ratification_deadline).getTime();

            await setOfferStatus(offer.offer_id, 'lapsed', time, { status_reason: 'Maker did not pay before the settle deadline' });
            await emit('offer_lapsed', { offerId: offer.offer_id }, {
                offerId: offer.offer_id,
                maker: offer.maker,
                taker: offer.taker,
                escrowId: Number(offer.escrow_id),
                returnedBy: agentReturns ? 'agent' : 'chain'
            }, time);

            if (agentReturns) {
                await queuePayout({
                    id: `${offer.offer_id}:reject`,
                    offerId: offer.offer_id,
                    kind: 'escrow_reject',
                    recipient: offer.taker,
                    memo: 'Maker did not pay before the settle deadline',
                    details: { from: offer.taker, to: offer.maker, escrowId: Number(offer.escrow_id) }
                }, time);
            }
        }
    };

    const retryPayouts = async (payload: z.infer<typeof retrySchema>, ctx: ContractContext) => {
        const sender = requireSender(ctx);

        if (sender !== account) {
            throw new Error(`Only @${account} can retry payouts`);
        }

        const time = blockTimeOf(ctx);
        let rows: any[];

        if (payload.payoutId) {
            rows = await query('SELECT * FROM p2pswap_payouts WHERE payout_id = ?', [payload.payoutId]);

            if (rows.length === 0) {
                throw new Error(`Payout ${payload.payoutId} does not exist`);
            }

            if (rows[0].status !== 'failed') {
                throw new Error(`Payout ${payload.payoutId} is ${rows[0].status}`);
            }
        } else {
            rows = await query('SELECT * FROM p2pswap_payouts WHERE status = ? ORDER BY created_at ASC', ['failed']);
        }

        for (const row of rows) {
            await executePayout(row, time);
        }
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                account = resolveContractAccount('createP2PSwapContract', options.account, lifecycle);
                state.adapter = lifecycle.adapter;
                state.streamer = lifecycle.streamer;
                state.payloadIdentifier = lifecycle.config?.PAYLOAD_IDENTIFIER
                    || lifecycle.streamer?.getConfig?.()?.PAYLOAD_IDENTIFIER
                    || DEFAULT_CONTRACT_PAYLOAD_IDENTIFIER;
                await initialize();
                state.active = true;

                if (!state.subscribed && lifecycle.streamer) {
                    state.subscribed = true;
                    lifecycle.streamer.onHiveEngine((contractName, contractAction, contractPayload, sender, _data, _blockNumber, _blockId, _prevBlockId, trxId, blockTime) =>
                        onHiveEngine(contractName, contractAction, contractPayload, sender, trxId, blockTime));
                    lifecycle.streamer.onEscrowDispute((data, _blockNumber, _blockId, _prevBlockId, _trxId, blockTime) =>
                        onEscrowDispute(data, blockTime));
                }
            },
            destroy: async () => {
                state.active = false;
            }
        },
        actions: {
            createOffer: action(createOffer, {
                schema: createOfferSchema,
                trigger: 'custom_json',
                description: 'Post an all-or-nothing offer to swap sell for buy. HIVE<->HBD offers settle through Hive escrow; offers with a Hive Engine token settle through the app account.'
            }),
            fundOffer: action(fundOffer, {
                schema: paymentSchema,
                trigger: 'transfer',
                description: 'Maker deposits the sell side of a custodial offer (a HIVE/HBD transfer here, or a Hive Engine transfer with the same memo). Mismatched deposits are refunded.'
            }),
            takeOffer: action(takeOffer, {
                schema: paymentSchema,
                trigger: ['transfer', 'escrow_transfer'],
                description: 'Take an offer. Escrow offers: an escrow_transfer of the buy side to the maker with the app as agent. Custodial offers: pay the buy side to the app (transfer or Hive Engine transfer). Mismatched payments are refunded or the escrow rejected.'
            }),
            settle: action(settle, {
                schema: paymentSchema,
                trigger: 'transfer',
                guards: { allowedRecipients: ['*'] },
                description: 'Maker pays the sell side of a taken escrow offer straight to the taker; the app then approves the taker\'s escrow as agent.'
            }),
            cancelOffer: action(cancelOffer, {
                schema: offerIdSchema,
                trigger: 'custom_json',
                description: 'Maker cancels an untaken offer; a funded custodial offer is refunded.'
            }),
            expireOffers: action(expireOffers, {
                schema: z.object({}),
                trigger: 'time',
                description: 'Scheduled: expire untaken offers (refunding deposits) and return escrows whose maker did not pay in time.'
            }),
            retryPayouts: action(retryPayouts, {
                schema: retrySchema,
                trigger: 'custom_json',
                requiresActiveKey: true,
                description: 'App account only: re-broadcast failed payouts, refunds and escrow approvals (all, or one payoutId) after checking the account history.'
            })
        }
    });
}
