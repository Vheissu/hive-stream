import { getLogger } from '../logger';
import { createHash } from 'crypto';
import { z } from 'zod';
import { action, defineContract } from './contract';
import {
    createContractState,
    emitContractEvent,
    initializeTables,
    requireSender
} from './helpers';

const DEFAULT_NAME = 'checkpoint';

const TABLE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

export interface CheckpointContractOptions {
    name?: string;
    tables: string[];
    account?: string;
}

function canonicalize(value: any): any {
    if (value === null || typeof value === 'undefined') {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }

    if (typeof value === 'object') {
        const sorted: Record<string, any> = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = canonicalize(value[key]);
        }
        return sorted;
    }

    return value;
}

function sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

export function createCheckpointContract(options: CheckpointContractOptions) {
    const name = options.name || DEFAULT_NAME;
    const tables = [...new Set(options.tables)].sort();

    if (tables.length === 0) {
        throw new Error('Checkpoint contract requires at least one table to hash');
    }

    for (const table of tables) {
        if (!TABLE_NAME_PATTERN.test(table)) {
            throw new Error(`Invalid table name for checkpointing: ${table}`);
        }
    }

    const state = createContractState<{ streamer: any; config: any }>({ streamer: null, config: null });

    const recordCheckpointSchema = z.object({
        checkpointId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9:._-]+$/),
        blockNumber: z.number().int().min(0),
        stateHash: z.string().regex(/^[a-f0-9]{64}$/, 'State hash must be a sha256 hex digest'),
        tables: z.array(z.string().regex(TABLE_NAME_PATTERN)).min(1).max(50)
    });

    const publishSchema = z.object({}).passthrough().optional();

    const initialize = async () => {
        await initializeTables(state.adapter, [
            `
                CREATE TABLE IF NOT EXISTS state_checkpoints (
                    checkpoint_id TEXT PRIMARY KEY,
                    publisher TEXT NOT NULL,
                    block_number INTEGER NOT NULL,
                    state_hash TEXT NOT NULL,
                    local_hash TEXT,
                    tables TEXT NOT NULL,
                    matched INTEGER,
                    source TEXT NOT NULL,
                    created_at DATETIME NOT NULL
                )
            `
        ]);
    };

    // Order-independent per table: hash each row, sort the row hashes, then hash the
    // table digests in sorted-table order so every node derives the same value
    // regardless of physical row order or adapter backend.
    const computeStateHash = async (tableNames: string[]): Promise<string> => {
        const tableDigests: string[] = [];

        for (const table of [...tableNames].sort()) {
            if (!TABLE_NAME_PATTERN.test(table)) {
                throw new Error(`Invalid table name for checkpointing: ${table}`);
            }

            const rows = await state.adapter.query(`SELECT * FROM ${table}`);
            const rowHashes = (rows || [])
                .map((row: any) => sha256(JSON.stringify(canonicalize(row))))
                .sort();

            tableDigests.push(`${table}=${sha256(rowHashes.join(''))}`);
        }

        return sha256(tableDigests.join('|'));
    };

    const publishCheckpoint = async (_payload: any, ctx: any) => {
        const account = options.account || ctx?.config?.USERNAME || state.config?.USERNAME;
        if (!account) {
            throw new Error('Checkpoint publishing requires an account (options.account or config username)');
        }

        // Time triggers come from this node's scheduler; a custom_json trigger could
        // come from anyone on chain, so only the publishing account may invoke it.
        if (ctx?.trigger === 'custom_json' && ctx?.sender !== account) {
            throw new Error('Only the checkpoint account can trigger publishing on demand');
        }

        const blockNumber = ctx?.block?.number ?? 0;
        const stateHash = await computeStateHash(tables);
        const checkpointId = `${account}:${blockNumber}`;

        await state.adapter.query(
            `INSERT INTO state_checkpoints (checkpoint_id, publisher, block_number, state_hash, local_hash, tables, matched, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (checkpoint_id) DO UPDATE SET
                state_hash = excluded.state_hash,
                local_hash = excluded.local_hash,
                created_at = excluded.created_at`,
            [checkpointId, account, blockNumber, stateHash, stateHash, JSON.stringify(tables), 1, 'local', new Date()]
        );

        await emitContractEvent(state.adapter, name, 'publishCheckpoint', { checkpointId }, {
            action: 'checkpoint_published',
            data: {
                checkpointId,
                publisher: account,
                blockNumber,
                stateHash,
                tables
            }
        });

        const config = ctx?.config || state.config;
        const payloadIdentifier = config?.PAYLOAD_IDENTIFIER || 'hive_stream';
        const jsonId = config?.JSON_ID || 'hivestream';

        await state.streamer.broadcastOperations([[
            'custom_json',
            {
                required_auths: [],
                required_posting_auths: [account],
                id: jsonId,
                json: JSON.stringify({
                    [payloadIdentifier]: {
                        contract: name,
                        action: 'recordCheckpoint',
                        payload: {
                            checkpointId,
                            blockNumber,
                            stateHash,
                            tables
                        }
                    }
                })
            }
        ]]);
    };

    const recordCheckpoint = async (payload: z.infer<typeof recordCheckpointSchema>, ctx: any) => {
        const publisher = requireSender(ctx);
        const remoteTables = [...new Set(payload.tables)].sort();
        const sameTables = JSON.stringify(remoteTables) === JSON.stringify(tables);

        // Prefer the hash we stored when we published at this exact block; otherwise
        // compute fresh, which can transiently mismatch if state moved between the
        // publisher's block and our observation of it.
        let localHash: string;
        const existing = await state.adapter.query(
            'SELECT local_hash FROM state_checkpoints WHERE checkpoint_id = ? AND source = ?',
            [payload.checkpointId, 'local']
        );

        if (existing.length > 0 && existing[0].local_hash) {
            localHash = existing[0].local_hash;
        } else {
            localHash = await computeStateHash(sameTables ? remoteTables : tables);
        }

        const matched = sameTables && localHash === payload.stateHash;
        const recordId = `${publisher}:${payload.blockNumber}:remote`;

        await state.adapter.query(
            `INSERT INTO state_checkpoints (checkpoint_id, publisher, block_number, state_hash, local_hash, tables, matched, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (checkpoint_id) DO UPDATE SET
                state_hash = excluded.state_hash,
                local_hash = excluded.local_hash,
                matched = excluded.matched,
                created_at = excluded.created_at`,
            [recordId, publisher, payload.blockNumber, payload.stateHash, localHash, JSON.stringify(remoteTables), matched ? 1 : 0, 'remote', new Date()]
        );

        await emitContractEvent(state.adapter, name, 'recordCheckpoint', payload, {
            action: 'checkpoint_recorded',
            data: {
                checkpointId: payload.checkpointId,
                publisher,
                blockNumber: payload.blockNumber,
                remoteHash: payload.stateHash,
                localHash,
                matched
            }
        });

        if (!matched) {
            getLogger().warn(`[CheckpointContract] State divergence detected against ${publisher} at block ${payload.blockNumber}`);
        }
    };

    return defineContract({
        name,
        hooks: {
            create: async ({ streamer, adapter, config }) => {
                state.adapter = adapter;
                state.streamer = streamer;
                state.config = config;
                await initialize();
            }
        },
        actions: {
            publishCheckpoint: action(publishCheckpoint, { schema: publishSchema as any, trigger: ['time', 'custom_json'] }),
            recordCheckpoint: action(recordCheckpoint, { schema: recordCheckpointSchema, trigger: 'custom_json' })
        }
    });
}
