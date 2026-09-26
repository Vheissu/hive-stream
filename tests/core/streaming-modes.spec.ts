import { action, defineContract, TimeAction } from '../../src';
import { MemoryBlockProvider, createTestStreamer } from '../../src/testing';
import { createCountingContract, createHarness, memo, transferOp } from './helpers';

describe('Irreversible streaming', () => {
    test('only processes blocks up to the last irreversible block by default', async () => {
        const provider = new MemoryBlockProvider({ irreversibleLag: 2 });

        for (let i = 0; i < 3; i++) {
            provider.addBlock();
        }

        const { streamer } = await createHarness({ provider, genesis: false });
        const seen: number[] = [];
        streamer.onBlock((_block, blockNumber) => { seen.push(blockNumber); });

        await streamer.processPendingBlocks();
        expect(seen).toEqual([1]);

        for (let i = 0; i < 3; i++) {
            provider.addBlock();
        }

        await streamer.processPendingBlocks();

        expect(provider.lastIrreversibleBlockNumber).toBe(4);
        expect(seen).toEqual([1, 2, 3, 4]);
        expect(streamer.getStatus()).toMatchObject({
            streamMode: 'irreversible',
            headBlockNumber: 6,
            irreversibleBlockNumber: 4,
            targetBlockNumber: 4,
            lastBlockNumber: 4,
            blocksBehind: 0
        });

        await streamer.stop();
    });

    test('waits when no block is irreversible yet', async () => {
        const provider = new MemoryBlockProvider({ irreversibleLag: 5 });
        provider.addBlock();

        const { streamer } = await createHarness({ provider, genesis: false });

        expect(await streamer.processPendingBlocks()).toBe(0);
        expect(streamer.getStatus().lastBlockNumber).toBe(0);
        await streamer.stop();
    });

    test('head mode processes up to the head block', async () => {
        const provider = new MemoryBlockProvider({ irreversibleLag: 3 });
        const { streamer } = await createHarness({ provider, genesis: false, config: { streamMode: 'head' } });
        const seen: number[] = [];
        streamer.onBlock((_block, blockNumber) => { seen.push(blockNumber); });

        provider.addBlock();
        await streamer.processPendingBlocks();
        provider.addBlock();
        provider.addBlock();
        await streamer.processPendingBlocks();

        expect(seen).toEqual([1, 2, 3]);
        expect(streamer.getStatus().targetBlockNumber).toBe(3);
        await streamer.stop();
    });

    test('providers without last_irreversible_block_num fall back to head', async () => {
        const { streamer, provider } = await createHarness();
        jest.spyOn(provider, 'getDynamicGlobalProperties').mockImplementation(async () => ({
            head_block_number: provider.head,
            time: '2026-01-01T00:00:00'
        }));

        provider.addBlock();
        expect(await streamer.processPendingBlocks()).toBe(1);
        await streamer.stop();
    });

    test('the testing kit can simulate irreversibility lag', async () => {
        const ts = await createTestStreamer({ irreversibleLag: 1 });
        const seen: number[] = [];
        ts.streamer.onBlock((_block, blockNumber) => { seen.push(blockNumber); });

        await ts.advanceBlocks(3);

        expect(ts.headBlockNumber).toBe(4);
        expect(seen[seen.length - 1]).toBe(3);
        await ts.stop();
    });
});

describe('Fork handling in head mode', () => {
    test('rewinds to the common ancestor, reprocesses the new branch, and reports orphans', async () => {
        const calls: any[] = [];
        const { streamer, provider } = await createHarness({ config: { streamMode: 'head' } });
        await streamer.registerContract(createCountingContract(calls).contract);
        const onFork = jest.fn();
        streamer.hook('onFork', onFork);

        const replayedTrxId = 'aa'.repeat(20);

        provider.addBlock(); // 2
        const orphan = provider.addBlock([transferOp('alice', '1.000 HIVE', memo('game', 'play', { n: 1 }))], {
            transactionIds: [replayedTrxId]
        }); // 3
        const orphan4 = provider.addBlock([transferOp('bob', '1.000 HIVE', memo('game', 'play', { n: 2 }))]); // 4
        await streamer.processPendingBlocks();
        expect(calls).toHaveLength(2);

        // A microfork replaces block 3 and 4. Alice's transaction is re-included
        // on the new branch; Bob's is not.
        provider.forkAt(3, [transferOp('alice', '1.000 HIVE', memo('game', 'play', { n: 1 }))], {
            transactionIds: [replayedTrxId]
        });
        provider.addBlock(); // new 4
        provider.addBlock(); // 5

        await streamer.processPendingBlocks();

        expect(onFork).toHaveBeenCalledTimes(1);
        expect(onFork.mock.calls[0][0]).toMatchObject({
            blockNumber: 5,
            commonAncestor: 2,
            orphanedBlocks: [
                { blockNumber: 4, blockId: orphan4.block_id },
                { blockNumber: 3, blockId: orphan.block_id }
            ]
        });

        // Alice's re-included transaction did not execute a second time.
        expect(calls).toHaveLength(2);
        expect(streamer.getStatus().lastBlockNumber).toBe(5);
        expect(streamer.getStatus().lastBlockId).toBe((await provider.getBlock(5))!.block_id);

        await streamer.stop();
    });

    test('halts when the fork is deeper than MAX_FORK_DEPTH', async () => {
        const { streamer, provider } = await createHarness({ config: { streamMode: 'head', maxForkDepth: 2 } });
        const onError = jest.fn();
        streamer.hook('onError', onError);

        for (let i = 0; i < 5; i++) {
            provider.addBlock();
        }

        await streamer.processPendingBlocks();
        provider.forkAt(2);
        for (let i = 0; i < 5; i++) {
            provider.addBlock();
        }

        await expect(streamer.processPendingBlocks()).rejects.toThrow(/MAX_FORK_DEPTH/);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'fork', fatal: true }));
        expect(streamer.getHealth().status).toBe('halted');

        await streamer.stop();
    });

    test('does not process a block that fails to link to a still-canonical parent', async () => {
        const { streamer, provider } = await createHarness({ config: { streamMode: 'head' } });
        provider.addBlock();
        await streamer.processPendingBlocks();

        const next = provider.addBlock();
        const bogus = { ...next, previous: 'ff'.repeat(20) };
        const original = provider.getBlock.bind(provider);
        jest.spyOn(provider, 'getBlock').mockImplementation(async (blockNumber) => {
            return blockNumber === 3 ? bogus : original(blockNumber);
        });

        expect(await streamer.processPendingBlocks()).toBe(0);
        expect(streamer.getStatus().lastBlockNumber).toBe(2);

        jest.restoreAllMocks();
        expect(await streamer.processPendingBlocks()).toBe(1);
        await streamer.stop();
    });
});

