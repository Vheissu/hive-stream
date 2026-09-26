import { action, defineContract, SqliteAdapter, StreamHaltError, Streamer } from '../../src';
import { createHarness, memo, transferOp } from './helpers';

function createFlakyContract(failures: { remaining: number }, calls: string[]) {
    return defineContract({
        name: 'flaky',
        actions: {
            pay: action((payload: any) => {
                calls.push(payload.id);

                if (failures.remaining > 0) {
                    failures.remaining--;
                    throw new Error('payout service unavailable');
                }
            }, { trigger: 'transfer' })
        }
    });
}

describe('ERROR_POLICY', () => {
    test('skip (default) logs, reports, and keeps streaming', async () => {
        const calls: string[] = [];
        const { streamer, provider, adapter } = await createHarness();
        const onContractError = jest.fn();
        streamer.hook('onContractError', onContractError);
        await streamer.registerContract(createFlakyContract({ remaining: 1 }, calls));

        const block = provider.addBlock([transferOp('alice', '1.000 HIVE', memo('flaky', 'pay', { id: 'a' }))]);
        provider.addBlock([transferOp('bob', '1.000 HIVE', memo('flaky', 'pay', { id: 'b' }))]);

        expect(await streamer.processPendingBlocks()).toBe(2);
        expect(calls).toEqual(['a', 'b']);
        expect(onContractError).toHaveBeenCalledWith(expect.objectContaining({
            contract: 'flaky',
            action: 'pay',
            attempt: 1,
            willRetry: false
        }));

        const failed = await (adapter as SqliteAdapter).getDb()('processed_operations')
            .where({ key: `op:${block.transaction_ids[0]}:0` })
            .first();
        expect(failed.status).toBe('failed');

        await streamer.stop();
    });

    test('halt stops at the failing block and resumes from it after the fix', async () => {
        const calls: string[] = [];
        const failures = { remaining: 1 };
        const { streamer, provider } = await createHarness({ config: { errorPolicy: 'halt' } });
        const onError = jest.fn();
        streamer.hook('onError', onError);
        await streamer.registerContract(createFlakyContract(failures, calls));

        provider.addBlock([
            transferOp('alice', '1.000 HIVE', memo('flaky', 'pay', { id: 'ok' }), 'app')
        ]);
        provider.addBlock([transferOp('bob', '1.000 HIVE', memo('flaky', 'pay', { id: 'boom' }))]);
        provider.addBlock([transferOp('carol', '1.000 HIVE', memo('flaky', 'pay', { id: 'later' }))]);

        failures.remaining = 0;
        await streamer.processPendingBlocks(1);
        failures.remaining = 1;

        await expect(streamer.processPendingBlocks()).rejects.toBeInstanceOf(StreamHaltError);

        expect(calls).toEqual(['ok', 'boom']);
        expect(streamer.getStatus().lastBlockNumber).toBe(2);
        expect(streamer.getHealth()).toMatchObject({ status: 'halted', healthy: false });
        expect(streamer.getStatus().lastError).toMatchObject({ phase: 'contract', blockNumber: 3 });
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'contract', fatal: true, blockNumber: 3 }));

        // Operator fixes the problem; processing resumes at the failed block.
        expect(await streamer.processPendingBlocks()).toBe(2);
        expect(calls).toEqual(['ok', 'boom', 'boom', 'later']);
        expect(streamer.getHealth().status).not.toBe('halted');

        await streamer.stop();
    });

    test('retry retries the handler with backoff, then succeeds', async () => {
        const calls: string[] = [];
        const { streamer, provider } = await createHarness({
            config: { errorPolicy: 'retry', errorMaxRetries: 3, errorRetryDelayMs: 1 }
        });
        const onContractError = jest.fn();
        streamer.hook('onContractError', onContractError);
        await streamer.registerContract(createFlakyContract({ remaining: 2 }, calls));

        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('flaky', 'pay', { id: 'x' }))]);
        await streamer.processPendingBlocks();

        expect(calls).toEqual(['x', 'x', 'x']);
        expect(onContractError.mock.calls.map(([ctx]) => [ctx.attempt, ctx.willRetry])).toEqual([[1, true], [2, true]]);
        expect(streamer.getStatus().lastBlockNumber).toBe(2);

        await streamer.stop();
    });

    test('retry halts once retries are exhausted', async () => {
        const calls: string[] = [];
        const { streamer, provider } = await createHarness({
            config: { errorPolicy: 'retry', errorMaxRetries: 2, errorRetryDelayMs: 1 }
        });
        await streamer.registerContract(createFlakyContract({ remaining: 10 }, calls));

        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('flaky', 'pay', { id: 'x' }))]);

        await expect(streamer.processPendingBlocks()).rejects.toThrow(/payout service unavailable/);
        expect(calls).toHaveLength(3);
        expect(streamer.getStatus().lastBlockNumber).toBe(1);

        await streamer.stop();
    });

    test('adapter write failures follow the policy too', async () => {
        const { streamer, provider, adapter } = await createHarness({ config: { errorPolicy: 'halt' } });
        await streamer.registerContract(createFlakyContract({ remaining: 0 }, []));
        jest.spyOn(adapter, 'processTransfer').mockRejectedValueOnce(new Error('db down'));

        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('flaky', 'pay', { id: 'x' }))]);

        await expect(streamer.processPendingBlocks()).rejects.toThrow(/db down/);
        expect(streamer.getStatus().lastError).toMatchObject({ phase: 'operation' });

        jest.restoreAllMocks();
        await streamer.stop();
    });

    test('a halted, started streamer stops polling', async () => {
        const { streamer, provider } = await createHarness({ config: { errorPolicy: 'halt', blockCheckInterval: 5 } });
        await streamer.registerContract(createFlakyContract({ remaining: 10 }, []));
        provider.addBlock([transferOp('alice', '1.000 HIVE', memo('flaky', 'pay', { id: 'x' }))]);

        await streamer.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(streamer.getHealth().status).toBe('halted');
        expect((streamer as any).blockNumberTimeout).toBeNull();

        await streamer.stop();
    });
});

describe('Block fetch backoff', () => {
    test('failed block fetches back off exponentially up to RETRY_MAX_DELAY_MS', async () => {
        const streamer = new Streamer({ blockCheckInterval: 100, retryMaxDelayMs: 350 });
        const onError = jest.fn();
        streamer.hook('onError', onError);

        (streamer as any).blockProvider = {
            getDynamicGlobalProperties: jest.fn().mockRejectedValue(new Error('node unreachable')),
            getBlock: jest.fn()
        };

        const timeoutSpy = jest.spyOn(global, 'setTimeout');
        const delays: number[] = [];

        for (let i = 0; i < 3; i++) {
            await (streamer as any).getBlock();
            delays.push(timeoutSpy.mock.calls[timeoutSpy.mock.calls.length - 1][1] as number);
            clearTimeout((streamer as any).blockNumberTimeout);
        }

        expect(delays).toEqual([200, 350, 350]);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'block', fatal: false }));

        timeoutSpy.mockRestore();
        (streamer as any).disableAllProcessing = true;
    });
});
