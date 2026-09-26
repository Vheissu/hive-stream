import fs from 'fs';
import os from 'os';
import path from 'path';

import { action, AdapterBase, ConfigInput, defineContract, SqliteAdapter, Streamer } from '../../src';
import { FakeHiveClient, MemoryBlockProvider } from '../../src/testing';

export function memo(contract: string, actionName: string, payload: Record<string, unknown> = {}): string {
    return JSON.stringify({ hive_stream: { contract, action: actionName, payload } });
}

export function transferOp(from: string, amount: string, memoText: string, to: string = 'app'): [string, any] {
    return ['transfer', { from, to, amount, memo: memoText }];
}

export function tempDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-stream-core-'));
    return path.join(dir, 'state.db');
}

/**
 * A contract whose `play` action records every call, standing in for a
 * payout that must never run twice.
 */
export function createCountingContract(calls: Array<{ payload: any; ctx: any }> = []) {
    return {
        calls,
        contract: defineContract({
            name: 'game',
            actions: {
                play: action((payload: any, ctx) => {
                    calls.push({ payload, ctx });
                }, { trigger: ['transfer', 'custom_json'] })
            }
        })
    };
}

export interface CoreHarness {
    streamer: Streamer;
    provider: MemoryBlockProvider;
    client: FakeHiveClient;
    adapter: AdapterBase;
}

export async function createHarness(options: {
    provider?: MemoryBlockProvider;
    adapter?: AdapterBase;
    config?: ConfigInput;
    genesis?: boolean;
} = {}): Promise<CoreHarness> {
    const provider = options.provider ?? new MemoryBlockProvider({ startTime: new Date('2026-01-01T00:00:00.000Z') });
    const client = new FakeHiveClient();
    const adapter = options.adapter ?? new SqliteAdapter(':memory:');
    const streamer = new Streamer({
        username: 'app',
        blockProvider: provider,
        client: client.asClient(),
        ...(options.config ?? {})
    });

    await streamer.registerAdapter(adapter);

    // A fresh streamer starts at the chain's current target block, so mint
    // and process a genesis block first; later blocks are then processed in
    // full. Pass `genesis: false` to skip this.
    if (options.genesis !== false) {
        provider.addBlock();
        await streamer.processPendingBlocks();
    }

    return { streamer, provider, client, adapter };
}
