import { z } from 'zod';
import { action, defineContract } from './contract';
import { ensureSqlAdapter } from './helpers';

const DEFAULT_NAME = 'polls';

export interface PollContractOptions {
    name?: string;
}

export function createPollContract(options: PollContractOptions = {}) {
    const name = options.name || DEFAULT_NAME;

    const state = {
        adapter: null as any
    };

    const createPollSchema = z.object({
        pollId: z.string().min(1).max(64),
        question: z.string().min(3).max(280),
        options: z.array(z.string().min(1).max(100)).min(2).max(10),
        durationHours: z.number().int().min(1).max(720).optional()
    });

    const voteSchema = z.object({
        pollId: z.string().min(1).max(64),
        option: z.number().int().min(0)
    });

    const initializeTables = async () => {
        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS polls (
                poll_id TEXT PRIMARY KEY,
                question TEXT NOT NULL,
                options TEXT NOT NULL,
                creator TEXT NOT NULL,
                created_at DATETIME NOT NULL,
                closes_at DATETIME
            )
        `);

        await state.adapter.query(`
            CREATE TABLE IF NOT EXISTS poll_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                poll_id TEXT NOT NULL,
                voter TEXT NOT NULL,
                option_index INTEGER NOT NULL,
                created_at DATETIME NOT NULL,
                UNIQUE(poll_id, voter)
            )
        `);
    };

    const createPoll = async (payload: { pollId: string; question: string; options: string[]; durationHours?: number }, ctx: any) => {
        const closesAt = payload.durationHours
            ? new Date(Date.now() + payload.durationHours * 60 * 60 * 1000)
            : null;

        const existing = await state.adapter.query('SELECT poll_id FROM polls WHERE poll_id = ?', [payload.pollId]);
        if (existing && existing.length > 0) {
            throw new Error(`Poll ${payload.pollId} already exists`);
        }

        await state.adapter.query(
            'INSERT INTO polls (poll_id, question, options, creator, created_at, closes_at) VALUES (?, ?, ?, ?, ?, ?)',
            [payload.pollId, payload.question, JSON.stringify(payload.options), ctx.sender, new Date(), closesAt]
        );

        await state.adapter.addEvent(new Date(), name, 'createPoll', payload, {
            action: 'poll_created',
            data: {
                pollId: payload.pollId,
                creator: ctx.sender,
                closesAt
            }
        });
    };

    const vote = async (payload: { pollId: string; option: number }, ctx: any) => {
        const poll = await state.adapter.query('SELECT * FROM polls WHERE poll_id = ?', [payload.pollId]);

        if (!poll || poll.length === 0) {
            throw new Error(`Poll ${payload.pollId} does not exist`);
        }

        const pollData = poll[0];
        const options = JSON.parse(pollData.options || '[]');
        if (payload.option < 0 || payload.option >= options.length) {
            throw new Error('Invalid poll option');
        }

        if (pollData.closes_at && new Date(pollData.closes_at) < new Date()) {
            throw new Error('Poll is closed');
        }

        await state.adapter.query(
            'INSERT INTO poll_votes (poll_id, voter, option_index, created_at) VALUES (?, ?, ?, ?)',
            [payload.pollId, ctx.sender, payload.option, new Date()]
        );

        await state.adapter.addEvent(new Date(), name, 'vote', payload, {
            action: 'poll_voted',
            data: {
                pollId: payload.pollId,
                voter: ctx.sender,
                option: payload.option
            }
        });
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ adapter }) => {
                ensureSqlAdapter(adapter);
                state.adapter = adapter;
                await initializeTables();
            }
        },
        actions: {
            createPoll: action(createPoll, {
                schema: createPollSchema,
                trigger: 'custom_json'
            }),
            vote: action(vote, {
                schema: voteSchema,
                trigger: 'custom_json'
            })
        }
    });
}
