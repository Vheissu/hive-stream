import { Utils } from '../src/utils';
import { PrivateKey } from '@hiveio/dhive';

/**
 * Tests for Utils blockchain methods with mocked dhive Client.
 * Covers: getTransaction (success), getAccountTransfers (success),
 * getApiJson, upvote, downvote, votingWeight, asyncForEach,
 * recurrentTransfer, createProposal, updateProposalVotes, removeProposals,
 * updateAccountAuthorities, transferHiveTokensMultiple (success path)
 */

const TEST_KEY = '5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg';

function createMockClient(overrides: Record<string, any> = {}) {
    return {
        broadcast: {
            transfer: jest.fn().mockResolvedValue({ id: 'trx-ok' }),
            vote: jest.fn().mockResolvedValue({ id: 'vote-ok' }),
            json: jest.fn().mockResolvedValue({ id: 'json-ok' }),
            sendOperations: jest.fn().mockResolvedValue({ id: 'ops-ok' }),
        },
        database: {
            getBlock: jest.fn().mockResolvedValue({
                transaction_ids: ['trx-aaa', 'trx-bbb'],
                transactions: [
                    { operations: [['transfer', { from: 'a', to: 'b', amount: '1.000 HIVE' }]] },
                    { operations: [['custom_json', { id: 'test' }]] },
                ],
            }),
            getAccounts: jest.fn().mockResolvedValue([{
                memo_key: 'STM_memo',
                json_metadata: '{}',
                posting_json_metadata: '{}',
            }]),
        },
        call: jest.fn().mockResolvedValue([]),
        ...overrides,
    } as any;
}

