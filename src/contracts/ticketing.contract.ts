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

const DEFAULT_NAME = 'ticketing';

export interface TicketingContractOptions {
    name?: string;
}

export function createTicketingContract(options: TicketingContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createEventSchema = z.object({
        eventId: identifierSchema,
        title: z.string().min(3).max(140),
        venue: z.string().min(2).max(140),
        startsAt: z.string(),
        ticketPrice: amountSchema,
        asset: assetSchema,
        capacity: z.number().int().min(1).max(1000000),
        metadata: z.record(z.any()).optional()
    });

    const purchaseSchema = z.object({
        eventId: identifierSchema,
        ticketId: identifierSchema
    });

    const ticketIdSchema = z.object({
        ticketId: identifierSchema,
        note: z.string().max(280).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS ticket_events (
                    event_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    title TEXT NOT NULL,
                    venue TEXT NOT NULL,
                    starts_at DATETIME NOT NULL,
                    ticket_price TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    capacity INTEGER NOT NULL,
                    sold_count INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT,
                    created_at DATETIME NOT NULL
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS tickets (
                    ticket_id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    status TEXT NOT NULL,
                    note TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createEvent = async (payload: z.infer<typeof createEventSchema>, ctx: any) => {
        const owner = requireSender(ctx);
        const existing = await state.adapter.query('SELECT event_id FROM ticket_events WHERE event_id = ?', [payload.eventId]);
        if (existing.length > 0) {
            throw new Error(`Event ${payload.eventId} already exists`);
        }

        const startsAt = parseDateValue(payload.startsAt);
        if (!startsAt || startsAt <= new Date()) {
            throw new Error('Event start time must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO ticket_events (
                event_id, owner, title, venue, starts_at, ticket_price, asset, capacity, sold_count, status, metadata, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [payload.eventId, owner, payload.title, payload.venue, startsAt, payload.ticketPrice, payload.asset, payload.capacity, 0, 'active', JSON.stringify(payload.metadata || {}), new Date()]
        );

        await emitContractEvent(state.adapter, name, 'createEvent', payload, {
            action: 'ticket_event_created',
            data: {
                eventId: payload.eventId,
                owner
            }
        });
    };

    const purchaseTicket = async (payload: z.infer<typeof purchaseSchema>, ctx: any) => {
        const buyer = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const eventRows = await state.adapter.query('SELECT * FROM ticket_events WHERE event_id = ?', [payload.eventId]);
        if (eventRows.length === 0) {
            throw new Error(`Event ${payload.eventId} does not exist`);
        }

        const event = eventRows[0];
        if (event.status !== 'active') {
            throw new Error('Event is not active');
        }

        if ((parseDateValue(event.starts_at) || new Date()) <= new Date()) {
            throw new Error('Ticket sales are closed for this event');
        }

        assertAssetMatches(payment.asset, event.asset);
        if (!toBigNumber(payment.amount).eq(event.ticket_price)) {
            throw new Error(`Ticket price is ${event.ticket_price} ${event.asset}`);
        }

        if (Number(event.sold_count) >= Number(event.capacity)) {
            throw new Error('Event is sold out');
        }

        const existing = await state.adapter.query('SELECT ticket_id FROM tickets WHERE ticket_id = ?', [payload.ticketId]);
        if (existing.length > 0) {
            throw new Error(`Ticket ${payload.ticketId} already exists`);
        }

        await state.adapter.query(
            'INSERT INTO tickets (ticket_id, event_id, owner, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [payload.ticketId, payload.eventId, buyer, 'valid', '', new Date(), new Date()]
        );
        await state.adapter.query(
            'UPDATE ticket_events SET sold_count = ? WHERE event_id = ?',
            [Number(event.sold_count) + 1, payload.eventId]
        );

        await emitContractEvent(state.adapter, name, 'purchaseTicket', payload, {
            action: 'ticket_purchased',
            data: {
                ticketId: payload.ticketId,
                eventId: payload.eventId,
                buyer
            }
        });
    };

    const checkInTicket = async (payload: z.infer<typeof ticketIdSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const ticketRows = await state.adapter.query('SELECT * FROM tickets WHERE ticket_id = ?', [payload.ticketId]);
        if (ticketRows.length === 0) {
            throw new Error(`Ticket ${payload.ticketId} does not exist`);
        }

        const ticket = ticketRows[0];
        const eventRows = await state.adapter.query('SELECT * FROM ticket_events WHERE event_id = ?', [ticket.event_id]);
        const event = eventRows[0];
        if (event.owner !== sender) {
            throw new Error('Only the event owner can check in tickets');
        }

        if (ticket.status !== 'valid') {
            throw new Error('Ticket is not valid for check-in');
        }

        await state.adapter.query(
            'UPDATE tickets SET status = ?, note = ?, updated_at = ? WHERE ticket_id = ?',
            ['checked_in', payload.note || '', new Date(), payload.ticketId]
        );

        await emitContractEvent(state.adapter, name, 'checkInTicket', payload, {
            action: 'ticket_checked_in',
            data: {
                ticketId: payload.ticketId,
                eventId: ticket.event_id,
                owner: ticket.owner
            }
        });
    };

    const refundTicket = async (payload: z.infer<typeof ticketIdSchema>, ctx: any) => {
        const sender = requireSender(ctx);
        const ticketRows = await state.adapter.query('SELECT * FROM tickets WHERE ticket_id = ?', [payload.ticketId]);
        if (ticketRows.length === 0) {
            throw new Error(`Ticket ${payload.ticketId} does not exist`);
        }

        const ticket = ticketRows[0];
        const eventRows = await state.adapter.query('SELECT * FROM ticket_events WHERE event_id = ?', [ticket.event_id]);
        const event = eventRows[0];
        if (sender !== event.owner && sender !== ticket.owner) {
            throw new Error('Only the event owner or ticket owner can request a refund');
        }

        if (ticket.status !== 'valid') {
            throw new Error('Only valid tickets can be refunded');
        }

        await state.adapter.query(
            'UPDATE tickets SET status = ?, note = ?, updated_at = ? WHERE ticket_id = ?',
            ['refunded', payload.note || '', new Date(), payload.ticketId]
        );

        await emitContractEvent(state.adapter, name, 'refundTicket', payload, {
            action: 'ticket_refund_requested',
            data: {
                ticketId: payload.ticketId,
                eventId: ticket.event_id,
                owner: ticket.owner,
                amount: event.ticket_price,
                asset: event.asset
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
            createEvent: action(createEvent, { schema: createEventSchema, trigger: 'custom_json' }),
            purchaseTicket: action(purchaseTicket, { schema: purchaseSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            checkInTicket: action(checkInTicket, { schema: ticketIdSchema, trigger: 'custom_json' }),
            refundTicket: action(refundTicket, { schema: ticketIdSchema, trigger: 'custom_json' })
        }
    });
}
