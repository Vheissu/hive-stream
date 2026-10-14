import BigNumber from '../bignumber';
import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    blockTimeOf,
    createContractState,
    emitContractEvent,
    getIncomingPayment,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireSender,
    resolveContractAccount,
    toBigNumber
} from './helpers';

const DEFAULT_NAME = 'bookings';
const PRECISION = 3;

export interface BookingContractOptions {
    name?: string;
    /**
     * Account that receives reservation payments and refunds rejected ones
     * (wrong amount or asset, overlaps, inactive listings). Refunds are
     * signed with the app's active key, so this must be the app account.
     * Defaults to the streamer username.
     */
    account?: string;
}

export function createBookingContract(options: BookingContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    // Resolved in the create hook: options.account, else the streamer username.
    let account = options.account || '';
    const state = createContractState({ streamer: null as any });

    const createListingSchema = z.object({
        listingId: identifierSchema,
        title: z.string().min(3).max(140),
        price: amountSchema,
        asset: assetSchema,
        durationMinutes: z.number().int().min(15).max(24 * 60),
        cancellationHours: z.number().int().min(0).max(720).optional(),
        metadata: z.record(z.string(), z.any()).optional()
    });

    const reserveSchema = z.object({
        listingId: identifierSchema,
        reservationId: identifierSchema,
        startAt: z.string(),
        note: z.string().max(280).optional()
    });

    const reservationSchema = z.object({
        reservationId: identifierSchema,
        reason: z.string().max(280).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS booking_listings (
                    listing_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    duration_minutes INTEGER NOT NULL,
                    cancellation_hours INTEGER NOT NULL,
                    active INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS booking_reservations (
                    reservation_id TEXT PRIMARY KEY,
                    listing_id TEXT NOT NULL,
                    booker TEXT NOT NULL,
                    start_at DATETIME NOT NULL,
                    end_at DATETIME NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    note TEXT,
                    status TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createListing = async (payload: z.infer<typeof createListingSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT listing_id FROM booking_listings WHERE listing_id = ?', [payload.listingId]);
        if (existing.length > 0) {
            throw new Error(`Listing ${payload.listingId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO booking_listings (
                listing_id, owner, title, price, asset, duration_minutes, cancellation_hours, active, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.listingId,
                owner,
                payload.title,
                payload.price,
                payload.asset,
                payload.durationMinutes,
                payload.cancellationHours || 0,
                1,
                JSON.stringify(payload.metadata || {}),
                blockTimeOf(ctx)
            ]
        );

        await emitContractEvent(state.adapter, name, 'createListing', payload, {
            action: 'booking_listing_created',
            data: {
                listingId: payload.listingId,
                owner
            }
        }, blockTimeOf(ctx));
    };

    const reserve = async (payload: z.infer<typeof reserveSchema>, ctx: any) => {
        const booker = requireSender(ctx);
        const payment = getIncomingPayment(ctx);

        // The payment has already arrived, so every rejection sends it back
        // instead of throwing (which would keep the booker's money).
        const refund = async (reason: string) => {
            if (!state.streamer) {
                throw new Error('Booking contract is not attached to a streamer');
            }

            const amount = toBigNumber(payment.amount).toFixed(PRECISION, BigNumber.ROUND_DOWN);
            await state.streamer.transferHiveTokens(account, booker, amount, payment.asset, `[Refund] ${reason}`);
            await emitContractEvent(state.adapter, name, 'reserve', payload, {
                action: 'booking_refunded',
                data: {
                    listingId: payload.listingId,
                    reservationId: payload.reservationId,
                    booker,
                    amount,
                    asset: payment.asset,
                    reason
                }
            }, blockTimeOf(ctx));
        };

        const listings = await state.adapter.query('SELECT * FROM booking_listings WHERE listing_id = ?', [payload.listingId]);
        if (listings.length === 0) {
            await refund(`Listing ${payload.listingId} does not exist`);
            return;
        }

        const listing = listings[0];
        if (!Number(listing.active)) {
            await refund('Listing is not active');
            return;
        }

        const startAt = new Date(payload.startAt);
        if (Number.isNaN(startAt.getTime()) || startAt <= blockTimeOf(ctx)) {
            await refund('Reservation start time must be in the future');
            return;
        }

        if (payment.asset !== listing.asset) {
            await refund(`Reservation must be paid in ${listing.asset}`);
            return;
        }

        if (!toBigNumber(payment.amount).eq(listing.price)) {
            await refund(`Reservation payment must be exactly ${listing.price} ${listing.asset}`);
            return;
        }

        const duplicate = await state.adapter.query('SELECT reservation_id FROM booking_reservations WHERE reservation_id = ?', [payload.reservationId]);
        if (duplicate.length > 0) {
            await refund(`Reservation ${payload.reservationId} already exists`);
            return;
        }

        const endAt = new Date(startAt.getTime() + Number(listing.duration_minutes) * 60 * 1000);
        const existing = await state.adapter.query(
            'SELECT * FROM booking_reservations WHERE listing_id = ? AND status IN (?, ?)',
            [payload.listingId, 'pending', 'confirmed']
        );

        for (const reservation of existing) {
            const existingStart = parseDateValue(reservation.start_at) || startAt;
            const existingEnd = parseDateValue(reservation.end_at) || endAt;
            const overlaps = startAt < existingEnd && endAt > existingStart;
            if (overlaps) {
                await refund('Requested reservation time overlaps an existing reservation');
                return;
            }
        }

        await state.adapter.query(
            `INSERT INTO booking_reservations (
                reservation_id, listing_id, booker, start_at, end_at, amount, asset, note, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [payload.reservationId, payload.listingId, booker, startAt, endAt, payment.amount, payment.asset, payload.note || '', 'pending', blockTimeOf(ctx), blockTimeOf(ctx)]
        );

        await emitContractEvent(state.adapter, name, 'reserve', payload, {
            action: 'booking_reserved',
            data: {
                listingId: payload.listingId,
                reservationId: payload.reservationId,
                booker,
                startAt,
                endAt
            }
        }, blockTimeOf(ctx));
    };

    const confirmReservation = async (payload: z.infer<typeof reservationSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const reservations = await state.adapter.query('SELECT * FROM booking_reservations WHERE reservation_id = ?', [payload.reservationId]);
        if (reservations.length === 0) {
            throw new Error(`Reservation ${payload.reservationId} does not exist`);
        }

        const reservation = reservations[0];
        const listings = await state.adapter.query('SELECT * FROM booking_listings WHERE listing_id = ?', [reservation.listing_id]);
        if (listings.length === 0 || listings[0].owner !== owner) {
            throw new Error('Only the listing owner can confirm reservations');
        }

        if (reservation.status !== 'pending') {
            throw new Error(`Reservation ${payload.reservationId} is ${reservation.status}`);
        }

        await state.adapter.query(
            'UPDATE booking_reservations SET status = ?, updated_at = ? WHERE reservation_id = ?',
            ['confirmed', blockTimeOf(ctx), payload.reservationId]
        );

        await emitContractEvent(state.adapter, name, 'confirmReservation', payload, {
            action: 'booking_confirmed',
            data: {
                reservationId: payload.reservationId,
                listingId: reservation.listing_id,
                owner
            }
        }, blockTimeOf(ctx));
    };

    const cancelReservation = async (payload: z.infer<typeof reservationSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const reservations = await state.adapter.query('SELECT * FROM booking_reservations WHERE reservation_id = ?', [payload.reservationId]);
        if (reservations.length === 0) {
            throw new Error(`Reservation ${payload.reservationId} does not exist`);
        }

        const reservation = reservations[0];
        const listings = await state.adapter.query('SELECT * FROM booking_listings WHERE listing_id = ?', [reservation.listing_id]);
        const listing = listings[0];
        const isOwner = listing.owner === sender;
        const isBooker = reservation.booker === sender;
        if (!isOwner && !isBooker) {
            throw new Error('Only the listing owner or booker can cancel this reservation');
        }

        if (reservation.status !== 'pending' && reservation.status !== 'confirmed') {
            throw new Error(`Reservation ${payload.reservationId} is ${reservation.status}`);
        }

        if (isBooker) {
            const cancellationWindowStart = new Date((parseDateValue(reservation.start_at) || blockTimeOf(ctx)).getTime() - Number(listing.cancellation_hours) * 60 * 60 * 1000);
            if (cancellationWindowStart < blockTimeOf(ctx)) {
                throw new Error('Cancellation window has passed');
            }
        }

        await state.adapter.query(
            'UPDATE booking_reservations SET status = ?, updated_at = ? WHERE reservation_id = ?',
            ['cancelled', blockTimeOf(ctx), payload.reservationId]
        );

        await emitContractEvent(state.adapter, name, 'cancelReservation', payload, {
            action: 'booking_cancelled',
            data: {
                reservationId: payload.reservationId,
                listingId: reservation.listing_id,
                cancelledBy: sender,
                reason: payload.reason || ''
            }
        }, blockTimeOf(ctx));
    };

    const completeReservation = async (payload: z.infer<typeof reservationSchema>, ctx: any) => {
        const reservations = await state.adapter.query('SELECT * FROM booking_reservations WHERE reservation_id = ?', [payload.reservationId]);
        if (reservations.length === 0) {
            throw new Error(`Reservation ${payload.reservationId} does not exist`);
        }

        const reservation = reservations[0];
        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            const listings = await state.adapter.query('SELECT * FROM booking_listings WHERE listing_id = ?', [reservation.listing_id]);
            if (listings[0].owner !== sender) {
                throw new Error('Only the listing owner can complete reservations');
            }
        }

        // Cancelled and completed reservations are final; a scheduled
        // completion of one is a no-op rather than an error every tick.
        if (reservation.status !== 'pending' && reservation.status !== 'confirmed') {
            if (ctx.trigger === 'time') {
                return;
            }

            throw new Error(`Reservation ${payload.reservationId} is ${reservation.status}`);
        }

        await state.adapter.query(
            'UPDATE booking_reservations SET status = ?, updated_at = ? WHERE reservation_id = ?',
            ['completed', blockTimeOf(ctx), payload.reservationId]
        );

        await emitContractEvent(state.adapter, name, 'completeReservation', payload, {
            action: 'booking_completed',
            data: {
                reservationId: payload.reservationId,
                listingId: reservation.listing_id
            }
        }, blockTimeOf(ctx));
    };

    return defineContract({
        name,
        hooks: {
            create: async (lifecycle) => {
                const { adapter, streamer } = lifecycle;
                account = resolveContractAccount('createBookingContract', options.account, lifecycle);
                state.adapter = adapter;
                state.streamer = streamer;
                await initialize();
            }
        },
        actions: {
            createListing: action(createListing, { schema: createListingSchema, trigger: 'custom_json' }),
            reserve: action(reserve, {
                schema: reserveSchema,
                trigger: ['transfer', 'recurrent_transfer'],
                description: 'Reserve a slot by paying the exact listing price; wrong amounts or assets, overlaps and inactive listings are refunded.'
            }),
            confirmReservation: action(confirmReservation, {
                schema: reservationSchema,
                trigger: 'custom_json',
                description: 'Listing owner confirms a pending reservation.'
            }),
            cancelReservation: action(cancelReservation, {
                schema: reservationSchema,
                trigger: 'custom_json',
                description: 'Owner or booker (within the cancellation window) cancels a pending or confirmed reservation.'
            }),
            completeReservation: action(completeReservation, {
                schema: reservationSchema,
                trigger: ['custom_json', 'time'],
                description: 'Mark a pending or confirmed reservation completed (owner or scheduled).'
            })
        }
    });
}
