/**
 * Operation structure validation tests.
 * These tests verify that every operation builder produces correctly
 * structured Hive operations by intercepting broadcastOperations calls
 * and inspecting the operation arrays.
 *
 * No actual broadcasts happen - we mock the broadcast layer.
 */

import { PrivateKey } from '@hiveio/dhive';
import { Streamer } from '../../src/streamer';
import { Utils } from '../../src/utils';
import { createMockAdapter } from '../helpers/mock-adapter';

describe('Operation Structure Validation', () => {
    const activeKey = PrivateKey.fromSeed('struct-active').toString();
    const postingKey = PrivateKey.fromSeed('struct-posting').toString();
    let streamer: Streamer;
    let broadcastSpy: jest.SpyInstance;

    beforeEach(async () => {
        streamer = new Streamer({
            ACTIVE_KEY: activeKey,
            POSTING_KEY: postingKey,
            USERNAME: 'testuser',
            JSON_ID: 'testing',
            PAYLOAD_IDENTIFIER: 'hive_stream',
            DEBUG_MODE: false
        });

        await streamer.registerAdapter(createMockAdapter());

        // Intercept all broadcasts to inspect operation structure
        broadcastSpy = jest.spyOn(Utils, 'broadcastOperations').mockResolvedValue({ id: 'mock-tx', block_num: 1, trx_num: 0, expired: false } as any);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await streamer.stop();
    });

    function getLastBroadcastOps(): Array<[string, any]> {
        expect(broadcastSpy).toHaveBeenCalled();
        const lastCall = broadcastSpy.mock.calls[broadcastSpy.mock.calls.length - 1];
        return lastCall[1]; // operations array is second argument
    }

    // ─── Transfer Operations ────────────────────────────────────────────

    describe('transfer operation structure', () => {
        test('transfer uses client.broadcast.transfer directly', async () => {
            const transferSpy = jest.spyOn((streamer as any).client.broadcast, 'transfer').mockResolvedValue({ id: 'tx' });

            await streamer.ops.transfer()
                .from('alice')
                .to('bob')
                .hive(10)
                .memo('test payment')
                .send();

            expect(transferSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    from: 'alice',
                    to: 'bob',
                    amount: '10.000 HIVE',
                    memo: 'test payment'
                }),
                expect.anything()
            );
        });
    });

    // ─── Social Operations ──────────────────────────────────────────────

    describe('follow operation structure', () => {
        test('follow broadcasts correct custom_json', async () => {
            const jsonSpy = jest.spyOn((streamer as any).client.broadcast, 'json').mockResolvedValue({ id: 'tx' });

            await streamer.follow('alice', 'bob');

            expect(jsonSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    required_auths: [],
                    required_posting_auths: ['alice'],
                    id: 'follow'
                }),
                expect.anything()
            );

            const call = jsonSpy.mock.calls[0];
            const json = JSON.parse((call[0] as any).json);
            expect(json).toEqual(['follow', {
                follower: 'alice',
                following: 'bob',
                what: ['blog']
            }]);
        });

        test('unfollow broadcasts empty what array', async () => {
            const jsonSpy = jest.spyOn((streamer as any).client.broadcast, 'json').mockResolvedValue({ id: 'tx' });

            await streamer.unfollow('alice', 'bob');

            const call = jsonSpy.mock.calls[0];
            const json = JSON.parse((call[0] as any).json);
            expect(json[1].what).toEqual([]);
        });

        test('mute broadcasts ignore what', async () => {
            const jsonSpy = jest.spyOn((streamer as any).client.broadcast, 'json').mockResolvedValue({ id: 'tx' });

            await streamer.mute('alice', 'bob');

            const call = jsonSpy.mock.calls[0];
            const json = JSON.parse((call[0] as any).json);
            expect(json[1].what).toEqual(['ignore']);
        });

        test('reblog broadcasts correct custom_json', async () => {
            const jsonSpy = jest.spyOn((streamer as any).client.broadcast, 'json').mockResolvedValue({ id: 'tx' });

            await streamer.reblog('alice', 'bob', 'great-post');

            const call = jsonSpy.mock.calls[0];
            const json = JSON.parse((call[0] as any).json);
            expect(json).toEqual(['reblog', {
                account: 'alice',
                author: 'bob',
                permlink: 'great-post'
            }]);
        });
    });

    // ─── Staking Operations ─────────────────────────────────────────────

    describe('power up operation structure', () => {
        test('produces correct transfer_to_vesting operation', async () => {
            await streamer.powerUp('alice', 'alice', '100.000');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('transfer_to_vesting');
            expect(ops[0][1]).toEqual({
                from: 'alice',
                to: 'alice',
                amount: '100.000 HIVE'
            });
        });
    });

    describe('power down operation structure', () => {
        test('produces correct withdraw_vesting operation', async () => {
            await streamer.powerDown('alice', '50000.000000 VESTS');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('withdraw_vesting');
            expect(ops[0][1]).toEqual({
                account: 'alice',
                vesting_shares: '50000.000000 VESTS'
            });
        });

        test('cancel power down sets vests to zero', async () => {
            await streamer.cancelPowerDown('alice');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('withdraw_vesting');
            expect(ops[0][1].vesting_shares).toBe('0.000000 VESTS');
        });
    });

    describe('delegate operation structure', () => {
        test('produces correct delegate_vesting_shares operation', async () => {
            await streamer.delegateVestingShares('alice', 'bob', '10000.000000 VESTS');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('delegate_vesting_shares');
            expect(ops[0][1]).toEqual({
                delegator: 'alice',
                delegatee: 'bob',
                vesting_shares: '10000.000000 VESTS'
            });
        });

        test('undelegate sets vests to zero', async () => {
            await streamer.undelegateVestingShares('alice', 'bob');

            const ops = getLastBroadcastOps();
            expect(ops[0][1].vesting_shares).toBe('0.000000 VESTS');
        });
    });

    // ─── Account Operations ─────────────────────────────────────────────

    describe('claim rewards operation structure', () => {
        test('produces correct claim_reward_balance operation', async () => {
            await streamer.claimRewards('alice', '1.000 HIVE', '0.500 HBD', '100.000000 VESTS');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('claim_reward_balance');
            expect(ops[0][1]).toEqual({
                account: 'alice',
                reward_hive: '1.000 HIVE',
                reward_hbd: '0.500 HBD',
                reward_vests: '100.000000 VESTS'
            });
        });
    });

    describe('witness vote operation structure', () => {
        test('produces correct account_witness_vote operation', async () => {
            await streamer.witnessVote('alice', 'someguy', true);

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('account_witness_vote');
            expect(ops[0][1]).toEqual({
                account: 'alice',
                witness: 'someguy',
                approve: true
            });
        });

        test('unapprove sets approve to false', async () => {
            await streamer.witnessVote('alice', 'someguy', false);

            const ops = getLastBroadcastOps();
            expect(ops[0][1].approve).toBe(false);
        });
    });

    describe('proxy operation structure', () => {
        test('setProxy produces correct account_witness_proxy operation', async () => {
            await streamer.setProxy('alice', 'trustedvoter');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('account_witness_proxy');
            expect(ops[0][1]).toEqual({
                account: 'alice',
                proxy: 'trustedvoter'
            });
        });

        test('clearProxy sets empty proxy', async () => {
            await streamer.clearProxy('alice');

            const ops = getLastBroadcastOps();
            expect(ops[0][1].proxy).toBe('');
        });
    });

    // ─── Savings Operations ─────────────────────────────────────────────

    describe('savings operation structure', () => {
        test('transferToSavings produces correct operation', async () => {
            await streamer.transferToSavings('alice', 'alice', '100', 'HIVE', 'saving up');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('transfer_to_savings');
            expect(ops[0][1].from).toBe('alice');
            expect(ops[0][1].to).toBe('alice');
            expect(ops[0][1].amount).toBe('100.000 HIVE');
            expect(ops[0][1].memo).toBe('saving up');
        });

        test('transferFromSavings produces correct operation', async () => {
            await streamer.transferFromSavings('alice', 'alice', '50', 'HBD', 1, 'need cash');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('transfer_from_savings');
            expect(ops[0][1].from).toBe('alice');
            expect(ops[0][1].amount).toBe('50.000 HBD');
            expect(ops[0][1].request_id).toBe(1);
        });

        test('cancelTransferFromSavings produces correct operation', async () => {
            await streamer.cancelTransferFromSavings('alice', 1);

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('cancel_transfer_from_savings');
            expect(ops[0][1]).toEqual({ from: 'alice', request_id: 1 });
        });
    });

    // ─── Convert Operations ─────────────────────────────────────────────

    describe('convert operation structure', () => {
        test('convert produces correct operation', async () => {
            await streamer.convert('alice', '10.000 HBD', 42);

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('convert');
            expect(ops[0][1].owner).toBe('alice');
            expect(ops[0][1].amount).toBe('10.000 HBD');
            expect(ops[0][1].requestid).toBe(42);
        });

        test('collateralizedConvert produces correct operation', async () => {
            await streamer.collateralizedConvert('alice', '10.000 HIVE', 43);

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('collateralized_convert');
            expect(ops[0][1].owner).toBe('alice');
            expect(ops[0][1].amount).toBe('10.000 HIVE');
            expect(ops[0][1].requestid).toBe(43);
        });
    });

    // ─── Content Operations ─────────────────────────────────────────────

    describe('delete comment operation structure', () => {
        test('produces correct operation', async () => {
            await streamer.deleteComment('alice', 'my-post');

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('delete_comment');
            expect(ops[0][1]).toEqual({ author: 'alice', permlink: 'my-post' });
        });
    });

    // ─── Market Operations ──────────────────────────────────────────────

    describe('limit order operation structure', () => {
        test('limitOrderCreate produces correct operation', async () => {
            await streamer.limitOrderCreate('alice', 12345, '10.000 HIVE', '4.000 HBD', false);

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('limit_order_create');
            expect(ops[0][1].owner).toBe('alice');
            expect(ops[0][1].orderid).toBe(12345);
            expect(ops[0][1].amount_to_sell).toBe('10.000 HIVE');
            expect(ops[0][1].min_to_receive).toBe('4.000 HBD');
            expect(ops[0][1].fill_or_kill).toBe(false);
            expect(ops[0][1].expiration).toBeDefined();
        });

        test('limitOrderCancel produces correct operation', async () => {
            await streamer.limitOrderCancel('alice', 12345);

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('limit_order_cancel');
            expect(ops[0][1]).toEqual({ owner: 'alice', orderid: 12345 });
        });
    });

    // ─── Post Builder Structure ─────────────────────────────────────────

    describe('post builder operation structure', () => {
        test('simple post produces single comment operation', async () => {
            await streamer.ops.post()
                .author('alice')
                .title('Test Post')
                .body('Hello world')
                .tags('test', 'hive')
                .send();

            const ops = getLastBroadcastOps();
            expect(ops.length).toBe(1);
            expect(ops[0][0]).toBe('comment');

            const comment = ops[0][1];
            expect(comment.parent_author).toBe('');
            expect(comment.parent_permlink).toBe('test');
            expect(comment.author).toBe('alice');
            expect(comment.title).toBe('Test Post');
            expect(comment.body).toBe('Hello world');
            expect(comment.permlink).toBe('test-post');

            const meta = JSON.parse(comment.json_metadata);
            expect(meta.tags).toEqual(['test', 'hive']);
            expect(meta.app).toBe('hive-stream');
            expect(meta.format).toBe('markdown');
        });

        test('post with beneficiaries produces comment + comment_options', async () => {
            await streamer.ops.post()
                .author('alice')
                .title('Bene Post')
                .body('With beneficiaries')
                .tags('test')
                .beneficiary('devfund', 500)
                .beneficiary('alice-savings', 1000)
                .send();

            const ops = getLastBroadcastOps();
            expect(ops.length).toBe(2);
            expect(ops[0][0]).toBe('comment');
            expect(ops[1][0]).toBe('comment_options');

            const options = ops[1][1];
            expect(options.author).toBe('alice');
            expect(options.permlink).toBe('bene-post');
            expect(options.max_accepted_payout).toBe('1000000.000 HBD');
            expect(options.percent_hbd).toBe(10000);
            expect(options.allow_votes).toBe(true);
            expect(options.allow_curation_rewards).toBe(true);

            // Beneficiaries must be sorted by account name
            const beneficiaries = options.extensions[0][1].beneficiaries;
            expect(beneficiaries).toEqual([
                { account: 'alice-savings', weight: 1000 },
                { account: 'devfund', weight: 500 }
            ]);
        });

        test('post with zero max payout (decline rewards)', async () => {
            await streamer.ops.post()
                .author('alice')
                .title('Free Post')
                .body('No rewards')
                .tags('psa')
                .maxAcceptedPayout(0, 'HBD')
                .send();

            const ops = getLastBroadcastOps();
            expect(ops.length).toBe(2);
            expect(ops[1][1].max_accepted_payout).toBe('0.000 HBD');
        });

        test('community post uses community as parent_permlink', async () => {
            await streamer.ops.post()
                .author('alice')
                .title('Community Post')
                .body('Hello community')
                .community('hive-169321')
                .tags('dev', 'tutorial')
                .send();

            const ops = getLastBroadcastOps();
            expect(ops[0][1].parent_permlink).toBe('hive-169321');
        });

        test('reply uses parentAuthor and parentPermlink', async () => {
            await streamer.ops.post()
                .author('bob')
                .parentAuthor('alice')
                .parentPermlink('test-post')
                .body('Great post!')
                .send();

            const ops = getLastBroadcastOps();
            expect(ops[0][1].parent_author).toBe('alice');
            expect(ops[0][1].parent_permlink).toBe('test-post');
            expect(ops[0][1].title).toBe('');
            expect(ops[0][1].permlink).toContain('re-test-post');
        });

        test('custom metadata fields are included', async () => {
            await streamer.ops.post()
                .author('alice')
                .title('Meta Post')
                .body('With metadata')
                .tags('test')
                .app('my-app/2.0')
                .format('html')
                .description('A custom description')
                .metadata('canonical_url', 'https://myapp.com/posts/1')
                .send();

            const ops = getLastBroadcastOps();
            const meta = JSON.parse(ops[0][1].json_metadata);
            expect(meta.app).toBe('my-app/2.0');
            expect(meta.format).toBe('html');
            expect(meta.description).toBe('A custom description');
            expect(meta.canonical_url).toBe('https://myapp.com/posts/1');
        });
    });

    // ─── Batch Builder Structure ────────────────────────────────────────

    describe('batch builder operation structure', () => {
        test('batches multiple transfers', async () => {
            await streamer.batch()
                .transfer('alice', 'bob', '1.000 HIVE', 'payment 1')
                .transfer('alice', 'carol', '2.000 HIVE', 'payment 2')
                .send();

            const ops = getLastBroadcastOps();
            expect(ops.length).toBe(2);
            expect(ops[0][0]).toBe('transfer');
            expect(ops[0][1]).toEqual({ from: 'alice', to: 'bob', amount: '1.000 HIVE', memo: 'payment 1' });
            expect(ops[1][0]).toBe('transfer');
            expect(ops[1][1]).toEqual({ from: 'alice', to: 'carol', amount: '2.000 HIVE', memo: 'payment 2' });
        });

        test('batches mixed operation types', async () => {
            await streamer.batch()
                .vote('alice', 'bob', 'great-post', 10000)
                .customJson('myapp', { action: 'register' }, 'alice')
                .send();

            const ops = getLastBroadcastOps();
            expect(ops.length).toBe(2);
            expect(ops[0][0]).toBe('vote');
            expect(ops[0][1].weight).toBe(10000);
            expect(ops[1][0]).toBe('custom_json');
            expect(ops[1][1].id).toBe('myapp');
            expect(JSON.parse(ops[1][1].json)).toEqual({ action: 'register' });
        });

        test('batch with raw add() operations', async () => {
            await streamer.batch()
                .add(['claim_reward_balance', {
                    account: 'alice',
                    reward_hive: '1.000 HIVE',
                    reward_hbd: '0.000 HBD',
                    reward_vests: '0.000000 VESTS'
                }])
                .send();

            const ops = getLastBroadcastOps();
            expect(ops.length).toBe(1);
            expect(ops[0][0]).toBe('claim_reward_balance');
        });
    });

    // ─── Withdraw Vesting Route ─────────────────────────────────────────

    describe('withdraw vesting route operation structure', () => {
        test('produces correct operation', async () => {
            await streamer.setWithdrawVestingRoute('alice', 'savings', 5000, true);

            const ops = getLastBroadcastOps();
            expect(ops[0][0]).toBe('set_withdraw_vesting_route');
            expect(ops[0][1]).toEqual({
                from_account: 'alice',
                to_account: 'savings',
                percent: 5000,
                auto_vest: true
            });
        });
    });
});
