import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Streamer } from '../src/streamer';
import { SqliteAdapter } from '../src/adapters/sqlite.adapter';

describe('Streamer Subscriptions & Operation Processing', () => {
    let sut: Streamer;
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hivestream-sub-'));
        const dbPath = path.join(tempDir, 'test.db');
        sut = new Streamer({ JSON_ID: 'hivestream', PAYLOAD_IDENTIFIER: 'hive_stream' });
        // Use isolated temp db to avoid UNIQUE constraint collisions across test files
        sut['adapter'] = new SqliteAdapter(dbPath);
    });

    afterEach(async () => {
        await sut.stop();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('Subscription registration', () => {
        test('onComment registers callback', () => {
            const cb = jest.fn();
            sut.onComment(cb);
            expect(sut['commentSubscriptions']).toHaveLength(1);
            expect(sut['commentSubscriptions'][0].callback).toBe(cb);
        });

        test('onPost registers callback', () => {
            const cb = jest.fn();
            sut.onPost(cb);
            expect(sut['postSubscriptions']).toHaveLength(1);
        });

        test('onTransfer registers with account', () => {
            const cb = jest.fn();
            sut.onTransfer('alice', cb);
            expect(sut['transferSubscriptions']).toHaveLength(1);
            expect(sut['transferSubscriptions'][0].account).toBe('alice');
        });

        test('onCustomJson registers callback', () => {
            const cb = jest.fn();
            sut.onCustomJson(cb);
            expect(sut['customJsonSubscriptions']).toHaveLength(1);
        });

        test('onCustomJsonId registers with id', () => {
            const cb = jest.fn();
            sut.onCustomJsonId(cb, 'ssc-mainnet-hive');
            expect(sut['customJsonIdSubscriptions']).toHaveLength(1);
            expect(sut['customJsonIdSubscriptions'][0].id).toBe('ssc-mainnet-hive');
        });

        test('onHiveEngine registers callback', () => {
            const cb = jest.fn();
            sut.onHiveEngine(cb);
            expect(sut['customJsonHiveEngineSubscriptions']).toHaveLength(1);
        });

        test('onEscrowTransfer registers with correct type', () => {
            const cb = jest.fn();
            sut.onEscrowTransfer(cb);
            expect(sut['escrowSubscriptions']).toHaveLength(1);
            expect(sut['escrowSubscriptions'][0].type).toBe('escrow_transfer');
        });

        test('onEscrowApprove registers with correct type', () => {
            const cb = jest.fn();
            sut.onEscrowApprove(cb);
            expect(sut['escrowSubscriptions'][0].type).toBe('escrow_approve');
        });

        test('onEscrowDispute registers with correct type', () => {
            const cb = jest.fn();
            sut.onEscrowDispute(cb);
            expect(sut['escrowSubscriptions'][0].type).toBe('escrow_dispute');
        });

        test('onEscrowRelease registers with correct type', () => {
            const cb = jest.fn();
            sut.onEscrowRelease(cb);
            expect(sut['escrowSubscriptions'][0].type).toBe('escrow_release');
        });
    });

    describe('Subscription removal', () => {
        test('removeTransferSubscription removes by account', () => {
            sut.onTransfer('alice', jest.fn());
            sut.onTransfer('bob', jest.fn());
            sut.removeTransferSubscription('alice');
            expect(sut['transferSubscriptions']).toHaveLength(1);
            expect(sut['transferSubscriptions'][0].account).toBe('bob');
        });

        test('removeCustomJsonIdSubscription removes by id', () => {
            sut.onCustomJsonId(jest.fn(), 'id-1');
            sut.onCustomJsonId(jest.fn(), 'id-2');
            sut.removeCustomJsonIdSubscription('id-1');
            expect(sut['customJsonIdSubscriptions']).toHaveLength(1);
            expect(sut['customJsonIdSubscriptions'][0].id).toBe('id-2');
        });

        test('removeEscrowSubscriptions removes by type', () => {
            sut.onEscrowTransfer(jest.fn());
            sut.onEscrowApprove(jest.fn());
            sut.removeEscrowSubscriptions('escrow_transfer');
            expect(sut['escrowSubscriptions']).toHaveLength(1);
            expect(sut['escrowSubscriptions'][0].type).toBe('escrow_approve');
        });
    });

    describe('processOperation - comment/post', () => {
        const now = new Date('2024-06-01T00:00:00Z');

        test('fires post subscription for top-level comment', async () => {
            const postCb = jest.fn();
            const commentCb = jest.fn();
            sut.onPost(postCb);
            sut.onComment(commentCb);

            await sut.processOperation(
                ['comment', { parent_author: '', author: 'alice', title: 'My Post', body: 'content', permlink: 'my-post' }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(postCb).toHaveBeenCalledTimes(1);
            expect(commentCb).not.toHaveBeenCalled();
        });

        test('fires comment subscription for reply', async () => {
            const postCb = jest.fn();
            const commentCb = jest.fn();
            sut.onPost(postCb);
            sut.onComment(commentCb);

            await sut.processOperation(
                ['comment', { parent_author: 'alice', author: 'bob', body: 'reply', permlink: 're-my-post' }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(commentCb).toHaveBeenCalledTimes(1);
            expect(postCb).not.toHaveBeenCalled();
        });
    });

    describe('processOperation - transfer', () => {
        const now = new Date('2024-06-01T00:00:00Z');

        test('fires transfer subscription matching account', async () => {
            const cb = jest.fn();
            sut.onTransfer('bob', cb);

            await sut.processOperation(
                ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: 'test' }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(cb).toHaveBeenCalledTimes(1);
        });

        test('does not fire transfer subscription for different account', async () => {
            const cb = jest.fn();
            sut.onTransfer('charlie', cb);

            await sut.processOperation(
                ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: '' }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(cb).not.toHaveBeenCalled();
        });
    });

    describe('processOperation - custom_json', () => {
        const now = new Date('2024-06-01T00:00:00Z');

        test('fires generic custom_json subscription', async () => {
            const cb = jest.fn();
            sut.onCustomJson(cb);

            await sut.processOperation(
                ['custom_json', {
                    id: 'test-id',
                    json: '{"key":"value"}',
                    required_auths: [],
                    required_posting_auths: ['alice'],
                }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(cb).toHaveBeenCalledTimes(1);
        });

        test('fires custom_json id subscription only for matching id', async () => {
            const matchCb = jest.fn();
            const noMatchCb = jest.fn();
            sut.onCustomJsonId(matchCb, 'my-app');
            sut.onCustomJsonId(noMatchCb, 'other-app');

            await sut.processOperation(
                ['custom_json', {
                    id: 'my-app',
                    json: '{}',
                    required_auths: [],
                    required_posting_auths: ['alice'],
                }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(matchCb).toHaveBeenCalledTimes(1);
            expect(noMatchCb).not.toHaveBeenCalled();
        });
    });

    describe('processOperation - escrow operations', () => {
        const now = new Date('2024-06-01T00:00:00Z');

        test('fires escrow_transfer subscription', async () => {
            const cb = jest.fn();
            sut.onEscrowTransfer(cb);

            await sut.processOperation(
                ['escrow_transfer', {
                    from: 'alice',
                    to: 'bob',
                    agent: 'escrow.agent',
                    escrow_id: 1,
                    hive_amount: '10.000 HIVE',
                    hbd_amount: '0.000 HBD',
                    fee: '0.001 HIVE',
                    ratification_deadline: '2024-06-10T00:00:00',
                    escrow_expiration: '2024-06-20T00:00:00',
                    json_meta: '{}',
                }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(cb).toHaveBeenCalledTimes(1);
        });

        test('fires escrow_approve subscription', async () => {
            const cb = jest.fn();
            sut.onEscrowApprove(cb);

            await sut.processOperation(
                ['escrow_approve', {
                    from: 'alice',
                    to: 'bob',
                    agent: 'escrow.agent',
                    who: 'escrow.agent',
                    escrow_id: 1,
                    approve: true,
                }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(cb).toHaveBeenCalledTimes(1);
        });

        test('does not fire escrow_transfer for escrow_approve operation', async () => {
            const transferCb = jest.fn();
            sut.onEscrowTransfer(transferCb);

            await sut.processOperation(
                ['escrow_approve', {
                    from: 'alice',
                    to: 'bob',
                    agent: 'escrow.agent',
                    who: 'escrow.agent',
                    escrow_id: 1,
                    approve: true,
                }],
                1, 'block-1', 'block-0', 'trx-1', now
            );

            expect(transferCb).not.toHaveBeenCalled();
        });
    });

    describe('processOperation - contract dispatch via custom_json', () => {
        const now = new Date('2024-06-01T00:00:00Z');

        test('dispatches to registered contract action', async () => {
            const handler = jest.fn();
            await sut.registerContract({
                name: 'mycontract',
                actions: {
                    doSomething: {
                        handler,
                        trigger: 'custom_json',
                    }
                }
            });

            await sut.processOperation(
                ['custom_json', {
                    id: 'hivestream',
                    json: JSON.stringify({
                        hive_stream: {
                            contract: 'mycontract',
                            action: 'doSomething',
                            payload: { data: 'test' },
                        }
                    }),
                    required_auths: [],
                    required_posting_auths: ['alice'],
                }],
                100, 'block-100', 'block-99', 'trx-dispatch-1', now
            );

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(
                { data: 'test' },
                expect.objectContaining({
                    trigger: 'custom_json',
                    sender: 'alice',
                })
            );
        });

        test('does not dispatch when contract name does not match', async () => {
            const handler = jest.fn();
            await sut.registerContract({
                name: 'mycontract',
                actions: {
                    doSomething: { handler, trigger: 'custom_json' }
                }
            });

            await sut.processOperation(
                ['custom_json', {
                    id: 'hivestream',
                    json: JSON.stringify({
                        hive_stream: {
                            contract: 'othercontract',
                            action: 'doSomething',
                            payload: {},
                        }
                    }),
                    required_auths: [],
                    required_posting_auths: ['alice'],
                }],
                101, 'block-101', 'block-100', 'trx-dispatch-2', now
            );

            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('processOperation - contract dispatch via transfer', () => {
        const now = new Date('2024-06-01T00:00:00Z');

        test('dispatches to registered contract on transfer with payload in memo', async () => {
            const handler = jest.fn();
            await sut.registerContract({
                name: 'tipjar',
                actions: {
                    tip: {
                        handler,
                        trigger: 'transfer',
                    }
                }
            });

            sut.setConfig({ USERNAME: 'mybot' });

            await sut.processOperation(
                ['transfer', {
                    from: 'alice',
                    to: 'mybot',
                    amount: '5.000 HIVE',
                    memo: JSON.stringify({
                        hive_stream: {
                            contract: 'tipjar',
                            action: 'tip',
                            payload: { message: 'thanks!' },
                        }
                    }),
                }],
                200, 'block-200', 'block-199', 'trx-transfer-1', now
            );

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(
                { message: 'thanks!' },
                expect.objectContaining({
                    trigger: 'transfer',
                    sender: 'alice',
                    transfer: expect.objectContaining({
                        from: 'alice',
                        to: 'mybot',
                        asset: 'HIVE',
                    }),
                })
            );
        });
    });

    describe('Contract registration', () => {
        test('rejects null contract', async () => {
            await expect(sut.registerContract(null as any)).rejects.toThrow('Contract must be a valid definition');
        });

        test('rejects contract without name', async () => {
            await expect(sut.registerContract({ actions: {} } as any)).rejects.toThrow('Contract name must be a non-empty string');
        });

        test('rejects duplicate contract name', async () => {
            await sut.registerContract({
                name: 'test',
                actions: { doSomething: { handler: jest.fn(), trigger: 'custom_json' } }
            });

            await expect(sut.registerContract({
                name: 'test',
                actions: { doOther: { handler: jest.fn(), trigger: 'custom_json' } }
            })).rejects.toThrow("already registered");
        });

        test('rejects contract without actions', async () => {
            await expect(sut.registerContract({ name: 'test' } as any)).rejects.toThrow('must define actions');
        });

        test('unregisterContract removes a contract', async () => {
            await sut.registerContract({
                name: 'test',
                actions: { doSomething: { handler: jest.fn(), trigger: 'custom_json' } }
            });

            await sut.unregisterContract('test');

            // Should allow re-registration after unregister
            await sut.registerContract({
                name: 'test',
                actions: { doSomething: { handler: jest.fn(), trigger: 'custom_json' } }
            });

            expect(sut['contracts']).toHaveLength(1);
        });
    });

    describe('blockProvider config integration', () => {
        test('default streamer uses HiveProvider', () => {
            const provider = sut.getBlockProvider();
            expect(provider).toBeDefined();
            expect(provider.constructor.name).toBe('HiveProvider');
        });

        test('custom blockProvider is used when passed in config', async () => {
            const mockProvider = {
                getDynamicGlobalProperties: jest.fn(),
                getBlock: jest.fn(),
                create: jest.fn(),
                destroy: jest.fn(),
            };

            const streamer = new Streamer({
                JSON_ID: 'test',
                blockProvider: mockProvider as any,
            });

            expect(streamer.getBlockProvider()).toBe(mockProvider);
            await streamer.stop();
        });
    });

    describe('normalizeContractPayload', () => {
        test('handles standard payload format', () => {
            const result = sut['normalizeContractPayload']({
                contract: 'mycontract',
                action: 'doSomething',
                payload: { key: 'value' },
            });

            expect(result).toEqual({
                contract: 'mycontract',
                action: 'doSomething',
                payload: { key: 'value' },
            });
        });

        test('handles legacy name/action format', () => {
            const result = sut['normalizeContractPayload']({
                name: 'mycontract',
                action: 'doSomething',
                payload: { key: 'value' },
            });

            expect(result).toEqual({
                contract: 'mycontract',
                action: 'doSomething',
                payload: { key: 'value' },
            });
        });

        test('returns null for null/undefined input', () => {
            expect(sut['normalizeContractPayload'](null)).toBeNull();
            expect(sut['normalizeContractPayload'](undefined)).toBeNull();
        });

        test('returns null when no contract identifier present', () => {
            expect(sut['normalizeContractPayload']({ action: 'test' })).toBeNull();
        });
    });

    describe('loadBlock', () => {
        test('processes block operations sequentially', async () => {
            const callOrder: string[] = [];
            sut.onPost((data: any) => callOrder.push(`post:${data.author}`));
            sut.onComment((data: any) => callOrder.push(`comment:${data.author}`));

            const block = {
                block_id: 'block-500',
                previous: 'block-499',
                timestamp: '2024-06-01T00:00:00',
                transactions: [
                    {
                        operations: [
                            ['comment', { parent_author: '', author: 'alice', title: 'Post', body: 'content', permlink: 'p1' }],
                            ['comment', { parent_author: 'alice', author: 'bob', body: 'reply', permlink: 'r1' }],
                        ]
                    },
                ],
                transaction_ids: ['trx-load-1'],
            };

            sut['blockProvider'] = {
                getDynamicGlobalProperties: jest.fn(),
                getBlock: jest.fn().mockResolvedValue(block),
            } as any;

            await sut['loadBlock'](500);

            expect(callOrder).toEqual(['post:alice', 'comment:bob']);
            expect(sut['lastBlockNumber']).toBe(500);
        });

        test('caches loaded blocks', async () => {
            const block = {
                block_id: 'block-600',
                previous: 'block-599',
                timestamp: '2024-06-01T00:00:00',
                transactions: [],
                transaction_ids: [],
            };

            const mockGetBlock = jest.fn().mockResolvedValue(block);
            sut['blockProvider'] = {
                getDynamicGlobalProperties: jest.fn(),
                getBlock: mockGetBlock,
            } as any;

            await sut['loadBlock'](600);
            await sut['loadBlock'](600);

            // getBlock only called once - second time uses cache
            expect(mockGetBlock).toHaveBeenCalledTimes(1);
        });

        test('handles null block gracefully', async () => {
            sut['blockProvider'] = {
                getDynamicGlobalProperties: jest.fn(),
                getBlock: jest.fn().mockResolvedValue(null),
            } as any;
            sut['config'].BLOCK_CHECK_INTERVAL = 10; // speed up test

            await sut['loadBlock'](999);

            // lastBlockNumber should NOT advance
            expect(sut['lastBlockNumber']).toBe(0);
        });
    });

    describe('setConfig', () => {
        test('updates HiveProvider when API_NODES changes', () => {
            const provider = sut.getBlockProvider();
            const originalClient = (provider as any).client;

            sut.setConfig({ apiNodes: ['https://custom-api.hive.blog'] });

            // HiveProvider should have updated its client
            expect((provider as any).client).not.toBe(originalClient);
        });

        test('updates username/keys from config', () => {
            sut.setConfig({
                username: 'newuser',
                postingKey: 'newposting',
                activeKey: 'newactive',
            });

            expect(sut['username']).toBe('newuser');
            expect(sut['postingKey']).toBe('newposting');
            expect(sut['activeKey']).toBe('newactive');
        });

        test('returns streamer for chaining', () => {
            const result = sut.setConfig({ debugMode: false });
            expect(result).toBe(sut);
        });
    });

    describe('registerBlockProvider', () => {
        test('replaces existing provider and calls lifecycle methods', async () => {
            const oldProvider = {
                getDynamicGlobalProperties: jest.fn(),
                getBlock: jest.fn(),
                destroy: jest.fn().mockResolvedValue(undefined),
            };
            const newProvider = {
                getDynamicGlobalProperties: jest.fn(),
                getBlock: jest.fn(),
                create: jest.fn().mockResolvedValue(undefined),
            };

            sut['blockProvider'] = oldProvider as any;
            await sut.registerBlockProvider(newProvider as any);

            expect(oldProvider.destroy).toHaveBeenCalled();
            expect(newProvider.create).toHaveBeenCalled();
            expect(sut.getBlockProvider()).toBe(newProvider);
        });
    });

    describe('API server lifecycle', () => {
        test('startApiServer creates and starts API server', async () => {
            const api = await sut.startApiServer(0); // port 0 = random
            expect(api).toBeDefined();
            expect(api.server).toBeDefined();
            expect(sut.getApiServer()).toBe(api);
            await sut.stopApiServer();
        });

        test('stopApiServer clears api server', async () => {
            await sut.startApiServer(0);
            await sut.stopApiServer();
            expect(sut.getApiServer()).toBeNull();
        });

        test('stopApiServer is safe when not started', async () => {
            await expect(sut.stopApiServer()).resolves.toBeUndefined();
        });
    });

    describe('isEscrowOperationType', () => {
        test('identifies escrow operation types', () => {
            expect(sut['isEscrowOperationType']('escrow_transfer')).toBe(true);
            expect(sut['isEscrowOperationType']('escrow_approve')).toBe(true);
            expect(sut['isEscrowOperationType']('escrow_dispute')).toBe(true);
            expect(sut['isEscrowOperationType']('escrow_release')).toBe(true);
        });

        test('rejects non-escrow operation types', () => {
            expect(sut['isEscrowOperationType']('transfer')).toBe(false);
            expect(sut['isEscrowOperationType']('custom_json')).toBe(false);
            expect(sut['isEscrowOperationType']('comment')).toBe(false);
        });
    });

    describe('buildEscrowDetails', () => {
        test('extracts escrow details from escrow_transfer', () => {
            const details = sut['buildEscrowDetails']('escrow_transfer', {
                from: 'alice',
                to: 'bob',
                agent: 'escrow.agent',
                escrow_id: 42,
                hive_amount: '10.000 HIVE',
                hbd_amount: '0.000 HBD',
                fee: '0.001 HIVE',
                ratification_deadline: '2024-06-10T00:00:00',
                escrow_expiration: '2024-06-20T00:00:00',
            });

            expect(details.type).toBe('escrow_transfer');
            expect(details.from).toBe('alice');
            expect(details.to).toBe('bob');
            expect(details.agent).toBe('escrow.agent');
            expect(details.escrowId).toBe(42);
            expect(details.hiveAmount).toBe('10.000 HIVE');
            expect(details.hbdAmount).toBe('0.000 HBD');
        });

        test('extracts escrow details from escrow_approve', () => {
            const details = sut['buildEscrowDetails']('escrow_approve', {
                from: 'alice',
                to: 'bob',
                agent: 'escrow.agent',
                who: 'escrow.agent',
                escrow_id: 42,
                approve: true,
            });

            expect(details.type).toBe('escrow_approve');
            expect(details.who).toBe('escrow.agent');
            expect(details.approved).toBe(true);
        });
    });
});
