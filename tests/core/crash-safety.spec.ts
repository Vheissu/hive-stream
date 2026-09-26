import { AdapterBase, SqliteAdapter, TimeAction, action, defineContract } from '../../src';
import { MemoryBlockProvider } from '../../src/testing';
import { createCountingContract, createHarness, memo, tempDbPath, transferOp } from './helpers';

describe('Checkpointing', () => {
    test('persists the cursor after every block by default', async () => {
        const { streamer, provider, adapter } = await createHarness();
        const saveSpy = jest.spyOn(adapter, 'saveState');

        provider.addBlock();
        provider.addBlock();
        provider.addBlock();
        await streamer.processPendingBlocks();

        expect(saveSpy.mock.calls.map(([state]) => state.lastBlockNumber)).toEqual([2, 3, 4]);

        const state = await adapter.loadState();
        expect(state.lastBlockNumber).toBe(4);
        expect(state.lastBlockId).toBe((await provider.getBlock(4))!.block_id);

        await streamer.stop();
    });

    test('interval mode saves at most once per interval, and stop() flushes', async () => {
        const { streamer, provider, adapter } = await createHarness({
            config: { checkpointMode: 'interval', checkpointIntervalMs: 60_000 }
        });
        const saveSpy = jest.spyOn(adapter, 'saveState');

        for (let i = 0; i < 5; i++) {
            provider.addBlock();
        }

        await streamer.processPendingBlocks();
        // The genesis block already saved within this interval.
        expect(saveSpy).toHaveBeenCalledTimes(0);

        const lastSaved = jest.fn();
        streamer.hook('onCheckpoint', lastSaved);
        await streamer.stop();

        expect(lastSaved).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 6 }));
    });

    test('onCheckpoint fires with the checkpointed block', async () => {
        const { streamer, provider } = await createHarness();
        const onCheckpoint = jest.fn();
        streamer.hook('onCheckpoint', onCheckpoint);

        const block = provider.addBlock();
        await streamer.processPendingBlocks();

        expect(onCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 2, blockId: block.block_id }));
        await streamer.stop();
    });

    test('a failing checkpoint is reported without stopping the stream', async () => {
        const { streamer, provider, adapter } = await createHarness();
        const onError = jest.fn();
        streamer.hook('onError', onError);
        jest.spyOn(adapter, 'saveState').mockRejectedValue(new Error('disk full'));

        provider.addBlock();
        provider.addBlock();
        await expect(streamer.processPendingBlocks()).resolves.toBe(2);

        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'checkpoint', fatal: false }));
        jest.restoreAllMocks();
        await streamer.stop();
    });
});

