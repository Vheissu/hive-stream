import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Streamer } from '../src/streamer';
import { SqliteAdapter } from '../src/adapters/sqlite.adapter';
import { HiveProvider } from '../src/providers/hive-provider';

describe('Streamer edge cases', () => {
    let sut: Streamer;
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivestream-edge-'));
        const dbPath = path.join(tempDir, 'test.db');
        sut = new Streamer({ JSON_ID: 'hivestream', PAYLOAD_IDENTIFIER: 'hive_stream' });
        sut['adapter'] = new SqliteAdapter(dbPath);
    });

    afterEach(async () => {
        await sut.stop();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('getStatus()', () => {
        test('returns initial status values', () => {
            const status = (sut as any).getStatus();
            expect(status.lastBlockNumber).toBe(0);
            expect(status.headBlockNumber).toBe(0);
            expect(status.blocksBehind).toBe(0);
            expect(status.isCatchingUp).toBe(false);
            expect(status.latestBlockchainTime).toBeFalsy();
        });

        test('reflects updated block numbers', () => {
            sut['lastBlockNumber'] = 100;
            sut['headBlockNumber'] = 110;
            sut['isCatchingUp'] = true;
            sut['latestBlockchainTime'] = new Date('2024-06-01T12:00:00Z');

            const status = (sut as any).getStatus();
            expect(status.lastBlockNumber).toBe(100);
            expect(status.headBlockNumber).toBe(110);
            expect(status.blocksBehind).toBe(10);
            expect(status.isCatchingUp).toBe(true);
            expect(status.latestBlockchainTime).toBeInstanceOf(Date);
        });
    });

    describe('normalizeContractPayload()', () => {
        test('handles standard contract/action format', () => {
            const result = sut['normalizeContractPayload']({
                contract: 'token',
                action: 'transfer',
                payload: { amount: '1' },
            });
            expect(result).toEqual({
                contract: 'token',
                action: 'transfer',
                payload: { amount: '1' },
            });
        });

        test('handles legacy name field', () => {
            const result = sut['normalizeContractPayload']({
                name: 'token',
                action: 'transfer',
                payload: { amount: '1' },
            });
            expect(result).toEqual({
                contract: 'token',
                action: 'transfer',
                payload: { amount: '1' },
            });
        });

        test('returns null for null input', () => {
            expect(sut['normalizeContractPayload'](null)).toBeNull();
        });

        test('returns null for undefined input', () => {
            expect(sut['normalizeContractPayload'](undefined)).toBeNull();
        });

        test('returns null for non-object input', () => {
            expect(sut['normalizeContractPayload']('string')).toBeNull();
        });

        test('returns null when neither contract nor name is present', () => {
            expect(sut['normalizeContractPayload']({ action: 'x', payload: {} })).toBeNull();
        });

        test('returns null when action is missing', () => {
            expect(sut['normalizeContractPayload']({ contract: 'x', payload: {} })).toBeNull();
        });
    });

    describe('processOperation - escrow operations', () => {
        let escrowTransferCb: jest.Mock;
        let escrowApproveCb: jest.Mock;
        let escrowDisputeCb: jest.Mock;
        let escrowReleaseCb: jest.Mock;

        beforeEach(async () => {
            await sut['ensureAdapterReady']();
            escrowTransferCb = jest.fn();
            escrowApproveCb = jest.fn();
            escrowDisputeCb = jest.fn();
            escrowReleaseCb = jest.fn();

            sut.onEscrowTransfer(escrowTransferCb);
            sut.onEscrowApprove(escrowApproveCb);
            sut.onEscrowDispute(escrowDisputeCb);
            sut.onEscrowRelease(escrowReleaseCb);
        });

        test('escrow_transfer triggers onEscrowTransfer', async () => {
            await sut.processOperation(
                ['escrow_transfer', { from: 'alice', to: 'bob', agent: 'agent', escrow_id: 1 }],
                1, 'b1', 'b0', 'trx-esc-1', new Date()
            );
            expect(escrowTransferCb).toHaveBeenCalledWith(
                expect.objectContaining({ from: 'alice' }),
                1, 'b1', 'b0', 'trx-esc-1', expect.any(Date)
            );
        });

        test('escrow_approve triggers onEscrowApprove', async () => {
            await sut.processOperation(
                ['escrow_approve', { from: 'alice', to: 'bob', agent: 'agent', who: 'agent', escrow_id: 1, approve: true }],
                2, 'b2', 'b1', 'trx-esc-2', new Date()
            );
            expect(escrowApproveCb).toHaveBeenCalled();
        });

        test('escrow_dispute triggers onEscrowDispute', async () => {
            await sut.processOperation(
                ['escrow_dispute', { from: 'alice', to: 'bob', agent: 'agent', who: 'alice', escrow_id: 1 }],
                3, 'b3', 'b2', 'trx-esc-3', new Date()
            );
            expect(escrowDisputeCb).toHaveBeenCalled();
        });

        test('escrow_release triggers onEscrowRelease', async () => {
            await sut.processOperation(
                ['escrow_release', { from: 'alice', to: 'bob', agent: 'agent', who: 'agent', receiver: 'alice', escrow_id: 1 }],
                4, 'b4', 'b3', 'trx-esc-4', new Date()
            );
            expect(escrowReleaseCb).toHaveBeenCalled();
        });
    });

    describe('processOperation - vote', () => {
        test('does not crash on vote operation', async () => {
            await sut['ensureAdapterReady']();
            // vote is not subscribed to, should be silently ignored
            await expect(sut.processOperation(
                ['vote', { voter: 'alice', author: 'bob', permlink: 'post', weight: 10000 }],
                1, 'b1', 'b0', 'trx-vote', new Date()
            )).resolves.toBeUndefined();
        });
    });

    describe('processOperation - contract dispatch via custom_json', () => {
        test('dispatches to registered contract', async () => {
            await sut['ensureAdapterReady']();
            const handler = jest.fn();
            await sut.registerContract({
                name: 'mycontract',
                actions: {
                    doAction: { handler },
                },
            });

            // JSON must be nested under PAYLOAD_IDENTIFIER ('hive_stream')
            const jsonPayload = JSON.stringify({
                hive_stream: {
                    contract: 'mycontract',
                    action: 'doAction',
                    payload: { value: 42 },
                },
            });

            await sut.processOperation(
                ['custom_json', { id: 'hivestream', required_auths: ['alice'], required_posting_auths: [], json: jsonPayload }],
                1, 'b1', 'b0', 'trx-cj-1', new Date()
            );

            expect(handler).toHaveBeenCalled();
            const [payload, ctx] = handler.mock.calls[0];
            expect(payload.value).toBe(42);
            expect(ctx.sender).toBe('alice');
        });

        test('handles malformed JSON gracefully', async () => {
            await sut['ensureAdapterReady']();

            await expect(sut.processOperation(
                ['custom_json', { id: 'hivestream', required_auths: ['alice'], required_posting_auths: [], json: 'not-json' }],
                1, 'b1', 'b0', 'trx-bad-json', new Date()
            )).resolves.toBeUndefined();
        });

        test('skips custom_json with non-matching JSON_ID', async () => {
            await sut['ensureAdapterReady']();
            const handler = jest.fn();
            sut.registerContract({
                name: 'test',
                actions: { act: { handler } },
            });

            await sut.processOperation(
                ['custom_json', { id: 'other-id', required_auths: ['alice'], required_posting_auths: [], json: '{}' }],
                1, 'b1', 'b0', 'trx-other-id', new Date()
            );

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('processOperation - recurrent_transfer', () => {
        test('dispatches recurrent_transfer to matching contract', async () => {
            await sut['ensureAdapterReady']();
            const handler = jest.fn();
            sut.registerContract({
                name: 'mycontract',
                actions: {
                    subscribe: { handler, trigger: 'transfer' },
                },
            });
            await sut['initializeContracts']();

            await sut.processOperation(
                ['recurrent_transfer', {
                    from: 'alice',
                    to: sut['config'].USERNAME || 'hive_stream',
                    amount: '1.000 HIVE',
                    memo: JSON.stringify({ contract: 'mycontract', action: 'subscribe', payload: {} }),
                }],
                1, 'b1', 'b0', 'trx-rt-1', new Date()
            );

            // recurrent_transfer should trigger transfer subscriptions
        });
    });

    describe('isEscrowOperationType()', () => {
        test('returns true for all escrow types', () => {
            expect(sut['isEscrowOperationType']('escrow_transfer')).toBe(true);
            expect(sut['isEscrowOperationType']('escrow_approve')).toBe(true);
            expect(sut['isEscrowOperationType']('escrow_dispute')).toBe(true);
            expect(sut['isEscrowOperationType']('escrow_release')).toBe(true);
        });

        test('returns false for non-escrow types', () => {
            expect(sut['isEscrowOperationType']('transfer')).toBe(false);
            expect(sut['isEscrowOperationType']('custom_json')).toBe(false);
            expect(sut['isEscrowOperationType']('comment')).toBe(false);
        });
    });

    describe('buildEscrowDetails()', () => {
        test('builds details for escrow_transfer', () => {
            const details = sut['buildEscrowDetails']('escrow_transfer', {
                from: 'alice',
                to: 'bob',
                agent: 'agent',
                escrow_id: 1,
                hive_amount: '1.000 HIVE',
                hbd_amount: '0.000 HBD',
                fee: '0.001 HIVE',
                ratification_deadline: '2024-06-01T00:00:00',
                escrow_expiration: '2024-07-01T00:00:00',
            });
            expect(details.type).toBe('escrow_transfer');
            expect(details.from).toBe('alice');
            expect(details.escrowId).toBe(1);
        });
    });

    describe('contract requiresActiveKey validation', () => {
        test('skips action when requiresActiveKey but signed with posting key', async () => {
            await sut['ensureAdapterReady']();
            const handler = jest.fn();
            await sut.registerContract({
                name: 'secure',
                actions: {
                    act: { handler, requiresActiveKey: true },
                },
            });

            const jsonPayload = JSON.stringify({
                hive_stream: {
                    contract: 'secure',
                    action: 'act',
                    payload: {},
                },
            });

            // required_posting_auths means it's signed with posting key, not active
            await sut.processOperation(
                ['custom_json', { id: 'hivestream', required_auths: [], required_posting_auths: ['alice'], json: jsonPayload }],
                1, 'b1', 'b0', 'trx-posting', new Date()
            );

            expect(handler).not.toHaveBeenCalled();
        });

        test('executes action when requiresActiveKey and signed with active key', async () => {
            await sut['ensureAdapterReady']();
            const handler = jest.fn();
            await sut.registerContract({
                name: 'secure2',
                actions: {
                    act: { handler, requiresActiveKey: true },
                },
            });

            const jsonPayload = JSON.stringify({
                hive_stream: {
                    contract: 'secure2',
                    action: 'act',
                    payload: {},
                },
            });

            await sut.processOperation(
                ['custom_json', { id: 'hivestream', required_auths: ['alice'], required_posting_auths: [], json: jsonPayload }],
                1, 'b1', 'b0', 'trx-active', new Date()
            );

            expect(handler).toHaveBeenCalled();
        });
    });

    describe('schema validation on contract dispatch', () => {
        test('validates payload against schema before calling handler', async () => {
            await sut['ensureAdapterReady']();
            const { z } = require('zod');
            const schema = z.object({ amount: z.number().positive() });
            const handler = jest.fn();
            await sut.registerContract({
                name: 'validated',
                actions: {
                    act: { handler, schema },
                },
            });

            // Valid payload
            await sut.processOperation(
                ['custom_json', {
                    id: 'hivestream',
                    required_auths: ['alice'],
                    required_posting_auths: [],
                    json: JSON.stringify({ hive_stream: { contract: 'validated', action: 'act', payload: { amount: 5 } } }),
                }],
                1, 'b1', 'b0', 'trx-schema-1', new Date()
            );
            expect(handler).toHaveBeenCalledTimes(1);

            // Invalid payload (amount is negative)
            handler.mockClear();
            await sut.processOperation(
                ['custom_json', {
                    id: 'hivestream',
                    required_auths: ['alice'],
                    required_posting_auths: [],
                    json: JSON.stringify({ hive_stream: { contract: 'validated', action: 'act', payload: { amount: -1 } } }),
                }],
                2, 'b2', 'b1', 'trx-schema-2', new Date()
            );
            // Handler should NOT be called for invalid schema
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('subscription cleanup', () => {
        test('cleanupSubscriptions trims arrays over 1000', () => {
            // Fill up subscriptions beyond 1000
            for (let i = 0; i < 1050; i++) {
                sut.onTransfer('testaccount', jest.fn());
            }
            expect(sut['transferSubscriptions'].length).toBe(1050);

            sut['cleanupSubscriptions']();
            expect(sut['transferSubscriptions'].length).toBe(1000);
        });
    });

    describe('defaultBlockProvider', () => {
        test('default provider is HiveProvider', () => {
            const provider = sut.getBlockProvider();
            expect(provider).toBeInstanceOf(HiveProvider);
        });
    });

    describe('getAdapter()', () => {
        test('returns the adapter instance', () => {
            const adapter = sut.getAdapter();
            expect(adapter).toBeInstanceOf(SqliteAdapter);
        });
    });

    describe('setConfig chaining', () => {
        test('returns the streamer for chaining', () => {
            const result = sut.setConfig({ USERNAME: 'testuser' });
            expect(result).toBe(sut);
        });

        test('updates username', () => {
            sut.setConfig({ USERNAME: 'newuser' });
            expect(sut['username']).toBe('newuser');
        });
    });

    describe('contract registration edge cases', () => {
        test('registerContract throws for duplicate name', async () => {
            const contract = {
                name: 'dup',
                actions: { act: { handler: jest.fn() } },
            };
            await sut.registerContract(contract);
            await expect(sut.registerContract(contract)).rejects.toThrow("'dup' is already registered");
        });

        test('unregisterContract removes contract', async () => {
            const contract = {
                name: 'removable',
                actions: { act: { handler: jest.fn() } },
            };
            await sut.registerContract(contract);
            await sut.unregisterContract('removable');

            // Should be able to register again after removal
            await sut.registerContract(contract);
        });

        test('unregisterContract is safe for non-existent contract', async () => {
            await expect(sut.unregisterContract('nonexistent')).resolves.toBeUndefined();
        });
    });
});
