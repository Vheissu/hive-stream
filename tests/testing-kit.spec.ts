import { PrivateKey } from '@hiveio/dhive';
import { z } from 'zod';

import { action, defineContract, TimeAction } from '../src';
import { createTipJarContract } from '../src/contracts/tipjar.contract';
import { createDiceContract } from '../src/contracts/dice.contract';
import {
    createTestStreamer,
    FakeHiveClient,
    hbd,
    hive,
    MemoryBlockProvider,
    parseDuration,
    TestStreamer
} from '../src/testing';

const TEST_ACTIVE_KEY = PrivateKey.fromSeed('hive-stream testing kit').toString();

describe('Testing kit helpers', () => {
    test('hive() and hbd() format asset strings', () => {
        expect(hive(1)).toBe('1.000 HIVE');
        expect(hive(1.5)).toBe('1.500 HIVE');
        expect(hbd(0.25)).toBe('0.250 HBD');
    });

    test('parseDuration handles numbers and duration strings', () => {
        expect(parseDuration(500)).toBe(500);
        expect(parseDuration('30s')).toBe(30_000);
        expect(parseDuration('5m')).toBe(300_000);
        expect(parseDuration('1h')).toBe(3_600_000);
        expect(parseDuration('2d')).toBe(172_800_000);
        expect(parseDuration('1w')).toBe(604_800_000);
        expect(() => parseDuration('tomorrow')).toThrow(/invalid duration/);
    });
});

describe('MemoryBlockProvider', () => {
    test('mints monotonically increasing blocks with hive-style ids and timestamps', async () => {
        const provider = new MemoryBlockProvider({ startTime: new Date('2026-01-01T00:00:00.000Z') });

        const first = provider.addBlock([['transfer', { from: 'a', to: 'b', amount: '1.000 HIVE', memo: '' }]]);
        const second = provider.addBlock();

        expect(first.block_id).toHaveLength(40);
        expect(second.previous).toBe(first.block_id);
        expect(first.timestamp).toBe('2026-01-01T00:00:00');
        expect(second.timestamp).toBe('2026-01-01T00:00:03');

        const props = await provider.getDynamicGlobalProperties();
        expect(props.head_block_number).toBe(2);

        expect(await provider.getBlock(1)).toBe(first);
        expect(await provider.getBlock(99)).toBeNull();
    });

    test('rejects blocks that move time backwards', () => {
        const provider = new MemoryBlockProvider({ startTime: new Date('2026-01-01T00:00:00.000Z') });
        provider.addBlock();

        expect(() => provider.addBlock([], { time: new Date('2025-12-31T23:59:59.000Z') }))
            .toThrow(/earlier than head time/);
    });
});

describe('FakeHiveClient', () => {
    test('records broadcasts and returns fake transaction results', async () => {
        const client = new FakeHiveClient();

        const result = await client.broadcast.transfer({ from: 'app', to: 'alice', amount: '1.000 HIVE', memo: 'hi' });

        expect(result.id).toMatch(/^fake-trx-/);
        expect(client.transfers).toEqual([{ from: 'app', to: 'alice', amount: '1.000 HIVE', memo: 'hi' }]);
    });

    test('answers reads from fixtures with function and value responders', async () => {
        const client = new FakeHiveClient();
        client.onCall('get_order_book', { bids: [], asks: [] });
        client.onCall('condenser_api.get_content', (params: any[]) => ({ author: params[0], permlink: params[1] }));
        client.setAccount('alice', { balance: '12.000 HIVE' });

        expect(await client.call('condenser_api', 'get_order_book', [10])).toEqual({ bids: [], asks: [] });
        expect(await client.call('condenser_api', 'get_content', ['alice', 'my-post'])).toEqual({ author: 'alice', permlink: 'my-post' });
        expect(await client.call('condenser_api', 'get_unstubbed_thing', [])).toBeNull();

        const [account] = await client.database.getAccounts(['alice']);
        expect(account.balance).toBe('12.000 HIVE');
    });
});