describe('Idempotency ledger', () => {
    test('replaying blocks after a crash does not run contract actions twice', async () => {
        const dbPath = tempDbPath();
        const provider = new MemoryBlockProvider({ startTime: new Date('2026-01-01T00:00:00.000Z') });
        const calls: any[] = [];

        provider.addBlock();
        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('game', 'play', { round: 1 }))]);
        provider.addBlock([transferOp('bob', '2.000 HIVE', memo('game', 'play', { round: 2 }))]);

        const first = await createHarness({ provider, adapter: new SqliteAdapter(dbPath), genesis: false, config: { lastBlockNumber: 1 } });
        await first.streamer.registerContract(createCountingContract(calls).contract);
        await first.streamer.processPendingBlocks();
        expect(calls).toHaveLength(2);

        // Simulate a crash where the checkpoint was lost: a fresh process
        // resumes from an older block against the same database.
        const second = await createHarness({
            provider,
            adapter: new SqliteAdapter(dbPath),
            config: { resumeFromState: false, lastBlockNumber: 1 },
            genesis: false
        });
        await second.streamer.registerContract(createCountingContract(calls).contract);
        await second.streamer.processPendingBlocks();

        expect(calls).toHaveLength(2);

        await first.streamer.stop();
        await second.streamer.stop();
    });

    test('records ledger entries keyed by transaction id and operation index', async () => {
        const { streamer, provider, adapter } = await createHarness();
        await streamer.registerContract(createCountingContract().contract);

        const block = provider.addBlock([
            transferOp('alice', '1.000 HIVE', memo('game', 'play')),
            transferOp('bob', '1.000 HIVE', memo('game', 'play'))
        ]);
        await streamer.processPendingBlocks();

        const rows = await (adapter as SqliteAdapter).getDb()('processed_operations').select();
        const trxId = block.transaction_ids[0];

        expect(rows.map((row: any) => row.key).sort()).toEqual([`op:${trxId}:0`, `op:${trxId}:1`]);
        expect(rows.every((row: any) => row.status === 'success' && row.contract === 'game')).toBe(true);

        await streamer.stop();
    });

    test('can be disabled', async () => {
        const calls: any[] = [];
        const { streamer, provider } = await createHarness({ config: { idempotency: false } });
        await streamer.registerContract(createCountingContract(calls).contract);

        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('game', 'play'))]);
        await streamer.processPendingBlocks();
        await streamer.replayBlocks(2, 2);

        expect(calls).toHaveLength(2);
        await streamer.stop();
    });

    test('replayBlocks skips already-processed actions unless forced', async () => {
        const calls: any[] = [];
        const { streamer, provider } = await createHarness();
        await streamer.registerContract(createCountingContract(calls).contract);

        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('game', 'play'))]);
        await streamer.processPendingBlocks();
        expect(calls).toHaveLength(1);

        await streamer.replayBlocks(2, 2);
        expect(calls).toHaveLength(1);

        await streamer.replayBlocks(2, 2, { force: true });
        expect(calls).toHaveLength(2);

        await streamer.stop();
    });

    test('time actions are not re-run when a block is replayed', async () => {
        const ticks: Date[] = [];
        const provider = new MemoryBlockProvider({ startTime: new Date('2026-01-01T00:00:00.000Z') });
        const { streamer } = await createHarness({ provider });

        await streamer.registerContract(defineContract({
            name: 'clock',
            actions: {
                tick: action((_payload, ctx) => {
                    ticks.push(ctx.block.time);
                }, { trigger: 'time' })
            }
        }));

        await streamer.registerAction(new TimeAction('1m', 'clock-tick', 'clock', 'tick', {}, provider.currentTime));

        provider.addBlock([], { time: new Date(provider.currentTime.getTime() + 61_000) });
        await streamer.processPendingBlocks();
        expect(ticks).toHaveLength(1);

        // Rewind the action as if its state had not been persisted, then replay.
        streamer.getAction('clock-tick')!.reset(new Date('2026-01-01T00:00:00.000Z'));
        await streamer.replayBlocks(2, 2);

        expect(ticks).toHaveLength(1);
        expect(streamer.getAction('clock-tick')!.executionCount).toBe(2);

        await streamer.stop();
    });

    test('SqliteAdapter prunes ledger rows older than a block', async () => {
        const adapter = new SqliteAdapter(':memory:');
        await adapter.create();

        await adapter.markOperationProcessed({ key: 'a', blockNumber: 10, status: 'success' });
        await adapter.markOperationProcessed({ key: 'b', blockNumber: 20, status: 'success' });
        await adapter.markOperationProcessed({ key: 'a', blockNumber: 10, status: 'failed' });

        expect(await adapter.hasProcessedOperation('a')).toBe(true);
        expect(await adapter.pruneProcessedOperations(15)).toBe(1);
        expect(await adapter.hasProcessedOperation('a')).toBe(false);
        expect(await adapter.hasProcessedOperation('b')).toBe(true);

        await adapter.destroy();
    });

    test('the base adapter keeps an in-memory ledger', async () => {
        const adapter = new AdapterBase();

        expect(await adapter.hasProcessedOperation('x')).toBe(false);
        await adapter.markOperationProcessed({ key: 'x', blockNumber: 5, status: 'success' });
        expect(await adapter.hasProcessedOperation('x')).toBe(true);
        expect(await adapter.pruneProcessedOperations(6)).toBe(1);
        expect(await adapter.hasProcessedOperation('x')).toBe(false);
    });

    test('SqliteAdapter migrates an existing params table to add lastBlockId', async () => {
        const dbPath = tempDbPath();
        const legacy = new SqliteAdapter(dbPath);
        await legacy.getDb().schema.createTable('params', (table) => {
            table.integer('id').primary();
            table.integer('lastBlockNumber');
            table.text('actions');
        });
        await legacy.getDb()('params').insert({ id: 1, lastBlockNumber: 42, actions: '[]' });
        await legacy.destroy();

        const upgraded = new SqliteAdapter(dbPath);
        await upgraded.create();
        await upgraded.saveState({ lastBlockNumber: 43, lastBlockId: 'abc', actions: [] });

        expect(await upgraded.loadState()).toMatchObject({ lastBlockNumber: 43, lastBlockId: 'abc' });
        await upgraded.destroy();
    });
});

describe('State restore', () => {
    test('coerces string block numbers from adapters (e.g. pg BIGINT)', async () => {
        class StringStateAdapter extends AdapterBase {
            public async loadState() {
                return { lastBlockNumber: '500', lastBlockId: 'block-500', actions: [] };
            }

            public async saveState() {
                return true;
            }
        }

        const { streamer } = await createHarness({ adapter: new StringStateAdapter(), genesis: false });
        await streamer.init();

        expect(streamer.getStatus().lastBlockNumber).toBe(500);
        expect(streamer.getStatus().lastBlockId).toBe('block-500');
        await streamer.stop();
    });

    test('restores persisted time actions on init', async () => {
        const dbPath = tempDbPath();
        const seed = new SqliteAdapter(dbPath);
        await seed.create();
        await seed.saveState({
            lastBlockNumber: 0,
            actions: [new TimeAction('1h', 'hourly-draw', 'lotto', 'draw').toJSON()]
        });
        await seed.destroy();

        const { streamer } = await createHarness({ adapter: new SqliteAdapter(dbPath) });
        await streamer.init();

        expect(streamer.getAction('hourly-draw')).toBeInstanceOf(TimeAction);
        await streamer.stop();
    });
});
