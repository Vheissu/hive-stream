import http from 'http';
import { z } from 'zod';
import { createTestStreamer, TestStreamer } from '../src/testing';
import { defineContract, action } from '../src/contracts/contract';
import { createConfig, ConfigValidationError } from '../src/config';
import { Api } from '../src/api';
import { createMockAdapter } from './helpers/mock-adapter';
import { Streamer } from '../src/streamer';

const quiet = () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
};

function paidContract(name: string, handler: jest.Mock, guards?: any) {
    return defineContract({
        name,
        guards,
        actions: {
            pay: action(async (payload, ctx) => {
                handler(payload, ctx);
            }, {
                trigger: 'transfer',
                schema: z.object({ note: z.string().max(20).optional() })
            })
        }
    });
}

describe('Transfer recipient guard', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('a transfer between two other accounts never runs a paid action', async () => {
        const handler = jest.fn();
        const rejected = jest.fn();
        ts = await createTestStreamer({ username: 'myapp' });
        ts.streamer.hook('onActionRejected', rejected);
        await ts.streamer.registerContract(paidContract('shop', handler));

        await ts.contractTransfer({ from: 'mallory', to: 'mallory-alt', amount: '0.001 HIVE', contract: 'shop', action: 'pay' });

        expect(handler).not.toHaveBeenCalled();
        expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: 'recipient_not_allowed' }));
    });

    test('a transfer to the app account runs the action', async () => {
        const handler = jest.fn();
        ts = await createTestStreamer({ username: 'myapp' });
        await ts.streamer.registerContract(paidContract('shop', handler));

        await ts.contractTransfer({ from: 'alice', amount: '1.000 HIVE', contract: 'shop', action: 'pay' });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][1].transfer.to).toBe('myapp');
    });

    test('allowedRecipients widens or opens the accepted recipients', async () => {
        const handler = jest.fn();
        ts = await createTestStreamer({ username: 'myapp' });
        await ts.streamer.registerContract(paidContract('vault', handler, { allowedRecipients: ['myapp', 'treasury'] }));
        await ts.streamer.registerContract(paidContract('open', handler, { allowedRecipients: ['*'] }));

        await ts.contractTransfer({ from: 'alice', to: 'treasury', contract: 'vault', action: 'pay' });
        await ts.contractTransfer({ from: 'alice', to: 'someone', contract: 'vault', action: 'pay' });
        await ts.contractTransfer({ from: 'alice', to: 'someone', contract: 'open', action: 'pay' });

        expect(handler).toHaveBeenCalledTimes(2);
    });

    test('without a username and without allowedRecipients every transfer is rejected', async () => {
        const handler = jest.fn();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const streamer = new Streamer();
        await streamer.registerAdapter(createMockAdapter());
        await streamer.registerContract(paidContract('shop', handler));

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no streamer username is configured'));

        const memo = JSON.stringify({ hive_stream: { contract: 'shop', action: 'pay', payload: {} } });
        await streamer.processOperation(['transfer', { from: 'alice', to: 'shop', amount: '1.000 HIVE', memo }], 1, 'b1', 'b0', 'trx', new Date(), 0);

        expect(handler).not.toHaveBeenCalled();
        await streamer.stop();
    });
});