describe('Utils blockchain methods', () => {
    describe('getTransaction() success path', () => {
        test('finds transaction by ID in block', async () => {
            const client = createMockClient();
            const tx = await Utils.getTransaction(client, 100, 'trx-bbb');
            expect(tx).toEqual({ operations: [['custom_json', { id: 'test' }]] });
            expect(client.database.getBlock).toHaveBeenCalledWith(100);
        });

        test('finds first transaction', async () => {
            const client = createMockClient();
            const tx = await Utils.getTransaction(client, 100, 'trx-aaa');
            expect(tx).toEqual({ operations: [['transfer', { from: 'a', to: 'b', amount: '1.000 HIVE' }]] });
        });

        test('throws when transaction not found in block', async () => {
            const client = createMockClient();
            await expect(Utils.getTransaction(client, 100, 'trx-nonexistent'))
                .rejects.toThrow('Unable to find transaction');
        });

        test('throws when block is null', async () => {
            const client = createMockClient();
            client.database.getBlock.mockResolvedValue(null);
            await expect(Utils.getTransaction(client, 999, 'trx-1'))
                .rejects.toThrow('Block 999 not found');
        });
    });

    describe('getAccountTransfers() success path', () => {
        test('returns transfer operations with dates', async () => {
            const client = createMockClient();
            client.call.mockResolvedValue([
                [0, { op: ['transfer', { from: 'alice', to: 'bob', amount: '1.000 HIVE' }], timestamp: '2024-06-01T12:00:00' }],
                [1, { op: ['vote', { voter: 'alice' }], timestamp: '2024-06-01T12:01:00' }],
                [2, { op: ['transfer', { from: 'bob', to: 'alice', amount: '2.000 HIVE' }], timestamp: '2024-06-01T12:02:00' }],
            ]);

            const result = await Utils.getAccountTransfers(client, 'alice');
            expect(result).toHaveLength(2); // Only transfers, not votes
            expect(result[0].from).toBe('alice');
            expect(result[0].date).toBeInstanceOf(Date);
            expect(result[1].from).toBe('bob');
            expect(client.call).toHaveBeenCalledWith('condenser_api', 'get_account_history', ['alice', -1, 100]);
        });

        test('passes custom from and max parameters', async () => {
            const client = createMockClient();
            client.call.mockResolvedValue([]);

            await Utils.getAccountTransfers(client, 'alice', 500, 50);
            expect(client.call).toHaveBeenCalledWith('condenser_api', 'get_account_history', ['alice', 500, 50]);
        });

        test('returns empty array on non-array response', async () => {
            const client = createMockClient();
            client.call.mockResolvedValue(null);

            const result = await Utils.getAccountTransfers(client, 'alice');
            expect(result).toEqual([]);
        });

        test('returns empty array on API error', async () => {
            const client = createMockClient();
            client.call.mockRejectedValue(new Error('API error'));

            const result = await Utils.getAccountTransfers(client, 'alice');
            expect(result).toEqual([]);
        });
    });

    describe('getApiJson()', () => {
        test('returns custom_json operations with dates', async () => {
            const client = createMockClient();
            client.call.mockResolvedValue([
                [0, { op: ['custom_json', { id: 'test', json: '{}' }], timestamp: '2024-06-01T12:00:00' }],
                [1, { op: ['transfer', { from: 'a', to: 'b' }], timestamp: '2024-06-01T12:01:00' }],
            ]);

            const result = await Utils.getApiJson(client);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('test');
            expect(result[0].date).toBeInstanceOf(Date);
            expect(client.call).toHaveBeenCalledWith('condenser_api', 'get_account_history', ['hiveapi', -1, 500]);
        });

        test('passes custom from and limit', async () => {
            const client = createMockClient();
            client.call.mockResolvedValue([]);

            await Utils.getApiJson(client, 100, 50);
            expect(client.call).toHaveBeenCalledWith('condenser_api', 'get_account_history', ['hiveapi', 100, 50]);
        });

        test('returns empty array on error', async () => {
            const client = createMockClient();
            client.call.mockRejectedValue(new Error('fail'));

            expect(await Utils.getApiJson(client)).toEqual([]);
        });

        test('returns empty array on non-array response', async () => {
            const client = createMockClient();
            client.call.mockResolvedValue(undefined);

            expect(await Utils.getApiJson(client)).toEqual([]);
        });
    });

    describe('votingWeight()', () => {
        test('converts 100% to 10000', () => {
            expect(Utils.votingWeight(100)).toBe(10000);
        });

        test('converts 50% to 5000', () => {
            expect(Utils.votingWeight(50)).toBe(5000);
        });

        test('converts 0% to 0', () => {
            expect(Utils.votingWeight(0)).toBe(0);
        });

        test('converts fractional percentage', () => {
            expect(Utils.votingWeight(33.33)).toBe(3333);
        });

        test('caps at 10000', () => {
            expect(Utils.votingWeight(200)).toBe(10000);
        });

        test('throws for negative percentage', () => {
            expect(() => Utils.votingWeight(-10)).toThrow('non-negative number');
        });

        test('throws for non-number', () => {
            expect(() => Utils.votingWeight('50' as any)).toThrow('non-negative number');
        });
    });

    describe('upvote()', () => {
        test('broadcasts vote with correct weight', () => {
            const client = createMockClient();
            const config = { POSTING_KEY: TEST_KEY };

            Utils.upvote(client, config, 'alice', '50.0', 'bob', 'my-post');

            expect(client.broadcast.vote).toHaveBeenCalledWith(
                { voter: 'alice', author: 'bob', permlink: 'my-post', weight: 5000 },
                expect.any(PrivateKey)
            );
        });

        test('defaults to 100% weight', () => {
            const client = createMockClient();
            const config = { POSTING_KEY: TEST_KEY };

            Utils.upvote(client, config, 'alice', undefined, 'bob', 'post');

            expect(client.broadcast.vote).toHaveBeenCalledWith(
                expect.objectContaining({ weight: 10000 }),
                expect.any(PrivateKey)
            );
        });

        test('throws for negative vote percentage', () => {
            const client = createMockClient();
            const config = { POSTING_KEY: TEST_KEY };

            expect(() => Utils.upvote(client, config, 'alice', '-50', 'bob', 'post'))
                .toThrow('Negative voting values');
        });

        test('throws when posting key is missing', () => {
            const client = createMockClient();
            expect(() => Utils.upvote(client, {}, 'alice', '100', 'bob', 'post'))
                .toThrow('Missing required parameters');
        });

        test('throws when voter is missing', () => {
            const client = createMockClient();
            expect(() => Utils.upvote(client, { POSTING_KEY: TEST_KEY }, '', '100', 'bob', 'post'))
                .toThrow('Missing required parameters');
        });
    });

    describe('downvote()', () => {
        test('broadcasts vote with negative weight', () => {
            const client = createMockClient();
            const config = { POSTING_KEY: TEST_KEY };

            Utils.downvote(client, config, 'alice', '50.0', 'bob', 'spam-post');

            expect(client.broadcast.vote).toHaveBeenCalledWith(
                { voter: 'alice', author: 'bob', permlink: 'spam-post', weight: -5000 },
                expect.any(PrivateKey)
            );
        });

        test('defaults to -100% weight', () => {
            const client = createMockClient();
            const config = { POSTING_KEY: TEST_KEY };

            Utils.downvote(client, config, 'alice', undefined, 'bob', 'post');

            expect(client.broadcast.vote).toHaveBeenCalledWith(
                expect.objectContaining({ weight: -10000 }),
                expect.any(PrivateKey)
            );
        });

        test('throws when parameters are missing', () => {
            expect(() => Utils.downvote(null as any, {}, 'alice', '100', 'bob', 'post'))
                .toThrow('Missing required parameters');
        });
    });

    describe('asyncForEach()', () => {
        test('iterates sequentially over array', async () => {
            const order: number[] = [];
            await Utils.asyncForEach([1, 2, 3], async (val, idx) => {
                order.push(val);
            });
            expect(order).toEqual([1, 2, 3]);
        });

        test('passes correct index and array', async () => {
            const arr = ['a', 'b'];
            const indices: number[] = [];
            await Utils.asyncForEach(arr, async (val, idx, a) => {
                indices.push(idx);
                expect(a).toBe(arr);
            });
            expect(indices).toEqual([0, 1]);
        });

        test('handles empty array', async () => {
            const fn = jest.fn();
            await Utils.asyncForEach([], fn);
            expect(fn).not.toHaveBeenCalled();
        });

        test('throws for non-array first arg', async () => {
            await expect(Utils.asyncForEach('abc' as any, jest.fn())).rejects.toThrow('must be an array');
        });

        test('throws for non-function callback', async () => {
            await expect(Utils.asyncForEach([1], 'not-fn' as any)).rejects.toThrow('must be a function');
        });

        test('propagates errors from callback', async () => {
            await expect(
                Utils.asyncForEach([1], async () => { throw new Error('oops'); })
            ).rejects.toThrow('oops');
        });
    });

    describe('recurrentTransfer()', () => {
        test('builds and broadcasts recurrent_transfer operation', () => {
            const client = createMockClient();
            Utils.recurrentTransfer(client, { ACTIVE_KEY: TEST_KEY }, {
                from: 'alice', to: 'bob', amount: '1.000 HIVE',
                recurrence: 24, executions: 10,
            });

            expect(client.broadcast.sendOperations).toHaveBeenCalled();
            const ops = client.broadcast.sendOperations.mock.calls[0][0];
            expect(ops[0][0]).toBe('recurrent_transfer');
            expect(ops[0][1].from).toBe('alice');
            expect(ops[0][1].recurrence).toBe(24);
            expect(ops[0][1].executions).toBe(10);
        });

        test('throws when from is missing', () => {
            const client = createMockClient();
            expect(() => Utils.recurrentTransfer(client, {}, {
                from: '', to: 'bob', amount: '1.000 HIVE', recurrence: 24, executions: 10,
            })).toThrow('Recurrent transfer requires');
        });

        test('throws for non-integer recurrence', () => {
            const client = createMockClient();
            expect(() => Utils.recurrentTransfer(client, { ACTIVE_KEY: TEST_KEY }, {
                from: 'alice', to: 'bob', amount: '1.000 HIVE', recurrence: 1.5, executions: 10,
            })).toThrow('positive integer recurrence');
        });

        test('throws for zero executions', () => {
            const client = createMockClient();
            expect(() => Utils.recurrentTransfer(client, { ACTIVE_KEY: TEST_KEY }, {
                from: 'alice', to: 'bob', amount: '1.000 HIVE', recurrence: 24, executions: 0,
            })).toThrow('positive integer executions');
        });

        test('throws when no signing keys', () => {
            const client = createMockClient();
            expect(() => Utils.recurrentTransfer(client, {}, {
                from: 'alice', to: 'bob', amount: '1.000 HIVE', recurrence: 24, executions: 10,
            })).toThrow('Active key or explicit signing keys');
        });

        test('accepts explicit signing keys', () => {
            const client = createMockClient();
            Utils.recurrentTransfer(client, {}, {
                from: 'alice', to: 'bob', amount: '1.000 HIVE', recurrence: 24, executions: 10,
            }, TEST_KEY);

            expect(client.broadcast.sendOperations).toHaveBeenCalled();
        });
    });

    describe('createProposal()', () => {
        test('builds and broadcasts create_proposal operation', () => {
            const client = createMockClient();
            Utils.createProposal(client, { ACTIVE_KEY: TEST_KEY }, {
                creator: 'alice', receiver: 'bob', daily_pay: '10.000 HBD',
                subject: 'My Proposal', permlink: 'my-proposal',
                start_date: '2024-01-01T00:00:00', end_date: '2024-12-31T00:00:00',
            });

            const ops = client.broadcast.sendOperations.mock.calls[0][0];
            expect(ops[0][0]).toBe('create_proposal');
            expect(ops[0][1].creator).toBe('alice');
            expect(ops[0][1].daily_pay).toBe('10.000 HBD');
        });

        test('throws when required fields are missing', () => {
            const client = createMockClient();
            expect(() => Utils.createProposal(client, { ACTIVE_KEY: TEST_KEY }, {
                creator: '', receiver: 'bob', daily_pay: '10 HBD',
                subject: 's', permlink: 'p',
                start_date: '2024-01-01', end_date: '2024-12-31',
            })).toThrow('Create proposal requires');
        });

        test('throws when no signing keys', () => {
            const client = createMockClient();
            expect(() => Utils.createProposal(client, {}, {
                creator: 'alice', receiver: 'bob', daily_pay: '10 HBD',
                subject: 's', permlink: 'p',
                start_date: '2024-01-01', end_date: '2024-12-31',
            })).toThrow('Active key or explicit signing keys');
        });
    });

    describe('updateProposalVotes()', () => {
        test('builds and broadcasts update_proposal_votes', () => {
            const client = createMockClient();
            Utils.updateProposalVotes(client, { ACTIVE_KEY: TEST_KEY }, {
                voter: 'alice', proposal_ids: [1, 2, 3], approve: true,
            });

            const ops = client.broadcast.sendOperations.mock.calls[0][0];
            expect(ops[0][0]).toBe('update_proposal_votes');
            expect(ops[0][1].proposal_ids).toEqual([1, 2, 3]);
            expect(ops[0][1].approve).toBe(true);
        });

        test('throws when voter is missing', () => {
            const client = createMockClient();
            expect(() => Utils.updateProposalVotes(client, { ACTIVE_KEY: TEST_KEY }, {
                voter: '', proposal_ids: [1], approve: true,
            })).toThrow('Proposal votes require');
        });

        test('throws for empty proposal_ids', () => {
            const client = createMockClient();
            expect(() => Utils.updateProposalVotes(client, { ACTIVE_KEY: TEST_KEY }, {
                voter: 'alice', proposal_ids: [], approve: true,
            })).toThrow('Proposal votes require');
        });

        test('throws when no signing keys', () => {
            const client = createMockClient();
            expect(() => Utils.updateProposalVotes(client, {}, {
                voter: 'alice', proposal_ids: [1], approve: true,
            })).toThrow('Active key or explicit signing keys');
        });
    });

    describe('removeProposals()', () => {
        test('builds and broadcasts remove_proposal', () => {
            const client = createMockClient();
            Utils.removeProposals(client, { ACTIVE_KEY: TEST_KEY }, {
                proposal_owner: 'alice', proposal_ids: [1, 2],
            });

            const ops = client.broadcast.sendOperations.mock.calls[0][0];
            expect(ops[0][0]).toBe('remove_proposal');
            expect(ops[0][1].proposal_owner).toBe('alice');
        });

        test('throws when proposal_owner is missing', () => {
            const client = createMockClient();
            expect(() => Utils.removeProposals(client, { ACTIVE_KEY: TEST_KEY }, {
                proposal_owner: '', proposal_ids: [1],
            })).toThrow('Remove proposals requires');
        });

        test('throws for empty proposal_ids', () => {
            const client = createMockClient();
            expect(() => Utils.removeProposals(client, { ACTIVE_KEY: TEST_KEY }, {
                proposal_owner: 'alice', proposal_ids: [],
            })).toThrow('Remove proposals requires');
        });
    });

    describe('updateAccountAuthorities()', () => {
        test('broadcasts account_update operation', async () => {
            const client = createMockClient();
            const newActive = Utils.createAuthority([['STM_key', 1]], [['bob', 1]], 2);

            await Utils.updateAccountAuthorities(client, { ACTIVE_KEY: TEST_KEY }, 'alice', {
                active: newActive,
            });

            const ops = client.broadcast.sendOperations.mock.calls[0][0];
            expect(ops[0][0]).toBe('account_update');
            expect(ops[0][1].account).toBe('alice');
            expect(ops[0][1].active).toBe(newActive);
        });

        test('broadcasts account_update2 when useAccountUpdate2 is true', async () => {
            const client = createMockClient();
            await Utils.updateAccountAuthorities(client, { ACTIVE_KEY: TEST_KEY }, 'alice', {
                useAccountUpdate2: true,
                posting_json_metadata: '{"app":"test"}',
            });

            const ops = client.broadcast.sendOperations.mock.calls[0][0];
            expect(ops[0][0]).toBe('account_update2');
            expect(ops[0][1].posting_json_metadata).toBe('{"app":"test"}');
        });

        test('uses account_update2 when posting_json_metadata is set', async () => {
            const client = createMockClient();
            await Utils.updateAccountAuthorities(client, { ACTIVE_KEY: TEST_KEY }, 'alice', {
                posting_json_metadata: '{}',
            });

            const ops = client.broadcast.sendOperations.mock.calls[0][0];
            expect(ops[0][0]).toBe('account_update2');
        });

        test('throws when account is missing', async () => {
            const client = createMockClient();
            await expect(Utils.updateAccountAuthorities(client, { ACTIVE_KEY: TEST_KEY }, '', {}))
                .rejects.toThrow('Client, account, and authority update data');
        });

        test('throws when account not found', async () => {
            const client = createMockClient();
            client.database.getAccounts.mockResolvedValue([]);
            await expect(Utils.updateAccountAuthorities(client, { ACTIVE_KEY: TEST_KEY }, 'nonexistent', {}))
                .rejects.toThrow("Unable to load account 'nonexistent'");
        });

        test('throws when no signing keys', async () => {
            const client = createMockClient();
            await expect(Utils.updateAccountAuthorities(client, {}, 'alice', {}))
                .rejects.toThrow('Active key or explicit signing keys');
        });
    });

    describe('transferHiveTokens() success path', () => {
        test('broadcasts transfer with formatted amount', () => {
            const client = createMockClient();
            Utils.transferHiveTokens(client, { ACTIVE_KEY: TEST_KEY }, 'alice', 'bob', '1.5', 'HIVE', 'hello');

            expect(client.broadcast.transfer).toHaveBeenCalledWith(
                { from: 'alice', to: 'bob', amount: '1.500 HIVE', memo: 'hello' },
                expect.any(PrivateKey)
            );
        });

        test('defaults memo to empty string', () => {
            const client = createMockClient();
            Utils.transferHiveTokens(client, { ACTIVE_KEY: TEST_KEY }, 'alice', 'bob', '1', 'HIVE');

            expect(client.broadcast.transfer).toHaveBeenCalledWith(
                expect.objectContaining({ memo: '' }),
                expect.any(PrivateKey)
            );
        });
    });

    describe('broadcastOperations() success path', () => {
        test('broadcasts with single key', () => {
            const client = createMockClient();
            Utils.broadcastOperations(client, [['transfer', {}]], TEST_KEY);

            expect(client.broadcast.sendOperations).toHaveBeenCalledWith(
                [['transfer', {}]],
                expect.any(PrivateKey) // single key, not array
            );
        });

        test('broadcasts with multiple keys', () => {
            const client = createMockClient();
            Utils.broadcastOperations(client, [['transfer', {}]], [TEST_KEY, TEST_KEY]);

            expect(client.broadcast.sendOperations).toHaveBeenCalledWith(
                [['transfer', {}]],
                expect.any(Array)
            );
        });
    });

    describe('transferHiveEngineTokens() success path', () => {
        test('broadcasts custom_json with token transfer payload', () => {
            const client = createMockClient();
            const config = { ACTIVE_KEY: TEST_KEY, HIVE_ENGINE_ID: 'ssc-mainnet-hive' } as any;

            Utils.transferHiveEngineTokens(client, config, 'alice', 'bob', '100', 'leg', 'thanks');

            expect(client.broadcast.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    required_auths: ['alice'],
                    id: 'ssc-mainnet-hive',
                }),
                expect.any(PrivateKey)
            );

            const payload = JSON.parse(client.broadcast.json.mock.calls[0][0].json);
            expect(payload.contractAction).toBe('transfer');
            expect(payload.contractPayload.symbol).toBe('LEG'); // uppercased
            expect(payload.contractPayload.to).toBe('bob');
            expect(payload.contractPayload.quantity).toBe('100');
        });
    });

    describe('issueHiveEngineTokens() success path', () => {
        test('broadcasts custom_json with issue payload', () => {
            const client = createMockClient();
            const config = { ACTIVE_KEY: TEST_KEY, HIVE_ENGINE_ID: 'ssc-mainnet-hive' } as any;

            Utils.issueHiveEngineTokens(client, config, 'alice', 'bob', 'LEG', '500');

            const payload = JSON.parse(client.broadcast.json.mock.calls[0][0].json);
            expect(payload.contractAction).toBe('issue');
            expect(payload.contractPayload.symbol).toBe('LEG');
            expect(payload.contractPayload.quantity).toBe('500');
        });
    });
});