describe('TestStreamer', () => {
    let ts: TestStreamer;

    afterEach(async () => {
        if (ts) {
            await ts.stop();
        }
    });

    test('dispatches contract actions from transfer memos', async () => {
        const received: any[] = [];

        const contract = defineContract({
            name: 'greeter',
            actions: {
                greet: action(async (payload: any, ctx) => {
                    received.push({ payload, sender: ctx.sender, amount: ctx.transfer?.amount, asset: ctx.transfer?.asset });
                }, { trigger: 'transfer' })
            }
        });

        ts = await createTestStreamer();
        await ts.streamer.registerContract(contract);

        await ts.contractTransfer({
            from: 'alice',
            contract: 'greeter',
            action: 'greet',
            payload: { name: 'world' },
            amount: hive(2)
        });

        expect(received).toEqual([
            { payload: { name: 'world' }, sender: 'alice', amount: '2.000', asset: 'HIVE' }
        ]);
    });

    test('dispatches contract actions from custom JSON and enforces active key', async () => {
        const calls: string[] = [];

        const contract = defineContract({
            name: 'vault',
            actions: {
                open: action(async (_payload: any, ctx) => {
                    calls.push(ctx.sender as string);
                }, { trigger: 'custom_json', requiresActiveKey: true })
            }
        });

        ts = await createTestStreamer();
        await ts.streamer.registerContract(contract);

        await ts.contractJson('mallory', { contract: 'vault', action: 'open' });
        expect(calls).toEqual([]);

        await ts.contractJson('alice', { contract: 'vault', action: 'open', activeKey: true });
        expect(calls).toEqual(['alice']);
    });

    test('rejects payloads that fail the action schema', async () => {
        const calls: any[] = [];

        const contract = defineContract({
            name: 'strict',
            actions: {
                submit: action(async (payload: any) => {
                    calls.push(payload);
                }, {
                    trigger: 'custom_json',
                    schema: z.object({ count: z.number().int().positive() })
                })
            }
        });

        ts = await createTestStreamer();
        await ts.streamer.registerContract(contract);

        await ts.contractJson('alice', { contract: 'strict', action: 'submit', payload: { count: -5 } });
        expect(calls).toEqual([]);

        await ts.contractJson('alice', { contract: 'strict', action: 'submit', payload: { count: 3 } });
        expect(calls).toEqual([{ count: 3 }]);
    });

    test('fires transfer and custom JSON subscriptions', async () => {
        ts = await createTestStreamer({ username: 'myapp' });

        const transfers: any[] = [];
        const jsons: any[] = [];

        ts.streamer.onTransfer('myapp', (op: any) => {
            transfers.push(op);
        });

        ts.streamer.onCustomJsonId('my-custom-id', (op: any, { sender }: any) => {
            jsons.push({ op, sender });
        });

        await ts.transfer('alice', 'myapp', hive(1), 'plain memo');
        await ts.transfer('alice', 'someoneelse', hive(1), 'not for us');
        await ts.customJson('bob', { hello: true }, { id: 'my-custom-id' });

        expect(transfers).toHaveLength(1);
        expect(transfers[0].memo).toBe('plain memo');
        expect(jsons).toHaveLength(1);
        expect(jsons[0].sender).toBe('bob');
    });

    test('captures outgoing broadcasts from contract handlers', async () => {
        const contract = defineContract({
            name: 'payer',
            actions: {
                payout: action(async (_payload: any, ctx) => {
                    await ctx.streamer.transferHiveTokens('myapp', ctx.sender as string, '0.500', 'HIVE', 'winnings');
                }, { trigger: 'transfer' })
            }
        });

        ts = await createTestStreamer({ username: 'myapp', activeKey: TEST_ACTIVE_KEY });
        await ts.streamer.registerContract(contract);

        await ts.contractTransfer({ from: 'alice', contract: 'payer', action: 'payout' });

        expect(ts.outgoingTransfers).toEqual([
            { from: 'myapp', to: 'alice', amount: '0.500 HIVE', memo: 'winnings' }
        ]);
    });

    test('runs TimeActions when time advances, and only when due', async () => {
        const executions: Date[] = [];

        const contract = defineContract({
            name: 'scheduler',
            actions: {
                tick: action(async (_payload: any, ctx) => {
                    executions.push(ctx.block.time);
                }, { trigger: 'time' })
            }
        });

        ts = await createTestStreamer();
        await ts.streamer.registerContract(contract);
        await ts.streamer.registerAction(new TimeAction('1h', 'hourly-tick', 'scheduler', 'tick', {}, ts.currentTime));

        await ts.advanceBlocks(2);
        expect(executions).toHaveLength(0);

        await ts.advanceTime('1h');
        expect(executions).toHaveLength(1);

        await ts.advanceBlocks(1);
        expect(executions).toHaveLength(1);

        await ts.advanceTime('30m');
        expect(executions).toHaveLength(1);

        await ts.advanceTime('30m');
        expect(executions).toHaveLength(2);
    });

    test('fires a TimeAction when advancing by exactly its interval', async () => {
        // Regression: provider time is truncated to whole seconds like real
        // Hive timestamps. With millisecond precision retained, an action
        // anchored at currentTime would sit fractionally in the future and
        // miss an exact-interval advance.
        const executions: number[] = [];

        const contract = defineContract({
            name: 'exact',
            actions: {
                tick: action(async (_payload: any, ctx) => {
                    executions.push(ctx.block.number);
                }, { trigger: 'time' })
            }
        });

        ts = await createTestStreamer({ startTime: new Date('2026-01-01T00:00:00.789Z') });
        await ts.streamer.registerContract(contract);
        await ts.streamer.registerAction(new TimeAction('1h', 'exact-tick', 'exact', 'tick', {}, ts.currentTime));

        await ts.advanceTime('1h');
        expect(executions).toHaveLength(1);
    });

    test('works end-to-end with a built-in SQL contract (tipjar)', async () => {
        ts = await createTestStreamer({ username: 'myapp' });
        await ts.streamer.registerContract(createTipJarContract());

        await ts.contractTransfer({
            from: 'alice',
            contract: 'tipjar',
            action: 'tip',
            payload: { message: 'great post!' },
            amount: hbd(5)
        });

        const rows = await ts.adapter.query('SELECT * FROM tipjar_tips');
        expect(rows).toHaveLength(1);
        expect(rows[0].from_account).toBe('alice');
        expect(rows[0].amount).toBe('5.000');
        expect(rows[0].asset).toBe('HBD');
        expect(rows[0].message).toBe('great post!');

        const events = await ts.getEvents();
        expect(events).toHaveLength(1);
        expect(events[0].contract).toBe('tipjar');
    });

    test('persists and restores block position through the adapter', async () => {
        ts = await createTestStreamer();

        await ts.advanceBlocks(5);
        await ts.streamer.saveStateToDisk();

        const state = await ts.adapter.loadState();
        expect(state.lastBlockNumber).toBe(ts.headBlockNumber);
    });

    test('runs built-in games that re-read their transaction, with no keys configured', async () => {
        ts = await createTestStreamer({ username: 'myhouse' });
        ts.client.setAccount('myhouse', { balance: '1000.000 HIVE' });
        // Loss notices are opt-in; turn them on so every outcome sends one transfer.
        await ts.streamer.registerContract(createDiceContract({ account: 'myhouse', notifyLosses: true }));

        await ts.contractTransfer({ from: 'alice', amount: '5.000 HIVE', contract: 'hivedice', action: 'roll', payload: { roll: 50 } });

        // Win or lose, the house answers the bet with exactly one transfer.
        expect(ts.outgoingTransfers).toHaveLength(1);
        expect(ts.outgoingTransfers[0]).toMatchObject({ from: 'myhouse', to: 'alice' });
        expect(ts.outgoingTransfers[0].memo).toMatch(/Fair: seed #0 nonce 0/);
    });

    test('anchors a TimeAction registered without a date to simulated chain time', async () => {
        const executions: Date[] = [];

        const contract = defineContract({
            name: 'undated',
            actions: {
                tick: action(async (_payload: any, ctx) => {
                    executions.push(ctx.block.time);
                }, { trigger: 'time' })
            }
        });

        ts = await createTestStreamer({ startTime: new Date('2024-01-01T00:00:00Z') });
        await ts.streamer.registerContract(contract);

        const timeAction = new TimeAction('1m', 'undated-tick', 'undated', 'tick');
        expect(timeAction.hasExplicitDate).toBe(false);
        expect(Object.keys(timeAction)).not.toContain('hasExplicitDate');
        expect(timeAction.toJSON()).not.toHaveProperty('hasExplicitDate');

        await ts.streamer.registerAction(timeAction);
        expect(timeAction.date.getTime()).toBe(ts.currentTime.getTime());

        await ts.advanceTime('1m');
        expect(executions).toHaveLength(1);
    });

    test('advanceTime fires a due action at most once per call', async () => {
        let executions = 0;

        const contract = defineContract({
            name: 'once',
            actions: {
                tick: action(async () => {
                    executions++;
                }, { trigger: 'time' })
            }
        });

        ts = await createTestStreamer({ startTime: new Date('2024-01-01T00:00:00Z') });
        await ts.streamer.registerContract(contract);
        await ts.streamer.registerAction(new TimeAction('1m', 'once-tick', 'once', 'tick'));

        await ts.advanceTime('10m');
        expect(executions).toBe(1);
    });

    test('keeps an explicit TimeAction date', async () => {
        ts = await createTestStreamer({ startTime: new Date('2024-01-01T00:00:00Z') });
        await ts.streamer.registerContract(defineContract({
            name: 'dated',
            actions: { tick: action(async () => undefined, { trigger: 'time' }) }
        }));

        const start = new Date('2023-06-01T00:00:00Z');
        const timeAction = new TimeAction('1h', 'dated-tick', 'dated', 'tick', {}, start);

        expect(timeAction.hasExplicitDate).toBe(true);
        await ts.streamer.registerAction(timeAction);
        expect(timeAction.date).toEqual(start);

        // Assigning a date after construction also counts as explicit.
        const reassigned = new TimeAction('1h', 'reassigned-tick', 'dated', 'tick');
        expect(reassigned.hasExplicitDate).toBe(false);
        reassigned.date = start;
        expect(reassigned.hasExplicitDate).toBe(true);
        await ts.streamer.registerAction(reassigned);
        expect(reassigned.date).toBe(start);
    });

    test('outgoingTransfers includes transfers sent in operation batches, and comments are captured', async () => {
        const contract = defineContract({
            name: 'batcher',
            actions: {
                pay: action(async (_payload: any, ctx) => {
                    await ctx.streamer.transferHiveTokens('myapp', ctx.sender as string, '0.100', 'HIVE', 'single');
                    await ctx.streamer.broadcastOperations([
                        ['transfer', { from: 'myapp', to: 'bob', amount: '0.200 HIVE', memo: 'batched' }],
                        ['comment', {
                            parent_author: 'alice',
                            parent_permlink: 'post',
                            author: 'myapp',
                            permlink: 're-post',
                            title: '',
                            body: 'Thanks!',
                            json_metadata: '{}'
                        }]
                    ]);
                }, { trigger: 'transfer' })
            }
        });

        ts = await createTestStreamer({ username: 'myapp', activeKey: TEST_ACTIVE_KEY });
        await ts.streamer.registerContract(contract);
        await ts.contractTransfer({ from: 'alice', contract: 'batcher', action: 'pay' });

        expect(ts.outgoingTransfers).toEqual([
            { from: 'myapp', to: 'alice', amount: '0.100 HIVE', memo: 'single' },
            { from: 'myapp', to: 'bob', amount: '0.200 HIVE', memo: 'batched' }
        ]);
        expect(ts.client.transfers).toHaveLength(1);
        expect(ts.comments).toEqual([
            expect.objectContaining({ author: 'myapp', permlink: 're-post', parent_author: 'alice' })
        ]);
    });

    test('transfer rejects malformed amounts with a helpful error', async () => {
        ts = await createTestStreamer();

        await expect(ts.transfer('alice', 'bob', '1 hive')).rejects.toThrow(/hive\(\)\/hbd\(\)/);
    });
});