describe('Refunding rejected transfers', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('is off by default', async () => {
        ts = await createTestStreamer({ username: 'myapp' });
        await ts.streamer.registerContract(paidContract('shop', jest.fn()));

        await ts.contractTransfer({ from: 'alice', amount: '2.000 HIVE', contract: 'shop', action: 'pay', payload: { note: 'this note is far too long' } });

        expect(ts.outgoingTransfers).toHaveLength(0);
    });

    test('sends an invalid payload back to the sender with the reason', async () => {
        ts = await createTestStreamer({ username: 'myapp', refundRejectedTransfers: true });
        await ts.streamer.registerContract(paidContract('shop', jest.fn(), { maxAmount: 1 }));

        await ts.contractTransfer({ from: 'alice', amount: '2.000 HIVE', contract: 'shop', action: 'pay' });
        await ts.contractTransfer({ from: 'bob', amount: '0.500 HBD', contract: 'shop', action: 'pay', payload: { note: 'this note is far too long' } });
        await ts.contractTransfer({ from: 'carol', amount: '0.500 HIVE', contract: 'shop', action: 'missing' });

        expect(ts.outgoingTransfers).toHaveLength(3);
        expect(ts.outgoingTransfers[0]).toMatchObject({ from: 'myapp', to: 'alice', amount: '2.000 HIVE' });
        expect(ts.outgoingTransfers[0].memo).toMatch(/^\[Refund\] .*above the maximum/);
        expect(ts.outgoingTransfers[1]).toMatchObject({ from: 'myapp', to: 'bob', amount: '0.500 HBD' });
        expect(ts.outgoingTransfers[1].memo).toMatch(/^\[Refund\] Invalid payload for shop\.pay \(note: /);
        expect(ts.outgoingTransfers[2]).toMatchObject({ from: 'myapp', to: 'carol', amount: '0.500 HIVE' });
    });

    test('never refunds money that was sent to someone else, or the app\'s own transfers', async () => {
        ts = await createTestStreamer({ username: 'myapp', refundRejectedTransfers: true });
        await ts.streamer.registerContract(paidContract('shop', jest.fn(), { maxAmount: 1 }));

        await ts.contractTransfer({ from: 'alice', to: 'mallory', amount: '2.000 HIVE', contract: 'shop', action: 'pay' });
        await ts.contractTransfer({ from: 'myapp', to: 'myapp', amount: '2.000 HIVE', contract: 'shop', action: 'pay' });

        expect(ts.outgoingTransfers).toHaveLength(0);
    });

    test('a replayed block does not refund twice', async () => {
        ts = await createTestStreamer({ username: 'myapp', refundRejectedTransfers: true });
        await ts.streamer.registerContract(paidContract('shop', jest.fn(), { maxAmount: 1 }));

        const injected = await ts.contractTransfer({ from: 'alice', amount: '2.000 HIVE', contract: 'shop', action: 'pay' });
        expect(ts.outgoingTransfers).toHaveLength(1);

        await ts.streamer.processOperation(
            injected.block.transactions[0].operations[0] as [string, any],
            injected.blockNumber,
            injected.block.block_id,
            injected.block.previous,
            injected.transactionId,
            new Date(injected.block.timestamp),
            0
        );

        expect(ts.outgoingTransfers).toHaveLength(1);
    });
});

describe('Flow helpers', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('act on every transfer in a transaction, not just the first', async () => {
        ts = await createTestStreamer({ username: 'myapp' });
        ts.streamer.autoRefundIncomingTransfers();

        await ts.sendOperations([
            ['transfer', { from: 'alice', to: 'myapp', amount: '1.000 HIVE', memo: '' }],
            ['transfer', { from: 'alice', to: 'myapp', amount: '5.000 HIVE', memo: '' }]
        ]);

        expect(ts.outgoingTransfers.map((transfer) => transfer.amount)).toEqual(['1.000 HIVE', '5.000 HIVE']);
    });

    test('remember what they paid in the idempotency ledger so a reprocessed block pays once', async () => {
        ts = await createTestStreamer({ username: 'myapp' });
        ts.streamer.autoRefundIncomingTransfers();

        const injected = await ts.transfer('alice', 'myapp', '1.000 HIVE', 'oops');
        expect(ts.outgoingTransfers).toHaveLength(1);

        const adapter = ts.streamer.getAdapter();
        await expect(adapter.hasProcessedOperation(`flow:autoRefundIncomingTransfers:${injected.transactionId}:0`)).resolves.toBe(true);

        await ts.streamer.processOperation(
            injected.block.transactions[0].operations[0] as [string, any],
            injected.blockNumber,
            injected.block.block_id,
            injected.block.previous,
            injected.transactionId,
            new Date(injected.block.timestamp),
            0
        );

        expect(ts.outgoingTransfers).toHaveLength(1);
    });
});

