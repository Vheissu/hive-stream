import seedrandom from 'seedrandom';
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

const DEFAULT_NAME = 'sweepstakes';

export interface SweepstakesContractOptions {
    name?: string;
}

export function createSweepstakesContract(options: SweepstakesContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;
    const state = createContractState();

    const createDrawSchema = z.object({
        drawId: identifierSchema,
        title: z.string().min(3).max(140),
        entryFee: amountSchema,
        asset: assetSchema,
        closesAt: z.string(),
        maxEntries: z.number().int().min(1).max(1000000).optional(),
        maxEntriesPerAccount: z.number().int().min(1).max(100000).optional(),
        metadata: z.record(z.any()).optional()
    });

    const enterSchema = z.object({
        drawId: identifierSchema,
        entries: z.number().int().min(1).optional()
    });

    const drawSchema = z.object({
        drawId: identifierSchema,
        seed: z.string().max(120).optional()
    });

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS sweepstakes_draws (
                    draw_id TEXT PRIMARY KEY,
                    creator TEXT NOT NULL,
                    title TEXT NOT NULL,
                    entry_fee TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    closes_at DATETIME NOT NULL,
                    max_entries INTEGER,
                    max_entries_per_account INTEGER,
                    total_entries INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    winner TEXT,
                    winner_ticket INTEGER,
                    metadata TEXT,
                    created_at DATETIME NOT NULL,
                    settled_at DATETIME
                )
            `,
            `
                CREATE TABLE IF NOT EXISTS sweepstakes_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    draw_id TEXT NOT NULL,
                    entrant TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    entries_count INTEGER NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    const createSweepstakes = async (payload: z.infer<typeof createDrawSchema>, ctx: any) => {
        const creator = requireSender(ctx);
        const existing = await state.adapter.query('SELECT draw_id FROM sweepstakes_draws WHERE draw_id = ?', [payload.drawId]);
        if (existing.length > 0) {
            throw new Error(`Sweepstakes ${payload.drawId} already exists`);
        }

        const closesAt = parseDateValue(payload.closesAt);
        if (!closesAt || closesAt <= new Date()) {
            throw new Error('Sweepstakes close time must be in the future');
        }

        await state.adapter.query(
            `INSERT INTO sweepstakes_draws (
                draw_id, creator, title, entry_fee, asset, closes_at, max_entries, max_entries_per_account, total_entries, status, winner, winner_ticket, metadata, created_at, settled_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                payload.drawId,
                creator,
                payload.title,
                payload.entryFee,
                payload.asset,
                closesAt,
                payload.maxEntries || null,
                payload.maxEntriesPerAccount || null,
                0,
                'open',
                null,
                null,
                JSON.stringify(payload.metadata || {}),
                new Date(),
                null
            ]
        );

        await emitContractEvent(state.adapter, name, 'createSweepstakes', payload, {
            action: 'sweepstakes_created',
            data: {
                drawId: payload.drawId,
                creator
            }
        });
    };

    const enterSweepstakes = async (payload: z.infer<typeof enterSchema>, ctx: any) => {
        const entrant = requireSender(ctx);
        const payment = getIncomingPayment(ctx);
        const draws = await state.adapter.query('SELECT * FROM sweepstakes_draws WHERE draw_id = ?', [payload.drawId]);
        if (draws.length === 0) {
            throw new Error(`Sweepstakes ${payload.drawId} does not exist`);
        }

        const draw = draws[0];
        if (draw.status !== 'open') {
            throw new Error('Sweepstakes is not open');
        }

        if ((parseDateValue(draw.closes_at) || new Date()) <= new Date()) {
            throw new Error('Sweepstakes has already closed');
        }

        assertAssetMatches(payment.asset, draw.asset);

        const exactEntries = toBigNumber(payment.amount).dividedBy(draw.entry_fee);
        if (!exactEntries.isInteger()) {
            throw new Error('Payment amount must be an exact multiple of the entry fee');
        }

        const entries = payload.entries || exactEntries.toNumber();
        if (!exactEntries.eq(entries)) {
            throw new Error('Declared entries do not match payment amount');
        }

        const entrantRows = await state.adapter.query(
            'SELECT COALESCE(SUM(entries_count), 0) AS total FROM sweepstakes_entries WHERE draw_id = ? AND entrant = ?',
            [payload.drawId, entrant]
        );
        const entrantEntries = Number(entrantRows[0]?.total || 0);
        if (draw.max_entries_per_account && entrantEntries + entries > Number(draw.max_entries_per_account)) {
            throw new Error('Entry would exceed the per-account limit');
        }

        const totalEntries = Number(draw.total_entries) + entries;
        if (draw.max_entries && totalEntries > Number(draw.max_entries)) {
            throw new Error('Entry would exceed the draw entry cap');
        }

        await state.adapter.query(
            'INSERT INTO sweepstakes_entries (draw_id, entrant, amount, asset, entries_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [payload.drawId, entrant, payment.amount, payment.asset, entries, new Date()]
        );
        await state.adapter.query(
            'UPDATE sweepstakes_draws SET total_entries = ? WHERE draw_id = ?',
            [totalEntries, payload.drawId]
        );

        await emitContractEvent(state.adapter, name, 'enterSweepstakes', payload, {
            action: 'sweepstakes_entered',
            data: {
                drawId: payload.drawId,
                entrant,
                entries,
                totalEntries
            }
        });
    };

    const drawWinner = async (payload: z.infer<typeof drawSchema>, ctx: any) => {
        const draws = await state.adapter.query('SELECT * FROM sweepstakes_draws WHERE draw_id = ?', [payload.drawId]);
        if (draws.length === 0) {
            throw new Error(`Sweepstakes ${payload.drawId} does not exist`);
        }

        const draw = draws[0];
        if (draw.status !== 'open') {
            throw new Error('Sweepstakes is not open for drawing');
        }

        if (ctx.trigger !== 'time') {
            const sender = requireSender(ctx);
            if (sender !== draw.creator) {
                throw new Error('Only the creator can draw this sweepstakes');
            }
        }

        const closesAt = parseDateValue(draw.closes_at) || new Date();
        if (closesAt > new Date()) {
            throw new Error('Sweepstakes cannot be drawn before it closes');
        }

        if (Number(draw.total_entries) <= 0) {
            throw new Error('Sweepstakes has no entries');
        }

        const entries = await state.adapter.query(
            'SELECT entrant, entries_count FROM sweepstakes_entries WHERE draw_id = ? ORDER BY id ASC',
            [payload.drawId]
        );

        const seed = `${payload.seed || ''}:${ctx.block.id}:${payload.drawId}:${draw.total_entries}`;
        const rng = seedrandom(seed);
        const winningTicket = Math.floor(rng() * Number(draw.total_entries)) + 1;

        let cursor = 0;
        let winner = entries[0].entrant;
        for (const entry of entries) {
            cursor += Number(entry.entries_count);
            if (winningTicket <= cursor) {
                winner = entry.entrant;
                break;
            }
        }

        await state.adapter.query(
            'UPDATE sweepstakes_draws SET status = ?, winner = ?, winner_ticket = ?, settled_at = ? WHERE draw_id = ?',
            ['drawn', winner, winningTicket, new Date(), payload.drawId]
        );

        await emitContractEvent(state.adapter, name, 'drawWinner', payload, {
            action: 'sweepstakes_winner_drawn',
            data: {
                drawId: payload.drawId,
                winner,
                winningTicket,
                totalEntries: Number(draw.total_entries)
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
            createSweepstakes: action(createSweepstakes, { schema: createDrawSchema, trigger: 'custom_json' }),
            enterSweepstakes: action(enterSweepstakes, { schema: enterSchema, trigger: ['transfer', 'recurrent_transfer'] }),
            drawWinner: action(drawWinner, { schema: drawSchema, trigger: ['custom_json', 'time'] })
        }
    });
}