describe('Block processing order', () => {
    test('onBlock receives the number of the block being processed', async () => {
        const { streamer, provider } = await createHarness();
        const seen: Array<[string, number]> = [];
        streamer.onBlock((block, blockNumber) => { seen.push([block.block_id, blockNumber]); });

        const a = provider.addBlock();
        const b = provider.addBlock();
        await streamer.processPendingBlocks();

        expect(seen).toEqual([[a.block_id, 2], [b.block_id, 3]]);
        await streamer.stop();
    });

    test('time actions run after the block operations, using the block timestamp', async () => {
        const order: string[] = [];
        const { streamer, provider } = await createHarness();

        await streamer.registerContract(defineContract({
            name: 'clock',
            actions: {
                tick: action((_payload, ctx) => {
                    order.push(`tick@${ctx.block.number}:${ctx.block.time.toISOString()}`);
                }, { trigger: 'time' }),
                note: action((payload: any) => {
                    order.push(`note:${payload.n}`);
                }, { trigger: 'transfer' })
            }
        }));

        await streamer.registerAction(new TimeAction('1m', 'clock-tick', 'clock', 'tick', {}, provider.currentTime));

        const due = new Date(provider.currentTime.getTime() + 60_000);
        provider.addBlock([transferOp('alice', '0.001 HIVE', memo('clock', 'note', { n: 1 }))], { time: due });
        await streamer.processPendingBlocks();

        expect(order).toEqual(['note:1', `tick@2:${due.toISOString()}`]);
        await streamer.stop();
    });

    test('async subscribers are awaited in order', async () => {
        const { streamer, provider } = await createHarness();
        const order: string[] = [];

        streamer.onTransfer('app', async (op) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push(`slow:${op.from}`);
        });
        streamer.onTransfer('app', (op) => {
            order.push(`fast:${op.from}`);
        });

        provider.addBlock([transferOp('alice', '1.000 HIVE', ''), transferOp('bob', '1.000 HIVE', '')]);
        await streamer.processPendingBlocks();

        expect(order).toEqual(['slow:alice', 'fast:alice', 'slow:bob', 'fast:bob']);
        await streamer.stop();
    });

    test('a throwing subscriber is isolated and reported', async () => {
        const { streamer, provider } = await createHarness();
        const onError = jest.fn();
        const received: string[] = [];
        streamer.hook('onError', onError);

        streamer.onCustomJson(() => {
            throw new Error('subscriber bug');
        });
        streamer.onCustomJson((op) => {
            received.push(op.id);
        });

        provider.addBlock([['custom_json', { id: 'app', json: '{}', required_auths: [], required_posting_auths: ['alice'] }]]);
        await streamer.processPendingBlocks();

        expect(received).toEqual(['app']);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'subscription', fatal: false }));
        expect(streamer.getStatus().lastBlockNumber).toBe(2);
        await streamer.stop();
    });

    test('recurrent transfers expose transfer details to contracts', async () => {
        const seen: any[] = [];
        const { streamer, provider } = await createHarness();

        await streamer.registerContract(defineContract({
            name: 'subs',
            actions: {
                renew: action((_payload, ctx) => { seen.push(ctx.transfer); }, { trigger: 'recurrent_transfer' })
            }
        }));

        provider.addBlock([['recurrent_transfer', {
            from: 'alice',
            to: 'app',
            amount: '5.000 HBD',
            memo: memo('subs', 'renew'),
            recurrence: 24,
            executions: 12
        }]]);
        await streamer.processPendingBlocks();

        expect(seen).toEqual([expect.objectContaining({ from: 'alice', amount: '5.000', asset: 'HBD' })]);
        await streamer.stop();
    });
});