describe('Halting and restarting', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('start() resumes at the failed block once the cause is fixed', async () => {
        let broken = true;
        const handler = jest.fn(async () => {
            if (broken) {
                throw new Error('database is read-only');
            }
        });

        ts = await createTestStreamer({ username: 'myapp', errorPolicy: 'halt' });
        await ts.streamer.registerContract(defineContract({
            name: 'fragile',
            actions: { go: action(handler, { trigger: 'custom_json' }) }
        }));

        await expect(ts.contractJson('alice', { contract: 'fragile', action: 'go' })).rejects.toThrow('database is read-only');

        const haltedHealth = ts.streamer.getHealth();
        expect(haltedHealth.status).toBe('halted');
        expect(haltedHealth.isStarted).toBe(false);
        expect(ts.streamer.getStatus().lastError).toMatchObject({ phase: 'contract' });

        broken = false;
        await ts.streamer.start();

        expect(ts.streamer.getHealth().status).not.toBe('halted');

        // start() polls in the background; give it a moment to reach the block.
        const deadline = Date.now() + 5000;
        while (handler.mock.calls.length < 2 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(handler).toHaveBeenCalledTimes(2);
        expect(ts.streamer.getStatus().lastBlockNumber).toBe(ts.headBlockNumber);
    });
});

describe('Ledger writes', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('a failed ledger write is retried on its own and never re-runs the handler', async () => {
        const handler = jest.fn();
        ts = await createTestStreamer({ username: 'myapp', errorPolicy: 'retry', errorMaxRetries: 2, errorRetryDelayMs: 1 });
        await ts.streamer.registerContract(defineContract({
            name: 'payout',
            actions: { go: action(handler, { trigger: 'custom_json' }) }
        }));

        const adapter = ts.streamer.getAdapter();
        const original = adapter.markOperationProcessed.bind(adapter);
        const mark = jest.spyOn(adapter, 'markOperationProcessed')
            .mockImplementationOnce(async () => { throw new Error('connection reset'); })
            .mockImplementation(original);

        const injected = await ts.contractJson('alice', { contract: 'payout', action: 'go' });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(mark).toHaveBeenCalledTimes(2);
        await expect(adapter.hasProcessedOperation(`op:${injected.transactionId}:0`)).resolves.toBe(true);
    });
});

describe('Hooks', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('a throwing beforeOperation hook skips the operation instead of letting it through', async () => {
        const handler = jest.fn();
        const onError = jest.fn();
        ts = await createTestStreamer({ username: 'myapp' });
        ts.streamer.hook('beforeOperation', () => { throw new Error('blocklist unavailable'); });
        ts.streamer.hook('onError', onError);
        await ts.streamer.registerContract(defineContract({
            name: 'guarded',
            actions: { go: action(handler, { trigger: 'custom_json' }) }
        }));

        await ts.contractJson('alice', { contract: 'guarded', action: 'go' });

        expect(handler).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'hook' }));
    });

    test('a payload replaced by beforeContractAction is validated against the schema', async () => {
        const handler = jest.fn();
        const invalid = jest.fn();
        ts = await createTestStreamer({ username: 'myapp' });
        ts.streamer.hook('beforeContractAction', () => ({ payload: { amount: 'not a number' } }));
        ts.streamer.hook('onInvalidPayload', invalid);
        await ts.streamer.registerContract(defineContract({
            name: 'strict',
            actions: {
                go: action(handler, { trigger: 'custom_json', schema: z.object({ amount: z.number() }) })
            }
        }));

        await ts.contractJson('alice', { contract: 'strict', action: 'go', payload: { amount: 1 } });

        expect(handler).not.toHaveBeenCalled();
        expect(invalid).toHaveBeenCalledTimes(1);
    });
});

