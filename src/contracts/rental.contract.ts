import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    amountSchema,
    assetSchema,
    assertAssetMatches,
    createContractState,
    emitContractEvent,
    getEscrowPayment,
    identifierSchema,
    initializeTables,
    parseDateValue,
    requireEscrowContext,
    requireSender,
    toBigNumber
} from './helpers';

const DEFAULT_NAME = 'rentals';

export interface RentalContractOptions {
    name?: string;
}

export function createRentalContract(options: RentalContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createListingSchema = z.object({
        listingId: identifierSchema,
        assetRef: z.string().min(1).max(140),
        title: z.string().min(3).max(140),
        collateralAmount: amountSchema,
        collateralAsset: assetSchema,
        dailyRate: amountSchema,
        rateAsset: assetSchema,
        maxDurationDays: z.number().int().min(1).max(365).optional(),
        metadata: z.record(z.any()).optional()
    });

    const initiateSchema = z.object({
        listingId: identifierSchema,
        rentalId: identifierSchema,
        endsAt: z.string(),
        note: z.string().max(280).optional()
    });

    const rentalIdSchema = z.object({
        rentalId: identifierSchema,
        note: z.string().max(280).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS rental_listings (
                    listing_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    asset_ref TEXT NOT NULL,
                    title TEXT NOT NULL,
                    collateral_amount TEXT NOT NULL,
                    collateral_asset TEXT NOT NULL,
                    daily_rate TEXT NOT NULL,
                    rate_asset TEXT NOT NULL,
                    max_duration_days INTEGER,
                    active INTEGER NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS rental_agreements (
                    rental_id TEXT PRIMARY KEY,
                    listing_id TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    renter TEXT NOT NULL,
                    escrow_id INTEGER NOT NULL,
                    escrow_agent TEXT NOT NULL,
                    collateral_amount TEXT NOT NULL,
                    collateral_asset TEXT NOT NULL,
                    starts_at DATETIME NOT NULL,
                    ends_at DATETIME NOT NULL,
                    status TEXT NOT NULL,
                    note TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createListing = async (payload: z.infer<typeof createListingSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT listing_id FROM rental_listings WHERE listing_id = ?', [payload.listingId]);
        if (existing.length > 0) {
            throw new Error(`Listing ${payload.listingId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO rental_listings (
                listing_id, owner, asset_ref, title, collateral_amount, collateral_asset, daily_rate, rate_asset, max_duration_days, active, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.listingId,
                owner,
                payload.assetRef,
                payload.title,
                payload.collateralAmount,
                payload.collateralAsset,
                payload.dailyRate,
                payload.rateAsset,
                payload.maxDurationDays || null,
                1,
                JSON.stringify(payload.metadata || {}),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'createListing', payload, {
            action: 'rental_listing_created',
            data: {
                listingId: payload.listingId,
                owner
            }
        });
    };

    const initiateRental = async (payload: z.infer<typeof initiateSchema>, ctx: any) => {
        const escrow = requireEscrowContext(ctx);
        const renter = requireSender(ctx);
        const payment = getEscrowPayment(ctx);
        const listings = await state.adapter.query('SELECT * FROM rental_listings WHERE listing_id = ?', [payload.listingId]);
        if (listings.length === 0) {
            throw new Error(`Listing ${payload.listingId} does not exist`);
        }

        const listing = listings[0];
        if (!listing.active) {
            throw new Error('Rental listing is not active');
        }

        assertAssetMatches(payment.asset, listing.collateral_asset, 'Collateral');
        if (toBigNumber(payment.amount).lt(listing.collateral_amount)) {
            throw new Error('Escrow collateral is below the required minimum');
        }

        const endsAt = parseDateValue(payload.endsAt);
        if (!endsAt || endsAt <= new Date()) {
            throw new Error('Rental end time must be in the future');
        }

        if (listing.max_duration_days) {
            const maxEnd = new Date(Date.now() + Number(listing.max_duration_days) * 24 * 60 * 60 * 1000);
            if (endsAt > maxEnd) {
                throw new Error('Requested rental exceeds the maximum duration');
            }
        }

        const existing = await state.adapter.query(
            'SELECT rental_id FROM rental_agreements WHERE rental_id = ?',
            [payload.rentalId]
        );
        if (existing.length > 0) {
            throw new Error(`Rental ${payload.rentalId} already exists`);
        }

        await state.adapter.query(
            `INSERT INTO rental_agreements (
                rental_id, listing_id, owner, renter, escrow_id, escrow_agent, collateral_amount, collateral_asset,
                starts_at, ends_at, status, note, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.rentalId,
                payload.listingId,
                listing.owner,
                renter,
                escrow.escrowId,
                escrow.agent,
                payment.amount,
                payment.asset,
                ctx.block.time,
                endsAt,
                'active',
                payload.note || '',
                new Date(),
                new Date()
            ]
        );

        await emitContractEvent(state.adapter, name, 'initiateRental', payload, {
            action: 'rental_initiated',
            data: {
                rentalId: payload.rentalId,
                listingId: payload.listingId,
                owner: listing.owner,
                renter,
                escrowId: escrow.escrowId,
                escrowAgent: escrow.agent
            }
        });
    };

    const confirmReturn = async (payload: z.infer<typeof rentalIdSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const rentals = await state.adapter.query('SELECT * FROM rental_agreements WHERE rental_id = ?', [payload.rentalId]);
        if (rentals.length === 0) {
            throw new Error(`Rental ${payload.rentalId} does not exist`);
        }

        const rental = rentals[0];
        if (sender !== rental.owner && sender !== rental.renter) {
            throw new Error('Only the owner or renter can confirm return');
        }

        await state.adapter.query(
            'UPDATE rental_agreements SET status = ?, note = ?, updated_at = ? WHERE rental_id = ?',
            ['returned', payload.note || rental.note || '', new Date(), payload.rentalId]
        );

        await emitContractEvent(state.adapter, name, 'confirmReturn', payload, {
            action: 'rental_return_confirmed',
            data: {
                rentalId: payload.rentalId,
                confirmedBy: sender,
                escrowId: rental.escrow_id
            }
        });
    };

    const closeRental = async (payload: z.infer<typeof rentalIdSchema>, ctx: any) => {
        const rentals = await state.adapter.query('SELECT * FROM rental_agreements WHERE rental_id = ?', [payload.rentalId]);
        if (rentals.length === 0) {
            throw new Error(`Rental ${payload.rentalId} does not exist`);
        }

        const rental = rentals[0];
        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== rental.owner) {
                throw new Error('Only the listing owner can close the rental');
            }
        }

        await state.adapter.query(
            'UPDATE rental_agreements SET status = ?, note = ?, updated_at = ? WHERE rental_id = ?',
            ['closed', payload.note || rental.note || '', new Date(), payload.rentalId]
        );

        await emitContractEvent(state.adapter, name, 'closeRental', payload, {
            action: 'rental_closed',
            data: {
                rentalId: payload.rentalId,
                escrowId: rental.escrow_id,
                owner: rental.owner,
                renter: rental.renter
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
            initiateRental: action(initiateRental, { schema: initiateSchema, trigger: 'escrow_transfer' }),
            confirmReturn: action(confirmReturn, { schema: rentalIdSchema, trigger: 'custom_json' }),
            closeRental: action(closeRental, { schema: rentalIdSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
