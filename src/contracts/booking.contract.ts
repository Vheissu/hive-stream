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
    requireSender
} from './helpers';

const DEFAULT_NAME = 'bookings';

export interface BookingContractOptions {
    name?: string;
}

export function createBookingContract(options: BookingContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createListingSchema = z.object({
        listingId: identifierSchema,
        title: z.string().min(3).max(140),
        price: amountSchema,
        asset: assetSchema,
        durationMinutes: z.number().int().min(15).max(24 * 60),
        cancellationHours: z.number().int().min(0).max(720).optional(),
        metadata: z.record(z.any()).optional()
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
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createListing', payload, {
            action: 'booking_listing_created',
            data: {
                listingId: payload.listingId,
                owner
            }
        });
    };

    const reserve = async (payload: z.infer<typeof reserveSchema>, ctx: any) => {
        const booker = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const listings = await state.adapter.query('SELECT * FROM booking_listings WHERE listing_id = ?', [payload.listingId]);
        if (listings.length === 0) {
            throw new Error(`Listing ${payload.listingId} does not exist`);
        }

        const listing = listings[0];
        if (!listing.active) {
            throw new Error('Listing is not active');
        }

        const startAt = parseDateValue(payload.startAt);
        if (!startAt || startAt <= new Date()) {
            throw new Error('Reservation start time must be in the future');
        }

        assertAssetMatches(payment.asset, listing.asset);
        if (payment.amount !== listing.price) {
            throw new Error('Reservation payment must match the listing price');
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
                throw new Error('Requested reservation time overlaps an existing reservation');
            }
        }

        await state.adapter.query(
            `INSERT INTO booking_reservations (
                reservation_id, listing_id, booker, start_at, end_at, amount, asset, note, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [payload.reservationId, payload.listingId, booker, startAt, endAt, payment.amount, payment.asset, payload.note || '', 'pending', new Date(), new Date()]
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
        });
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

        await state.adapter.query(
            'UPDATE booking_reservations SET status = ?, updated_at = ? WHERE reservation_id = ?',
            ['confirmed', new Date(), payload.reservationId]
        );

        await emitContractEvent(state.adapter, name, 'confirmReservation', payload, {
            action: 'booking_confirmed',
            data: {
                reservationId: payload.reservationId,
                listingId: reservation.listing_id,
                owner
            }
        });
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

        if (isBooker) {
            const cancellationWindowStart = new Date((parseDateValue(reservation.start_at) || new Date()).getTime() - Number(listing.cancellation_hours) * 60 * 60 * 1000);
            if (cancellationWindowStart < new Date()) {
                throw new Error('Cancellation window has passed');
            }
        }

        await state.adapter.query(
            'UPDATE booking_reservations SET status = ?, updated_at = ? WHERE reservation_id = ?',
            ['cancelled', new Date(), payload.reservationId]
        );

        await emitContractEvent(state.adapter, name, 'cancelReservation', payload, {
            action: 'booking_cancelled',
            data: {
                reservationId: payload.reservationId,
                listingId: reservation.listing_id,
                cancelledBy: sender,
                reason: payload.reason || ''
            }
        });
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

        await state.adapter.query(
            'UPDATE booking_reservations SET status = ?, updated_at = ? WHERE reservation_id = ?',
            ['completed', new Date(), payload.reservationId]
        );

        await emitContractEvent(state.adapter, name, 'completeReservation', payload, {
            action: 'booking_completed',
            data: {
                reservationId: payload.reservationId,
                listingId: reservation.listing_id
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
            createListing: action(createListing, { schema: createListingSchema, trigger: 'custom_json' }),
            reserve: action(reserve, { schema: reserveSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            confirmReservation: action(confirmReservation, { schema: reservationSchema, trigger: 'custom_json' }),
            cancelReservation: action(cancelReservation, { schema: reservationSchema, trigger: 'custom_json' }),
            completeReservation: action(completeReservation, { schema: reservationSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