describe('Escrow lifecycle triggers', () => {
    let ts: TestStreamer;

    beforeEach(quiet);

    afterEach(async () => {
        await ts?.stop();
        jest.restoreAllMocks();
    });

    test('approve, dispute and release reach every action that declares the trigger', async () => {
        const seen = jest.fn();
        ts = await createTestStreamer({ username: 'agent' });

        await ts.streamer.registerContract(defineContract({
            name: 'escrowwatch',
            actions: {
                track: action(async (payload, ctx) => {
                    seen(ctx.trigger, ctx.sender, payload.escrowId, ctx.escrow?.approved);
                }, { trigger: ['escrow_approve', 'escrow_dispute', 'escrow_release'] })
            }
        }));
        await ts.streamer.registerContract(defineContract({
            name: 'other',
            actions: {
                also: action(async (payload, ctx) => { seen('other', ctx.trigger); }, { trigger: 'escrow_release' })
            }
        }));

        const base = { from: 'buyer', to: 'seller', agent: 'agent', escrow_id: 7 };

        await ts.sendOperations([
            ['escrow_approve', { ...base, who: 'agent', approve: true }],
            ['escrow_dispute', { ...base, who: 'buyer' }],
            ['escrow_release', { ...base, who: 'agent', receiver: 'buyer', hbd_amount: '0.000 HBD', hive_amount: '5.000 HIVE' }]
        ]);

        expect(seen.mock.calls).toEqual([
            ['escrow_approve', 'agent', 7, true],
            ['escrow_dispute', 'buyer', 7, undefined],
            ['escrow_release', 'agent', 7, undefined],
            ['other', 'escrow_release']
        ]);

        // Replaying the block runs nothing twice.
        await ts.streamer.replayBlocks(ts.headBlockNumber, ts.headBlockNumber).catch(() => undefined);
        expect(seen).toHaveBeenCalledTimes(4);
    });
});

describe('Environment parsing', () => {
    const saved = { ...process.env };

    afterEach(() => {
        process.env = { ...saved };
    });

    test('a misspelt boolean or number is a configuration error, not a silent default', () => {
        process.env.IDEMPOTENCY_ENABLED = 'ture';
        process.env.ERROR_MAX_RETRIES = '5x';

        let error: unknown;

        try {
            createConfig({ env: { path: '/nonexistent/.env' } });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(ConfigValidationError);
        expect((error as ConfigValidationError).problems).toEqual(expect.arrayContaining([
            expect.stringContaining('IDEMPOTENCY_ENABLED must be a boolean (received "ture")'),
            expect.stringContaining('ERROR_MAX_RETRIES must be an integer')
        ]));
    });

    test('accepts the documented boolean spellings', () => {
        process.env.API_ENABLED = 'off';
        process.env.DEBUG_MODE = 'yes';

        const config = createConfig({ env: { path: '/nonexistent/.env' } });

        expect(config.API_ENABLED).toBe(false);
        expect(config.DEBUG_MODE).toBe(true);
    });
});

describe('API server', () => {
    let api: Api | null = null;

    beforeEach(quiet);

    afterEach(async () => {
        await api?.stop();
        api = null;
        jest.restoreAllMocks();
    });

    const request = (server: http.Server, path: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
        const address = server.address() as { address: string; port: number };

        http.get({ host: address.address, port: address.port, path }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
        }).on('error', reject);
    });

    test('binds to loopback by default and pages list endpoints', async () => {
        const transfers = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}` }));
        const adapter = {
            getTransfers: jest.fn(async (options) => transfers.slice(options.offset, options.offset + options.limit)),
            getJson: jest.fn(async () => []),
            getEvents: jest.fn(async () => []),
            getCounts: jest.fn(async () => ({ transfers: 5, customJson: 2, events: 1 }))
        };
        const streamer = {
            getAdapter: () => adapter,
            getHealth: () => ({ healthy: true, status: 'ok' }),
            getStatus: () => ({})
        };

        api = new Api(streamer, { port: 0 });
        const server = await api.start();

        expect((server.address() as any).address).toBe('127.0.0.1');

        const page = await request(server, '/transfers?limit=2&offset=1');
        expect(page.body).toEqual([{ id: 't1' }, { id: 't2' }]);

        const capped = await request(server, '/transfers?limit=999999');
        expect(adapter.getTransfers).toHaveBeenLastCalledWith({ limit: 1000, offset: 0 });
        expect(capped.status).toBe(200);

        const stats = await request(server, '/stats');
        expect(stats.body).toMatchObject({ totalTransfers: 5, totalCustomJson: 2, totalEvents: 1 });
    });
});
